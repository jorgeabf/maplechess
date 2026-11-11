// Sincronización de info64 como Cloudflare Workflow.
//
// Un Workflow persiste el resultado de cada paso y reintenta sólo el que
// falla, así que una carga de horas sobrevive a errores puntuales de info64.
// Entre petición y petición hay una pausa (step.sleep) para no pasar de
// 1 petición/s: el servidor de info64 es modesto.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { eventHeaders, parseGames, type ParsedGame } from '../../lib/chess/pgn'
import { addDays, endOfMonth, isoDate, madridDateTime, validDate } from '../../lib/dates'
import { saveHealth, type HealthCounts } from '../../lib/salud'
import { refreshExampleStep } from '../ejemplo'
import { buildGameRows, type Participant } from '../games'
import { fetchText, HttpError } from '../http'
import { fetchBroadcastPgn, gamesOfTournament, LICHESS_STEP, parseBroadcastUrl, resolveTourId } from '../lichess/api'
import {
	deletePastPairings,
	loadCheckedTournaments,
	loadExcluded,
	loadLinkedBroadcasts,
	loadParticipants,
	loadTournamentIds,
	loadTournamentsStarting,
	loadUncalendaredState,
	markGamesChecked,
	proposeSensitive,
	refreshTotals,
	replacePairings,
	replaceParticipations,
	replaceStandings,
	saveGames,
	saveGroup,
	saveGroupFailures,
	saveUncalendaredState,
	upsertTournament,
	type CheckedTournament,
	type GamesSource
} from '../repo'
import { isListedMinors, isMinorsTournament } from '../menores'
import { isListedCopy } from '../repetidos'
import { sensitiveName } from '../sensibles'
import {
	ownLabel,
	parseApiTournaments,
	parseEvents,
	parseGamesPage,
	parseGroupPage,
	parseRoundPage,
	parseStandingsPage,
	parseTeamListing,
	parseTournamentPage,
	parseUpcomingRounds,
	PageFormatError,
	relatedGroup,
	type ApiTournament,
	type EventTournament,
	type TournamentPlayer,
	type TournamentType,
	type UpcomingRound
} from './parse'

export const INFO64_URL = 'https://info64.org'
const SOURCE = 'info64'

export interface Info64SyncParams {
	/** Ventana de fechas de ronda (YYYY-MM-DD, ambas incluidas). */
	from: string
	to: string
	/** Sólo estos torneos ("slug" o "team/slug"), sin consultar el calendario. */
	keys?: string[]
	/** Vuelve a leer torneos que ya se dieron por cerrados. */
	force?: boolean
	/**
	 * Carga inicial encadenada: al terminar, lanza la ventana siguiente de
	 * `months` meses hasta llegar a `until`. Así sólo hay una instancia
	 * pidiendo páginas a info64 en cada momento.
	 */
	chain?: { until: string; months: number }
	/**
	 * Emparejamientos publicados de la próxima ronda de cada torneo individual
	 * que juegue en los próximos PAIRINGS_DAYS días: 'also', además de la
	 * ventana (la diaria); 'only', sólo eso, sin usar from y to (a mano). Con
	 * keys, sólo los de esos torneos.
	 */
	pairings?: 'also' | 'only'
	/**
	 * Guarda las partidas leídas aunque sean muchas menos que las guardadas
	 * (ver saveGames): para cuando el organizador ha retirado partidas de verdad.
	 */
	replace?: boolean
	/**
	 * 'only': sólo la clasificación de los torneos ya guardados, los de keys o
	 * los que empiezan en la ventana, sin pedir el calendario. Para cargar la de
	 * los torneos que ya no se releen; encadenable con chain.
	 */
	standings?: 'only'
	/**
	 * 'only': sólo el grupo de torneos (tournaments.related) de los ya guardados:
	 * los de keys o los que empiezan en la ventana y aún no lo tienen, sin pedir el
	 * calendario ni tocar nada más. Para los torneos que ya no se releen;
	 * encadenable con chain. Pide siempre después de la diaria (msUntilAfterDaily).
	 */
	groups?: 'only'
}

/** Lo que deja en su salida una ventana de sólo grupo. */
export interface GroupsSummary {
	/** Torneos que se han pedido. */
	tournaments: number
	/** Los que tienen grupo. */
	groups: number
	/** Los que no tienen esa página (404). */
	missing: number
	/** Los que han fallado tras sus reintentos. */
	failed: string[]
}

/** Torneo leído y guardado; es lo que pasa del paso "torneo" al de "partidas". */
interface SyncedTournament {
	id: number
	key: string
	name: string
	city: string | null
	startDate: string | null
	timeControl: string | null
	players: number
	/** Retransmisiones de lichess enlazadas desde la página del torneo o halladas en lichess. */
	broadcasts: string[]
	/**
	 * Participantes tal como los da la fuente, con el año de los homónimos, para
	 * cruzar las partidas: en D1 se guardan sin el de los menores (nombres.ts).
	 * Las instancias lanzadas antes de que existiera no lo traen, y tampoco
	 * cuando se conservan los guardados porque la página no trae ninguno.
	 */
	participants?: Participant[]
	/** Lecturas que una guarda no ha dejado guardar (participantes conservados). */
	avisos?: number
}

interface GamesSummary {
	games: number
	/** Jugadores (dos por partida) con FIDE ID asignado. */
	identified: number
	illegal: number
	source: string | null
	/** info64 no tiene partidas pero hay retransmisión: se buscan en lichess. */
	deferred?: boolean
	/** Lecturas que una guarda no ha dejado guardar (partidas conservadas). */
	avisos?: number
}

const FETCH_STEP: WorkflowStepConfig = {
	retries: { limit: 5, delay: '30 seconds', backoff: 'exponential' },
	timeout: '5 minutes'
}

const PAUSE = '1 second'

/** Un torneo guardado, de los que lee una pasada que no pide el calendario. */
interface StoredTournament {
	key: string
	id: number
	type: TournamentType
	hasGroup: boolean
}

/**
 * Página de la que se leen sólo las pestañas del grupo: salen en todas las del
 * torneo, y ésta pesa poco (unos 26 KB; la principal lleva el ranking inicial).
 */
const GROUP_PAGE = 'schedule'

