// Sincronización de info64 como Cloudflare Workflow.
//
// Un Workflow persiste el resultado de cada paso y reintenta sólo el que
// falla, así que una carga de horas sobrevive a errores puntuales de info64.
// Entre petición y petición hay una pausa (step.sleep) para no pasar de
// 1 petición/s: el servidor de info64 es modesto.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { parseGames, type ParsedGame } from '../../lib/chess/pgn'
import { addDays, endOfMonth, isoDate, madridDateTime, validDate } from '../../lib/dates'
import { saveHealth, type HealthCounts } from '../../lib/salud'
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
	markGamesChecked,
	proposeSensitive,
	refreshTotals,
	replacePairings,
	replaceParticipations,
	replaceStandings,
	saveGames,
	upsertTournament,
	type CheckedTournament,
	type GamesSource
} from '../repo'
import { isMinorsTournament } from '../menores'
import { looksSensitive } from '../sensibles'
import {
	parseEvents,
	parseGamesPage,
	parseRoundPage,
	parseStandingsPage,
	parseTeamListing,
	parseTournamentPage,
	parseUpcomingRounds,
	PageFormatError,
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

/** Días tras el final de un torneo durante los que se sigue buscando si sube partidas. */
export const RECHECK_DAYS = 14

/**
 * Días por delante en los que se buscan rondas emparejadas. Los torneos de una
 * ronda por semana publican la siguiente días antes, y es cuando más tiempo
 * hay para prepararla.
 */
export const PAIRINGS_DAYS = 8

/**
 * Horas de Madrid en que una pasada puede empezar a pedir a info64. Su
 * administración pidió el 25-oct-2026 que el robot le consulte sólo de 00:00 a
 * 06:00: fuera de esa franja puede responder 429. Se empieza a las 00:05 y no
 * después de las 05:00, para acabar antes de las 06:00 (la diaria tarda unos
 * 20 minutos; una carga larga en ventanas encadenadas sigue a la noche siguiente).
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

export class Info64SyncWorkflow extends WorkflowEntrypoint<Env, Info64SyncParams> {
	async run(event: WorkflowEvent<Info64SyncParams>, step: WorkflowStep): Promise<void> {
		const params = event.payload
		const db = this.env.DB
		// Lanzada a mano o encadenada fuera de la franja de info64: la espera.
		const wait = await step.do('franja de info64', async () => msUntilInfo64Hours(new Date()))
		if (wait > 0) await step.sleep('espera a la franja de info64', wait)
		if (params.standings === 'only') {
			await this.syncStoredStandings(params, step)
		} else {
			const tournaments = params.pairings === 'only' ? null : await this.syncWindow(params, step)
			// Antes de encadenar la ventana siguiente: nunca dos instancias pidiendo a info64.
			const upcoming = params.pairings ? await this.syncUpcomingRounds(params, step) : null
			if ((tournaments?.pending ?? 0) + (upcoming?.added ?? 0) > 0) await step.do('totales', () => refreshTotals(db))

			// La salud (lib/salud.ts) sólo la escriben las pasadas programadas
			// (schedule.ts): una a mano no debe tapar que falle la diaria.
			if (!params.keys && !params.chain) {
				if (tournaments && params.pairings === 'also') {
					await step.do('salud', () => saveHealth(db, 'info64', tournaments.health))
				}
				if (upcoming) await step.do('salud emparejamientos', () => saveHealth(db, 'emparejamientos', upcoming.health))
			}
		}

		const chain = params.chain
		if (chain && params.to < chain.until) {
			await step.do('siguiente ventana', async () => {
				const from = addDays(params.to, 1)
				const to = minDate(endOfMonth(from, chain.months), chain.until)
				const id = windowInstanceId(from, to, params.standings)
				// Idempotente: si el paso se reintenta tras crearla, no se duplica.
				try {
					await this.env.INFO64_SYNC.get(id)
					return id
				} catch {
					// No existe todavía.
				}
				await this.env.INFO64_SYNC.create({
					id,
					params: { from, to, chain, force: params.force, standings: params.standings }
				})
				return id
			})
		}
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
	): Promise<{ pending: number; health: HealthCounts }> {
		const today = isoDate(new Date())
		const candidates = params.keys
			? params.keys.map(keyToCandidate)
			: await step.do('calendario', FETCH_STEP, () => listTournaments(params.from, params.to))

		const pending = await step.do('pendientes', async () => {
			// Los sensibles (torneos_sensibles) y los de menores no se leen ni a
			// mano. Con keys, el nombre es el slug, que lleva las mismas palabras.
			const excluded = await loadExcluded(this.env.DB, SOURCE)
			const allowed = candidates.filter((c) => !excluded.has(c.key) && !isMinorsTournament(c.name))
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
		for (const candidate of pending) {
			// Un torneo que falla tras sus reintentos no para los demás, ni los
			// emparejamientos y los totales de después. Sin games_checked_at, se
			// vuelve a intentar al día siguiente.
			try {
				let tournament = await step.do(`torneo ${candidate.key}`, FETCH_STEP, () =>
					failFast(() => syncTournament(this.env.DB, candidate))
				)
				health.avisos += tournament.avisos ?? 0
				await step.sleep(`pausa torneo ${candidate.key}`, PAUSE)
				// Antes de las partidas: sus nombres se cruzan con la plantilla.
				if (candidate.type === 'team') {
					const roster = await step.do(`plantilla ${candidate.key}`, FETCH_STEP, () =>
						failFast(() => syncTeamRoster(this.env.DB, tournament))
					)
					tournament = { ...tournament, participants: roster.participants }
					health.avisos += roster.avisos ?? 0
					await step.sleep(`pausa plantilla ${candidate.key}`, PAUSE)
				}
				// Después de los participantes: la de un torneo individual casa con ellos.
				health.avisos += await this.standingsStep(step, candidate.key, candidate.type, tournament.id)
				let summary = await step.do(`partidas ${candidate.key}`, FETCH_STEP, () =>
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
			} catch (error) {
				health.fallos++
				console.warn(`[info64] ${candidate.key}: ${String(error)}`)
			}
			await step.sleep(`pausa partidas ${candidate.key}`, PAUSE)
		}
		return { pending: pending.length, health }
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
			(r) => (!keys || keys.includes(r.key)) && !excluded.includes(r.key) && !isMinorsTournament(r.name)
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
					id = tournament.id
					added++
					health.avisos += tournament.avisos ?? 0
					await step.sleep(`pausa torneo próximo ${round.key}`, PAUSE)
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

	/** Sólo la clasificación (standings: 'only') de los torneos guardados: los de keys o los que empiezan en la ventana. */
	private async syncStoredStandings(params: Info64SyncParams, step: WorkflowStep): Promise<void> {
		const tournaments = await step.do('torneos guardados', async () => {
			// Uno sensible o de menores aún guardado (sin reprocesar) no se lee. El
			// de menores, por el slug.
			const excluded = await loadExcluded(this.env.DB, SOURCE)
			const skipped = (key: string) => excluded.has(key) || isMinorsTournament(key)
			if (!params.keys) {
				const stored = await loadTournamentsStarting(this.env.DB, SOURCE, params.from, params.to, isoDate(new Date()))
				return stored.filter((t) => !skipped(t.key))
			}
			const candidates = params.keys.map(keyToCandidate).filter((c) => !skipped(c.key))
			const ids = await loadTournamentIds(
				this.env.DB,
				SOURCE,
				candidates.map((c) => c.key)
			)
			return candidates.flatMap((c) => (ids[c.key] === undefined ? [] : [{ key: c.key, id: ids[c.key], type: c.type }]))
		})
		console.log(`[info64] ${params.from}…${params.to}: clasificación de ${tournaments.length} torneos`)
		let avisos = 0
		for (const t of tournaments) avisos += await this.standingsStep(step, t.key, t.type, t.id)
		if (avisos > 0) console.warn(`[info64] ${params.from}…${params.to}: ${avisos} clasificaciones sin guardar`)
	}

	/**
	 * Clasificación de un torneo, en su paso y con su pausa. Devuelve los avisos:
	 * uno si falla tras sus reintentos o si una guarda no la deja guardar. Ni lo
	 * uno ni lo otro impide leer las partidas.
	 */
	private async standingsStep(step: WorkflowStep, key: string, type: TournamentType, tournamentId: number): Promise<number> {
		let avisos = 0
		try {
			const saved = await step.do(`clasificación ${key}`, FETCH_STEP, () =>
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

/**
 * Instancia de una ventana. Las de sólo clasificación llevan otro nombre: las
 * ventanas de la carga inicial ya existen con el suyo, y la cadena se pararía
 * al encontrarlas.
 */
export function windowInstanceId(from: string, to: string, standings?: 'only'): string {
	return standings === 'only' ? `info64-clasificacion-${from}-${to}` : `info64-${from}-${to}`
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

async function syncTournament(db: D1Database, candidate: EventTournament): Promise<SyncedTournament> {
	const url = `${INFO64_URL}/${candidate.key}`
	const page = await parseTournamentPage(await fetchText(url))
	const startDate = page.startDate ?? validDate(candidate.firstRound)
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
		syncedAt: new Date().toISOString()
	})
	// Si lo parece, se apunta para revisarlo; hasta entonces se guarda como los demás.
	if (looksSensitive(page.name)) await proposeSensitive(db, [{ source: SOURCE, key: candidate.key, name: page.name }])
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

/** Cabeceras Event del texto: una por partida en los PGN de info64. */
function eventHeaders(pgn: string): number {
	return pgn.match(/\[Event\s+"/g)?.length ?? 0
}

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