/**
 * Pocos reintentos y seguidos de GROUP_MAX_FAILURES: con los de FETCH_STEP, unos
 * 15 minutos por torneo, una caída de info64 seguiría pidiendo más de una hora.
 */
const GROUP_STEP: WorkflowStepConfig = {
	retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' },
	timeout: '2 minutes'
}
const GROUP_MAX_FAILURES = 5

/** Días tras el final de un torneo durante los que se sigue buscando si sube partidas. */
export const RECHECK_DAYS = 14

/**
 * Días por delante en los que se buscan rondas emparejadas. Los torneos de una
 * ronda por semana publican la siguiente días antes, y es cuando más tiempo
 * hay para prepararla.
 */
export const PAIRINGS_DAYS = 8

/**
 * Torneos que el calendario no enseña: sus rondas no tienen fecha, y /events.json
 * sólo da rondas con fecha (medido el 11-nov-2026: 1.996 empezados desde 2014). La
 * diaria los busca en la lista de la API (/api/3/tournaments, de API_PAGE en
 * API_PAGE: unas 31 peticiones) y lee como mucho UNCALENDARED_PER_NIGHT, los más
 * recientes primero: así entran los nuevos y, noche a noche, los que faltaban.
 */
export const UNCALENDARED_PER_NIGHT = 300
const API_PAGE = 500
/**
 * Tope de páginas de la lista: unas 31 de 500. Llegar a él sin acabarla (la API
 * da menos por página o se dispara su total) es un fallo, no una lista a medias.
 */
const API_MAX_PAGES = 100
/** La API también se pide en inglés y en JSON, no la vista navegable de Django. */
const API_HEADERS: RequestInit = { headers: { Accept: 'application/json' } }
/** El primer día de la carga inicial: lo anterior no se carga. */
export const UNCALENDARED_FROM = '2014-01-01'
/**
 * Pocos reintentos, como los del grupo (GROUP_STEP): si info64 deja de
 * responder, los fallos seguidos lo paran en minutos y no en más de una hora. El
 * tiempo, el de FETCH_STEP: las partidas y la clasificación de un torneo grande
 * pesan más que /schedule.
 */
const UNCALENDARED_STEP: WorkflowStepConfig = { retries: GROUP_STEP.retries, timeout: FETCH_STEP.timeout }
/** Fallos seguidos tras los que se deja de leer: info64 no responde. */
const UNCALENDARED_MAX_FAILURES = 5
/**
 * Noches que se vuelve a pedir uno que falla; luego, hasta que se lea bien con
 * keys. No cuenta la noche en que fallan los primeros sin leer ninguno y también
 * la ventana del calendario: es un fallo de info64 o del parser, no de esos torneos.
 */
export const UNCALENDARED_MAX_NIGHTS = 3

/**
 * Horas de Madrid en que una pasada puede empezar a pedir a info64. Su
 * administración pidió el 25-oct-2026 que el robot le consulte sólo de 00:00 a
 * 06:00: fuera de esa franja puede responder 429. Se empieza a las 00:05 y no
 * después de las 05:00, para acabar antes de las 06:00 (la diaria tarda de 20 minutos
 * a algo más de una hora; una carga larga en ventanas encadenadas sigue a la noche siguiente).
 */
export const INFO64_HOURS = { from: '00:05', until: '05:00' }

/** Milisegundos que faltan para que una pasada pueda empezar a pedir a info64: 0 si ya puede. */
export function msUntilInfo64Hours(date: Date): number {
	const time = madridDateTime(date).slice(11, 16)
	if (time >= INFO64_HOURS.from && time < INFO64_HOURS.until) return 0
	const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
	// Antes de las 00:05, unos minutos; después de las 05:00, hasta las 00:05 del
	// día siguiente. El cambio de hora es a las 02:00 o las 03:00: nunca por medio.
	const wait = (minutes(INFO64_HOURS.from) - minutes(time) + 24 * 60) % (24 * 60)
	return wait * 60_000 - (date.getTime() % 60_000)
}

/**
 * Minuto UTC del día desde el que una carga larga puede pedir a info64 sin
 * coincidir con la diaria (CRON_INFO64_DAILY, a las 00:00 UTC), que del 1 al
 * 7-nov-2026 acabó antes de las 00:22 UTC. Si se retrasa o se alarga (con los
 * torneos sin calendario, hasta algo más de una hora), lo ve waitAfterDaily.
 */
const AFTER_DAILY_MINUTE = 30

/**
 * Milisegundos que faltan para que una carga larga pueda pedir a info64: 0 entre
 * las 00:30 UTC (la 01:30 de Madrid en invierno y las 02:30 en verano) y las
 * 05:00 de Madrid. Va por UTC, como el cron: el cambio de hora no la mueve.
 */
export function msUntilAfterDaily(date: Date): number {
	const minute = date.getUTCHours() * 60 + date.getUTCMinutes()
	const time = madridDateTime(date).slice(11, 16)
	// Hasta mediodía UTC: de 22:00 a 24:00 UTC también es de madrugada en Madrid, pero aún no ha pasado la diaria.
	if (minute >= AFTER_DAILY_MINUTE && minute < 12 * 60 && time < INFO64_HOURS.until) return 0
	const wait = (AFTER_DAILY_MINUTE - minute + 24 * 60) % (24 * 60)
	return wait * 60_000 - (date.getTime() % 60_000)
}

/** Cada cuánto y cuántas veces se mira si la diaria ha acabado: hasta las 02:00 UTC, por los torneos sin calendario. */
const DAILY_WAIT = '10 minutes'
export const DAILY_WAIT_TRIES = 9
const FINISHED = new Set(['complete', 'errored', 'terminated'])

/**
 * ¿Se ve acabada la diaria de ese día (UTC, como la lanza el cron)? Sin instancia
 * o sin poder leerla no se sabe, y no cuenta como acabada: el cron puede llegar
 * tarde, y empezaría después, a la vez.
 */
async function dailyFinished(env: Env, today: string): Promise<boolean> {
	try {
		const instance = await env.INFO64_SYNC.get(dailyInstanceId(today))
		return FINISHED.has((await instance.status()).status)
	} catch {
		return false
	}
}

export class Info64SyncWorkflow extends WorkflowEntrypoint<Env, Info64SyncParams> {
	async run(event: WorkflowEvent<Info64SyncParams>, step: WorkflowStep): Promise<GroupsSummary | undefined> {
		const params = event.payload
		const db = this.env.DB
		let groups: GroupsSummary | undefined
		if (params.groups === 'only') {
			await this.waitAfterDaily(step, 'ventana')
			groups = await this.syncStoredGroups(params, step)
		} else {
			// Lanzada a mano o encadenada fuera de la franja de info64: la espera.
			const wait = await step.do('franja de info64', async () => msUntilInfo64Hours(new Date()))
			if (wait > 0) await step.sleep('espera a la franja de info64', wait)
			if (params.standings === 'only') {
				await this.syncStoredStandings(params, step)
			} else {
				const tournaments = params.pairings === 'only' ? null : await this.syncWindow(params, step)
				// Antes de encadenar la ventana siguiente: nunca dos instancias pidiendo a info64.
				const upcoming = params.pairings ? await this.syncUpcomingRounds(params, step) : null
				// La salud (lib/salud.ts) sólo la escriben las pasadas programadas
				// (schedule.ts): una a mano no debe tapar que falle la diaria.
				const scheduled = !params.keys && !params.chain
				// La de los emparejamientos, antes de los torneos sin calendario: la web de
				// la FADA los lee a las 00:47 UTC (/api/emparejamientos) y la mira.
				if (scheduled && upcoming) {
					await step.do('salud emparejamientos', () => saveHealth(db, 'emparejamientos', upcoming.health))
				}
				const daily = scheduled && tournaments !== null && params.pairings === 'also'
				if (daily) await step.do('salud', () => saveHealth(db, 'info64', tournaments.health))
				// Sólo la diaria, y lo último: los torneos que el calendario no enseña.
				// Con su salud: lo que falle aquí no toca la de la ventana.
				const uncalendared = daily ? await this.syncUncalendared(step, tournaments.keys, tournaments.health) : 0
				const changed = (tournaments?.pending ?? 0) + (upcoming?.added ?? 0) + uncalendared
				if (changed > 0) {
					await step.do('totales', () => refreshTotals(db))
					await refreshExampleStep(step, db, 'info64')
				}
			}
		}

		const chain = params.chain
		if (chain && params.to < chain.until) {
			await step.do('siguiente ventana', async () => {
				const from = addDays(params.to, 1)
				const to = minDate(endOfMonth(from, chain.months), chain.until)
				const id = windowInstanceId(from, to, windowMode(params))
				// Idempotente: si el paso se reintenta tras crearla, no se duplica.
				try {
					await this.env.INFO64_SYNC.get(id)
					return id
				} catch {
					// No existe todavía.
				}
				await this.env.INFO64_SYNC.create({
					id,
					params: { from, to, chain, force: params.force, standings: params.standings, groups: params.groups }
				})
				return id
			})
		}
		return groups
	}

	/**
	 * Espera a poder pedir sin coincidir con la diaria: a su hora y a verla acabada.
	 * Si no se la ve acabada, para la cadena con un error: nunca dos instancias
	 * pidiendo a info64 (pasarían de 1 petición/s). `at` distingue los nombres de
	 * los pasos, porque una ventana puede esperar más de una vez.
	 */
	private async waitAfterDaily(step: WorkflowStep, at: string): Promise<void> {
		const wait = await step.do(`franja tras la diaria ${at}`, async () => msUntilAfterDaily(new Date()))
		if (wait > 0) await step.sleep(`espera a que pase la diaria ${at}`, wait)
		// Después de dormir: es la diaria de ese día la que hay que ver acabada.
		const today = await step.do(`día de la diaria ${at}`, async () => isoDate(new Date()))
		for (let i = 0; i < DAILY_WAIT_TRIES; i++) {
			const finished = await step.do(`diaria acabada ${at} ${i}`, () => dailyFinished(this.env, today))
			if (finished) return
			await step.sleep(`espera a la diaria ${at} ${i}`, DAILY_WAIT)
		}
		throw new Error(`info64: la diaria del ${today} no se ve acabada; no se pide el grupo`)
	}

	/**
	 * Torneos de la ventana (o de keys): participantes, clasificación y
	 * partidas. Devuelve cuántos tenía pendientes y la salud de la pasada:
	 * cuántos han ido bien, cuántos han fallado y cuántos avisos han dejado las
	 * guardas.
	 */
	private async syncWindow(
		params: Info64SyncParams,
		step: WorkflowStep
	): Promise<{ pending: number; health: HealthCounts; keys: string[] }> {
		const today = isoDate(new Date())
		const candidates = params.keys
			? params.keys.map(keyToCandidate)
			: await step.do('calendario', FETCH_STEP, () => listTournaments(params.from, params.to))

		const pending = await step.do('pendientes', async () => {
			// Los sensibles (torneos_sensibles), los de menores y los que repiten
			// las partidas de otro (repetidos.ts) no se leen ni a mano. Con keys,
			// el nombre es el slug, que lleva las mismas palabras.
			const excluded = await loadExcluded(this.env.DB, SOURCE)
			const allowed = candidates.filter(
				(c) =>
					!excluded.has(c.key) &&
					!isMinorsTournament(c.name, c.firstRound) &&
					!isListedMinors(SOURCE, c.key) &&
					!isListedCopy(c.key)
			)
			const checked = await loadCheckedTournaments(
				this.env.DB,
				SOURCE,
				allowed.map((c) => c.key)
			)
			return selectPending(allowed, checked, today, params.force ?? Boolean(params.keys))
		})
		console.log(`[info64] ${params.from}…${params.to}: ${candidates.length} torneos, ${pending.length} pendientes`)

		const health = { ok: 0, fallos: 0, avisos: 0 }
		const replace = params.replace ?? false
		for (const candidate of pending) await this.syncCandidate(step, candidate, replace, health)
		return { pending: pending.length, health, keys: candidates.map((c) => c.key) }
	}

	/**
	 * Un torneo: su página, la plantilla si es por equipos, la clasificación y las
	 * partidas, cada cosa en su paso y con su pausa. Suma a `health` lo que pase y
	 * dice si se ha guardado, si no se guarda (de menores por su página) o si ha
	 * fallado. Un torneo que falla tras sus reintentos no para los demás, ni los
	 * emparejamientos y los totales de después. Sin games_checked_at, se vuelve a
	 * intentar al día siguiente. `config`, los reintentos de los pasos de info64.
	 */
	private async syncCandidate(
		step: WorkflowStep,
		candidate: EventTournament,
		replace: boolean,
		health: HealthCounts,
		config: WorkflowStepConfig = FETCH_STEP
	): Promise<'ok' | 'skipped' | 'failed'> {
		try {
			const synced = await step.do(`torneo ${candidate.key}`, config, () =>
				failFast(() => syncTournament(this.env.DB, candidate))
			)
			await step.sleep(`pausa torneo ${candidate.key}`, PAUSE)
			if (!synced) return 'skipped'
			let tournament = synced
			health.avisos += tournament.avisos ?? 0
			// Antes de las partidas: sus nombres se cruzan con la plantilla.
			if (candidate.type === 'team') {
				const roster = await step.do(`plantilla ${candidate.key}`, config, () =>
					failFast(() => syncTeamRoster(this.env.DB, tournament))
				)
				tournament = { ...tournament, participants: roster.participants }
				health.avisos += roster.avisos ?? 0
				await step.sleep(`pausa plantilla ${candidate.key}`, PAUSE)
			}
			// Después de los participantes: la de un torneo individual casa con ellos.
			health.avisos += await this.standingsStep(step, candidate.key, candidate.type, tournament.id, config)
			let summary = await step.do(`partidas ${candidate.key}`, config, () =>
				failFast(() => syncGames(this.env.DB, tournament, replace))
			)
			// Otro servidor: no hace falta la pausa de info64 antes de pedir a lichess.
			if (summary.deferred) {
				summary = await step.do(`lichess ${candidate.key}`, LICHESS_STEP, () =>
					syncBroadcastGames(this.env.DB, tournament, replace)
				)
			}
			health.avisos += summary.avisos ?? 0
			health.ok++
			if (summary.games > 0) console.log(`[info64] ${candidate.key}: ${JSON.stringify(summary)}`)
			await step.sleep(`pausa partidas ${candidate.key}`, PAUSE)
			return 'ok'
		} catch (error) {
			health.fallos++
			console.warn(`[info64] ${candidate.key}: ${String(error)}`)
			await step.sleep(`pausa partidas ${candidate.key}`, PAUSE)
			return 'failed'
		}
	}

	/**
	 * Los torneos que el calendario no enseña, con su salud (`sin-calendario`).
	 * Lo que falle aquí, también la lista entera, es un fallo de esa salud: no
	 * impide los totales ni toca la de la ventana. Devuelve cuántos ha leído.
	 */
	private async syncUncalendared(step: WorkflowStep, calendarKeys: string[], calendar: HealthCounts): Promise<number> {
		const health = { ok: 0, fallos: 0, avisos: 0 }
		let read = 0
		try {
			read = await this.readUncalendared(step, calendarKeys, calendar, health)
		} catch (error) {
			health.fallos++
			console.warn(`[info64] sin calendario: ${String(error)}`)
		}
		await step.do('salud sin calendario', () => saveHealth(this.env.DB, 'sin-calendario', health))
		return read
	}

	/**
	 * Busca en la lista de la API (UNCALENDARED_PER_NIGHT) los que han empezado y
	 * no están guardados, o siguen abiertos, como los del calendario
	 * (selectPending). No relee los de esta noche (`calendarKeys`), los ya
	 * descartados por su página ni los que llevan UNCALENDARED_MAX_NIGHTS noches
	 * fallando, salvo que se hayan leído bien después (con keys: tienen
	 * games_checked_at). La franja se mira antes de la lista y de cada torneo y,
	 * si info64 deja de responder, para. Lanza si falla la lista. `calendar`, la
	 * salud de la ventana de esta noche, y `health`, la de esta parte.
	 */
	private async readUncalendared(
		step: WorkflowStep,
		calendarKeys: string[],
		calendar: HealthCounts,
		health: HealthCounts
	): Promise<number> {
		const open = await step.do('franja sin calendario', async () => msUntilInfo64Hours(new Date()) === 0)
		if (!open) return 0
		const today = isoDate(new Date())
		const listed = await this.listApiTournaments(step, today)
		const pending = await step.do('sin calendario', async () => {
			const state = await loadUncalendaredState(this.env.DB)
			const skip = new Set([...calendarKeys, ...(await loadExcluded(this.env.DB, SOURCE)), ...state.descartados])
			const candidates = listed.filter((c) => !skip.has(c.key))
			const checked = await loadCheckedTournaments(
				this.env.DB,
				SOURCE,
				candidates.map((c) => c.key)
			)
			const readSince = new Set(checked.filter((c) => c.gamesCheckedAt).map((c) => c.key))
			const failing = (key: string) => (state.fallos[key] ?? 0) >= UNCALENDARED_MAX_NIGHTS && !readSince.has(key)
			return selectUncalendared(
				candidates.filter((c) => !failing(c.key)),
				checked,
				today,
				UNCALENDARED_PER_NIGHT
			)
		})
		console.log(`[info64] sin calendario: ${listed.length} en la API, ${pending.length} para leer`)

		const night = { ok: [] as string[], skipped: [] as string[], failed: [] as string[] }
		let failures = 0
		for (const candidate of pending) {
			const inHours = await step.do(`franja sin calendario ${candidate.key}`, async () => msUntilInfo64Hours(new Date()) === 0)
			if (!inHours) break
			const result = await this.syncCandidate(step, candidate, false, health, UNCALENDARED_STEP)
			night[result].push(candidate.key)
			failures = result === 'failed' ? failures + 1 : 0
			if (failures === UNCALENDARED_MAX_FAILURES) {
				console.warn(`[info64] sin calendario: ${failures} fallos seguidos, hasta ${candidate.key}; se para`)
				break
			}
		}
		const read = night.ok.length + night.skipped.length + night.failed.length
		// Cortada por los fallos seguidos sin leer ninguno bien, y con la ventana del
		// calendario también fallando: es info64 o el parser, no esos torneos.
		const general =
			failures === UNCALENDARED_MAX_FAILURES &&
			night.ok.length + night.skipped.length === 0 &&
			calendar.ok === 0 &&
			calendar.fallos > 0
		const counted = general ? { ...night, failed: [] } : night
		if (read > 0) await step.do('sin calendario apuntados', () => saveUncalendaredState(this.env.DB, counted))
		return read
	}

	/**
	 * La lista de la API, página a página, con sólo los torneos que pueden leerse
	 * (uncalendaredCandidates), una vez cada uno. Cada página empieza donde acaba
	 * la anterior: si la API da menos de API_PAGE, no se salta ninguno. Lanza si
	 * falla una página tras sus reintentos o si no acaba en API_MAX_PAGES.
	 */
	private async listApiTournaments(step: WorkflowStep, today: string): Promise<EventTournament[]> {
		const found = new Map<string, EventTournament>()
		let offset = 0
		for (let page = 0; page < API_MAX_PAGES; page++) {
			const from = offset
			const result = await step.do(`api ${from}`, UNCALENDARED_STEP, () =>
				failFast(async () => {
					const list = parseApiTournaments(await fetchText(apiTournamentsUrl(from), API_HEADERS))
					return { count: list.count, rows: list.rows, candidates: uncalendaredCandidates(list.tournaments, today) }
				})
			)
			for (const candidate of result.candidates) if (!found.has(candidate.key)) found.set(candidate.key, candidate)
			await step.sleep(`pausa api ${from}`, PAUSE)
			offset += result.rows
			if (offset >= result.count) return [...found.values()]
			if (result.rows === 0) throw new Error(`info64: la lista de la API se acaba en ${offset} de ${result.count}`)
		}
		throw new Error(`info64: la lista de la API no acaba en ${API_MAX_PAGES} páginas`)
	}

	/**
	 * Emparejamientos de la próxima ronda de los torneos individuales que juegan
	 * en los próximos PAIRINGS_DAYS días. Devuelve cuántos torneos nuevos ha
	 * guardado (los que aún no han empezado) y la salud de la pasada.
	 */
	private async syncUpcomingRounds(
		params: Info64SyncParams,
		step: WorkflowStep
	): Promise<{ added: number; health: HealthCounts }> {
		const { now, rounds } = await step.do('próximas rondas', FETCH_STEP, () => listUpcomingRounds(new Date()))
		const keys = params.keys?.map((k) => keyToCandidate(k).key)
		const excluded = await step.do('torneos sensibles', async () => [...(await loadExcluded(this.env.DB, SOURCE))])
		const upcoming = rounds.filter(
			(r) =>
				(!keys || keys.includes(r.key)) &&
				!excluded.includes(r.key) &&
				!isMinorsTournament(r.name, r.startsAt) &&
				!isListedMinors(SOURCE, r.key) &&
				!isListedCopy(r.key)
		)
		const ids = await step.do('torneos con ronda próxima', () =>
			loadTournamentIds(
				this.env.DB,
				SOURCE,
				upcoming.map((r) => r.key)
			)
		)
		console.log(`[info64] ${upcoming.length} torneos con ronda en los próximos ${PAIRINGS_DAYS} días`)

		let added = 0
		const health = { ok: 0, fallos: 0, avisos: 0 }
		for (const round of upcoming) {
			let standings: number | null = null
			// Un fallo en un torneo no para los demás.
			try {
				let id = ids[round.key]
				if (id === undefined) {
					// Aún sin empezar: hace falta su ranking inicial para saber quién es quién.
					const candidate = { ...keyToCandidate(round.key), name: round.name }
					const tournament = await step.do(`torneo próximo ${round.key}`, FETCH_STEP, () =>
						failFast(() => syncTournament(this.env.DB, candidate))
					)
					await step.sleep(`pausa torneo próximo ${round.key}`, PAUSE)
					if (!tournament) continue
					id = tournament.id
					added++
					health.avisos += tournament.avisos ?? 0
				}
				const tournamentId = id
				const saved = await step.do(`emparejamientos ${round.key}`, FETCH_STEP, () =>
					failFast(() => syncPairings(this.env.DB, tournamentId, round))
				)
				health.ok++
				if (saved.pairings) console.log(`[info64] ${round.key}: ${JSON.stringify(saved)}`)
				// La clasificación de antes de esta ronda, para prepararla. La diaria
				// ('also') no la pide: ya la ha leído en la ventana, con el torneo en curso.
				if (params.pairings === 'only' && round.round > 1 && ids[round.key] !== undefined) standings = tournamentId
			} catch (error) {
				health.fallos++
				console.warn(`[info64] emparejamientos de ${round.key}: ${String(error)}`)
			}
			await step.sleep(`pausa emparejamientos ${round.key}`, PAUSE)
			if (standings !== null) health.avisos += await this.standingsStep(step, round.key, 'individual', standings)
		}
		await step.do('emparejamientos pasados', () => deletePastPairings(this.env.DB, now))
		return { added, health }
	}

	/**
	 * Los torneos guardados de una pasada que no pide el calendario: los de keys o
	 * los que empiezan en la ventana. Uno sensible, de menores o repetido aún
	 * guardado (sin reprocesar) no se lee. El de menores, por la lista o por su
	 * nombre y su fecha o, con keys, por el slug.
	 */
	private async storedTournaments(params: Info64SyncParams): Promise<StoredTournament[]> {
		const excluded = await loadExcluded(this.env.DB, SOURCE)
		const listed = (key: string) => excluded.has(key) || isListedMinors(SOURCE, key) || isListedCopy(key)
		const skipped = (key: string) => listed(key) || isMinorsTournament(key)
		if (!params.keys) {
			const stored = await loadTournamentsStarting(this.env.DB, SOURCE, params.from, params.to, isoDate(new Date()))
			return stored
				.filter((t) => !listed(t.key) && !isMinorsTournament(t.name, t.startDate))
				.map(({ key, id, type, hasGroup }) => ({ key, id, type, hasGroup: Boolean(hasGroup) }))
		}
		const candidates = params.keys.map(keyToCandidate).filter((c) => !skipped(c.key))
		const ids = await loadTournamentIds(
			this.env.DB,
			SOURCE,
			candidates.map((c) => c.key)
		)
		return candidates.flatMap((c) =>
			ids[c.key] === undefined ? [] : [{ key: c.key, id: ids[c.key], type: c.type, hasGroup: false }]
		)
	}

	/** Sólo la clasificación (standings: 'only') de los torneos guardados. */
	private async syncStoredStandings(params: Info64SyncParams, step: WorkflowStep): Promise<void> {
		const tournaments = await step.do('torneos guardados', () => this.storedTournaments(params))
		console.log(`[info64] ${params.from}…${params.to}: clasificación de ${tournaments.length} torneos`)
		let avisos = 0
		for (const t of tournaments) avisos += await this.standingsStep(step, t.key, t.type, t.id)
		if (avisos > 0) console.warn(`[info64] ${params.from}…${params.to}: ${avisos} clasificaciones sin guardar`)
	}

	/**
	 * Sólo el grupo (groups: 'only') de los torneos guardados: los de keys o los
	 * que aún no lo tienen. La franja se mira antes de cada torneo: una ventana
	 * lenta sigue la noche siguiente. Si info64 deja de responder, para la cadena.
	 * Los que fallan quedan apuntados (saveGroupFailures), también si se para.
	 */
	private async syncStoredGroups(params: Info64SyncParams, step: WorkflowStep): Promise<GroupsSummary> {
		const tournaments = await step.do('torneos guardados', async () =>
			(await this.storedTournaments(params)).filter((t) => !t.hasGroup)
		)
		const summary: GroupsSummary = { tournaments: tournaments.length, groups: 0, missing: 0, failed: [] }
		const attempted: string[] = []
		let failures = 0
		try {
			for (const t of tournaments) {
				const open = await step.do(`franja ${t.key}`, async () => msUntilAfterDaily(new Date()) === 0)
				if (!open) await this.waitAfterDaily(step, t.key)
				attempted.push(t.key)
				try {
					const size = await step.do(`grupo ${t.key}`, GROUP_STEP, () =>
						failFast(() => syncGroup(this.env.DB, t.id, t.key))
					)
					if (size === null) summary.missing++
					else if (size > 0) summary.groups++
					failures = 0
				} catch (error) {
					summary.failed.push(t.key)
					console.warn(`[info64] grupo de ${t.key}: ${String(error)}`)
					if (++failures === GROUP_MAX_FAILURES) {
						throw new Error(`info64: ${failures} fallos seguidos al leer el grupo, hasta ${t.key}; se para la cadena`)
					}
				}
				await step.sleep(`pausa grupo ${t.key}`, PAUSE)
			}
		} finally {
			await step.do('grupos fallidos', () => saveGroupFailures(this.env.DB, attempted, summary.failed))
		}
		console.log(`[info64] ${params.from}…${params.to}: grupos ${JSON.stringify(summary)}`)
		return summary
	}

	/**
	 * Clasificación de un torneo, en su paso y con su pausa. Devuelve los avisos:
	 * uno si falla tras sus reintentos o si una guarda no la deja guardar. Ni lo
	 * uno ni lo otro impide leer las partidas.
	 */
	private async standingsStep(
		step: WorkflowStep,
		key: string,
		type: TournamentType,
		tournamentId: number,
		config: WorkflowStepConfig = FETCH_STEP
	): Promise<number> {
		let avisos = 0
		try {
			const saved = await step.do(`clasificación ${key}`, config, () =>
				failFast(() => syncStandings(this.env.DB, tournamentId, key, type))
			)
			avisos = Number(!saved)
		} catch (error) {
			avisos = 1
			console.warn(`[info64] clasificación de ${key}: ${String(error)}`)
		}
		await step.sleep(`pausa clasificación ${key}`, PAUSE)
		return avisos
	}
}

/** Instancia de la pasada diaria (schedule.ts): la de lichess la espera por este id. */
export function dailyInstanceId(day: string): string {
	return `info64-diario-${day}`
}

const WINDOW_PREFIX = {
	initial: 'info64',
	standings: 'info64-clasificacion',
	groups: 'info64-grupo'
}

/** Qué lee una ventana con esos parámetros. */
export function windowMode(params: { standings?: unknown; groups?: unknown }): keyof typeof WINDOW_PREFIX {
	if (params.groups === 'only') return 'groups'
	return params.standings === 'only' ? 'standings' : 'initial'
}

/**
 * Instancia de una ventana. Cada modo lleva su nombre: las ventanas de la carga
 * inicial ya existen con el suyo, y la cadena se pararía al encontrarlas.
 */
export function windowInstanceId(from: string, to: string, mode: keyof typeof WINDOW_PREFIX = 'initial'): string {
	return `${WINDOW_PREFIX[mode]}-${from}-${to}`
}

function minDate(a: string, b: string): string {
	return a < b ? a : b
}

function keyToCandidate(key: string): EventTournament {
	const clean = key.replace(/^\/+|\/+$/g, '')
	return {
		key: clean,
		type: clean.startsWith('team/') ? 'team' : 'individual',
		name: clean,
		firstRound: '',
		lastRound: ''
	}
}

async function listTournaments(from: string, to: string): Promise<EventTournament[]> {
	const url = `${INFO64_URL}/events.json?start=${from}&end=${addDays(to, 1)}`
	return parseEvents(JSON.parse(await fetchText(url)))
}

/** Próxima ronda de cada torneo individual que juega en los próximos PAIRINGS_DAYS días. */
async function listUpcomingRounds(date: Date): Promise<{ now: string; rounds: UpcomingRound[] }> {
	const now = madridDateTime(date)
	const today = now.slice(0, 10)
	const url = `${INFO64_URL}/events.json?start=${today}&end=${addDays(today, PAIRINGS_DAYS + 1)}`
	return { now, rounds: parseUpcomingRounds(JSON.parse(await fetchText(url)), now) }
}

/**
 * Los errores que reintentar no arregla (un 404, una página con otra forma)
 * fallan el paso a la primera. Si info64 cambia su HTML, cada torneo gastaría
 * cinco reintentos, unos 15 minutos, y la pasada no acabaría a tiempo.
 */
async function failFast<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn()
	} catch (error) {
		const permanent =
			error instanceof PageFormatError || (error instanceof HttpError && (error.status === 404 || error.status === 410))
		throw permanent ? new NonRetryableError(String(error)) : error
	}
}

/** Lee la página de la ronda y guarda sus emparejamientos (ninguno si aún no está emparejada). */
async function syncPairings(
	db: D1Database,
	tournamentId: number,
	upcoming: UpcomingRound
): Promise<{ round: number; pairings: number }> {
	const page = await parseRoundPage(await fetchText(`${INFO64_URL}/${upcoming.key}/${upcoming.round}`))
	if (!page) throw new PageFormatError(`info64: la página de la ronda ${upcoming.round} no tiene la forma esperada`)
	await replacePairings(db, tournamentId, page.round, page.startsAt ?? upcoming.startsAt, page.pairings)
	return { round: page.round, pairings: page.pairings.length }
}

/**
 * Lee la clasificación (/standings) y la guarda. Sin esa página, sin
 * clasificación. Devuelve false si una guarda de replaceStandings no la ha
 * dejado guardar.
 */
async function syncStandings(db: D1Database, tournamentId: number, key: string, type: TournamentType): Promise<boolean> {
	let html: string
	try {
		html = await fetchText(`${INFO64_URL}/${key}/standings`)
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) return true
		throw error
	}
	const page = await parseStandingsPage(html)
	if (!page) throw new PageFormatError('info64: la página de la clasificación no tiene la tabla que se espera')
	const saved = await replaceStandings(db, tournamentId, type, page)
	if (!saved) console.warn(`[info64] ${key}: la clasificación no casa con los participantes o no trae puntos; se conserva`)
	return saved
}

/**
 * Lee las pestañas del grupo de un torneo guardado y las guarda, sin tocar nada
 * más. Devuelve cuántos torneos tiene el grupo: 0 sin grupo y null sin esa
 * página. Los de menores y los sensibles por el rótulo los decide el reprocesado.
 */
async function syncGroup(db: D1Database, tournamentId: number, key: string): Promise<number | null> {
	let html: string
	try {
		html = await fetchText(`${INFO64_URL}/${key}/${GROUP_PAGE}`)
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) return null
		throw error
	}
	const group = relatedGroup(await parseGroupPage(html), key)
	if (!group) return 0
	await saveGroup(db, tournamentId, group)
	return group.length
}

/**
 * Qué torneos del calendario hay que leer: los ya empezados que no se hayan
 * comprobado después de RECHECK_DAYS días desde su final. Así los torneos en
 * curso y recién acabados se revisan a diario hasta que pasa ese margen.
 */
export function selectPending(
	candidates: EventTournament[],
	checked: CheckedTournament[],
	today: string,
	force: boolean
): EventTournament[] {
	const byKey = new Map(checked.map((c) => [c.key, c]))
	return candidates.filter((candidate) => {
		if (candidate.firstRound && candidate.firstRound > today) return false
		if (force) return true
		const state = byKey.get(candidate.key)
		const end = validDate(state?.endDate)
		if (!state?.gamesCheckedAt || !end) return true
		return state.gamesCheckedAt.slice(0, 10) < addDays(end, RECHECK_DAYS)
	})
}

/**
 * De una página de la lista de la API, los torneos que la diaria puede leer: con
 * fecha, desde UNCALENDARED_FROM y ya empezados; ni de menores por el nombre y la
 * fecha ni de las listas a mano, como los del calendario. Los sensibles y los
 * descartados se quitan después, con la base (syncUncalendared).
 */
export function uncalendaredCandidates(tournaments: ApiTournament[], today: string): EventTournament[] {
	return tournaments.flatMap((t): EventTournament[] => {
		const start = t.startDate
		if (!start || start < UNCALENDARED_FROM || start > today) return []
		if (isMinorsTournament(t.name, start) || isListedMinors(SOURCE, t.key) || isListedCopy(t.key)) return []
		return [{ key: t.key, type: t.type, name: t.name, firstRound: start, lastRound: t.endDate ?? start }]
	})
}

/**
 * Cuáles leer esta noche: los que no están guardados o siguen abiertos
 * (selectPending), los más recientes primero, como mucho `limit`. Un guardado
 * sin fecha de fin en la D1 toma la de la API: si no, contaría como abierto y se
 * pediría todas las noches.
 */
export function selectUncalendared(
	candidates: EventTournament[],
	checked: CheckedTournament[],
	today: string,
	limit: number
): EventTournament[] {
	const ends = new Map(candidates.map((c) => [c.key, c.lastRound]))
	const withEnd = checked.map((c) => ({ ...c, endDate: c.endDate ?? ends.get(c.key) ?? null }))
	return selectPending(candidates, withEnd, today, false)
		.sort((a, b) => b.firstRound.localeCompare(a.firstRound) || a.key.localeCompare(b.key))
		.slice(0, limit)
}

/** Una página de la lista de torneos de la API de info64. */
export function apiTournamentsUrl(offset: number): string {
	return `${INFO64_URL}/api/3/tournaments?limit=${API_PAGE}&offset=${offset}`
}

/**
 * Lee la página del torneo y guarda el torneo y sus participantes. Null si,
 * por el nombre y la fecha de la página, es de menores: con keys sólo se sabía
 * el slug, sin fecha, y el calendario quita el último paréntesis del título,
 * que puede ser el de los años de nacimiento («Cat. A (2019-2018-2017)»).
 * También si lo dice el rótulo de su pestaña en el grupo, que es otro nombre
 * que pone el organizador y puede decir lo que el título calla («Sub 12»).
 */
async function syncTournament(db: D1Database, candidate: EventTournament): Promise<SyncedTournament | null> {
	const url = `${INFO64_URL}/${candidate.key}`
	const page = await parseTournamentPage(await fetchText(url))
	const startDate = page.startDate ?? validDate(candidate.firstRound)
	const label = ownLabel(page.related, candidate.key)
	if (isMinorsTournament(page.name, startDate) || isMinorsTournament(label, startDate)) {
		console.log(`[info64] ${candidate.key}: de menores por su página; no se guarda`)
		return null
	}
	const id = await upsertTournament(db, {
		source: SOURCE,
		key: candidate.key,
		type: candidate.type,
		name: page.name,
		city: page.city,
		startDate,
		endDate: page.endDate ?? validDate(candidate.lastRound),
		timeControl: page.timeControl,
		url,
		syncedAt: new Date().toISOString(),
		related: relatedGroup(page.related, candidate.key)
	})
	// Si lo parece, por el nombre, la ciudad o el rótulo, se apunta para revisarlo;
	// hasta entonces se guarda como los demás.
	const name = sensitiveName(page.name, page.city, label)
	if (name) await proposeSensitive(db, [{ source: SOURCE, key: candidate.key, name }])
	// En los torneos por equipos la página principal no trae jugadores: la
	// plantilla se guarda en su propio paso (syncTeamRoster).
	const kept = candidate.type === 'individual' && !(await replaceParticipations(db, id, page.players))
	if (kept) console.warn(`[info64] ${candidate.key}: la página no trae participantes; se conservan los guardados`)
	// Detrás de las que enlaza info64, las que ha encontrado la sincronización
	// de lichess (lichess/sync.ts) entre sus retransmisiones oficiales.
	const linked = await loadLinkedBroadcasts(db, id)
	return {
		id,
		key: candidate.key,
		name: page.name,
		city: page.city,
		startDate,
		timeControl: page.timeControl,
		players: page.players.length,
		broadcasts: [...new Set([...page.broadcasts, ...linked])],
		// Con los guardados conservados, las partidas se cruzan con ellos.
		participants: candidate.type === 'team' ? [] : kept ? undefined : page.players.map(toParticipant),
		avisos: Number(kept)
	}
}

/** Plantillas de un torneo por equipos (/listing). Sin esa página, sin plantilla. */
async function syncTeamRoster(
	db: D1Database,
	tournament: SyncedTournament
): Promise<{ players: number; participants?: Participant[]; avisos: number }> {
	let players: TournamentPlayer[] = []
	try {
		players = await parseTeamListing(await fetchText(`${INFO64_URL}/${tournament.key}/listing`))
	} catch (error) {
		if (!(error instanceof HttpError && error.status === 404)) throw error
	}
	if (await replaceParticipations(db, tournament.id, players)) {
		return { players: players.length, participants: players.map(toParticipant), avisos: 0 }
	}
	console.warn(`[info64] ${tournament.key}: sin plantillas; se conservan las guardadas`)
	return { players: 0, avisos: 1 }
}

/** Lo que el cruce de partidas necesita de cada jugador del ranking o la plantilla. */
function toParticipant({ name, fideId, rating, title }: TournamentPlayer): Participant {
	return { name, fideId, rating, title }
}

/** Participantes para cruzar las partidas: los de la fuente o, si el paso no los trae, los guardados. */
async function participantsOf(db: D1Database, tournament: SyncedTournament): Promise<Participant[]> {
	return tournament.participants ?? (await loadParticipants(db, tournament.id))
}

/** Cruza, guarda y resume las partidas de una fuente. Si la guarda de saveGames no las deja guardar, avisa. */
async function storeGames(
	db: D1Database,
	tournament: SyncedTournament,
	parsed: ParsedGame[],
	source: GamesSource,
	replace: boolean
): Promise<GamesSummary> {
	const rows = buildGameRows(parsed, await participantsOf(db, tournament), tournament)
	const saved = await saveGames(db, tournament.id, rows, new Date().toISOString(), source, { replace })
	if (!saved) {
		console.warn(`[info64] ${tournament.key}: la lectura trae ${rows.length} partidas, menos de la mitad de las guardadas; se conservan`)
		return { ...NO_GAMES, avisos: 1 }
	}
	return {
		games: rows.length,
		identified: rows.reduce((n, r) => n + Number(r.whiteFideId !== null) + Number(r.blackFideId !== null), 0),
		illegal: parsed.filter((g) => g.illegalAt !== undefined).length,
		source: rows.length > 0 ? source.name : null
	}
}

const NO_GAMES: GamesSummary = { games: 0, identified: 0, illegal: 0, source: null }

async function syncGames(db: D1Database, tournament: SyncedTournament, replace: boolean): Promise<GamesSummary> {
	const pgn = await parseGamesPage(await fetchText(`${INFO64_URL}/${tournament.key}/games`))
	const parsed = pgn ? parseGames(pgn) : []
	// Una llave sin cerrar en un comentario se traga el resto del texto: chessops
	// no lanza y lee menos partidas de las que hay. Mejor no guardar nada.
	const expected = pgn ? eventHeaders(pgn) : 0
	if (parsed.length < expected) {
		console.warn(`[info64] ${tournament.key}: el PGN trae ${expected} partidas y sólo se leen ${parsed.length}; no se guarda`)
		await markGamesChecked(db, tournament.id, new Date().toISOString())
		return { ...NO_GAMES, avisos: 1 }
	}
	// Sin partidas en info64 pero con retransmisión: se guardan en el paso de lichess.
	if (parsed.length === 0 && tournament.broadcasts.length > 0) return { ...NO_GAMES, deferred: true }
	return storeGames(db, tournament, parsed, { name: SOURCE, url: null }, replace)
}

/**
 * Partidas de la primera retransmisión enlazada que exista y tenga partidas
 * de este torneo. Si alguna existe pero ninguna las tiene, el torneo queda
 * revisado y sin partidas, salvo que ya las tuviera (la guarda de saveGames).
 * Si ya no existe ninguna (lichess borra o hace privadas algunas), se
 * conservan las partidas guardadas: no hay fuente que las sustituya.
 */
async function syncBroadcastGames(
	db: D1Database,
	tournament: SyncedTournament,
	replace: boolean
): Promise<GamesSummary> {
	const participants = await participantsOf(db, tournament)
	let anyBroadcast = false
	for (const url of tournament.broadcasts) {
		const ref = parseBroadcastUrl(url)
		const tourId = ref && (await resolveTourId(ref))
		const pgn = tourId && (await fetchBroadcastPgn(tourId))
		if (!pgn) continue
		anyBroadcast = true
		const games = gamesOfTournament(parseGames(pgn), participants)
		if (games.length > 0) return storeGames(db, tournament, games, { name: 'lichess', url }, replace)
	}
	if (!anyBroadcast) {
		await markGamesChecked(db, tournament.id, new Date().toISOString())
		return NO_GAMES
	}
	return storeGames(db, tournament, [], { name: 'lichess', url: null }, replace)
}
