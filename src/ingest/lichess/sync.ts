// Retransmisiones oficiales de lichess con jugadores españoles, como Workflow.
//
// Lichess retransmite muchos torneos con españoles que info64 no enlaza, o que
// no están en info64 (Cataluña, el extranjero). Cada día se miran las
// retransmisiones activas y las terminadas desde la pasada anterior. De cada
// una nueva se piden sus jugadores y, si hay españoles, el torneo y el PGN:
// - si es un torneo de info64 sin partidas, se le enlaza: sus partidas se
//   guardan en él y la sincronización de info64 la usa desde entonces como si
//   info64 la enlazara;
// - si es un torneo de info64 con partidas, se descarta;
// - si no está en info64, se guarda como torneo propio (source 'lichess') con
//   las partidas en las que juega algún español.
// Lo decidido queda en lichess_tours para no volver a pedirla. Las propias se
// releen cada día hasta que terminan; las que no tienen españoles, una vez más
// al terminar (las retransmisiones de las primeras mesas van sumando jugadores).
//
// Normas de lichess: una petición cada vez y, ante un 429, esperar al menos un
// minuto (los reintentos de LICHESS_STEP empiezan en uno). Cada paso hace una
// sola petición y va seguido de una pausa (LICHESS_PAUSE): así un 429 sólo
// repite esa petición.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { normalizeName } from '../../lib/chess/names'
import { parseGames, type ParsedGame } from '../../lib/chess/pgn'
import { plausibleRating } from '../../lib/chess/rating'
import { TIME_CLASS_LABEL } from '../../lib/chess/timecontrol'
import { addDays, isoDate, validDate } from '../../lib/dates'
import { saveHealth } from '../../lib/salud'
import { buildGameRows, type TournamentContext } from '../games'
import type { TournamentPlayer } from '../info64/parse'
import { dailyInstanceId } from '../info64/sync'
import { publicName } from '../nombres'
import {
	deleteLichessTournament,
	findInfo64Tournament,
	gamesStoredElsewhere,
	loadExcluded,
	loadLichessTours,
	loadParticipants,
	loadSyncState,
	loadTournamentContext,
	proposeSensitive,
	refreshTotals,
	replaceParticipations,
	saveGames,
	saveLichessTour,
	saveSyncState,
	spanishFideIds,
	upsertTournament,
	type Info64Match,
	type LichessTour,
	type LichessTourStatus
} from '../repo'
import { isMinorsTournament } from '../menores'
import { looksSensitive } from '../sensibles'
import {
	fetchBroadcastPgn,
	fetchRound,
	fetchTopPage,
	fetchTour,
	fetchTourPlayers,
	gamesOfTournament,
	gamesWithPlayers,
	LICHESS_STEP,
	parseBroadcastUrl,
	pgnFideIds,
	TOP_MAX_PAGES,
	topCandidates,
	type BroadcastCandidate,
	type BroadcastDetail,
	type BroadcastPlayer,
	type BroadcastRoundDetail,
	type BroadcastTour
} from './api'

const SOURCE = 'lichess'

export interface LichessSyncParams {
	/**
	 * Rondas concretas, en vez del listado: la carga inicial, con las rondas
	 * de los volcados mensuales (scripts/lichess-rondas.mjs).
	 */
	rounds?: string[]
	/** Torneos concretos de lichess, en vez del listado. */
	tours?: string[]
	/** Mira las terminadas desde este día (YYYY-MM-DD) y no desde la pasada anterior. */
	since?: string
	/** Vuelve a leer las retransmisiones ya decididas. */
	force?: boolean
}

/**
 * Pausa tras cada petición. Desde Workers, a una cada uno o dos segundos,
 * lichess respondía 429 tras unas quince seguidas (carga inicial del
 * 19-oct-2026). Con esta pausa sólo lo sigue dando el endpoint del torneo
 * (uno cada tres minutos): sus datos se piden por una de sus rondas
 * (fetchTourDetail).
 */
const LICHESS_PAUSE = '6 seconds'

/**
 * Trozo de trabajo con una única petición a lichess. En el Workflow es un
 * paso con los reintentos de LICHESS_STEP seguido de la pausa; en los tests,
 * la función tal cual.
 */
export type LichessRequest = <T extends Rpc.Serializable<T>>(name: string, fn: () => Promise<T>) => Promise<T>

const DAY_MS = 86_400_000

/** sync_state: inicio de la última pasada diaria completa. */
const LAST_RUN_KEY = 'lichess_last_run'
/** Margen sobre la pasada anterior y plazo de la primera. */
const SINCE_MARGIN_DAYS = 1
const FIRST_RUN_DAYS = 2

/**
 * Un torneo de info64 es el de la retransmisión si entre sus participantes
 * están al menos MIN_OVERLAP de los españoles que juegan en ella y la mitad.
 * En la medición de abril a septiembre de 2026 los aciertos daban el 100 % y
 * los falsos, como mucho, el 20 %.
 */
export const MIN_OVERLAP = 2
export const MIN_OVERLAP_SHARE = 0.5
/** Días de margen entre las fechas de la retransmisión y las del torneo de info64. */
const MATCH_MARGIN_DAYS = 3

/** Mientras corre la sincronización diaria de info64 (también pide a lichess), se espera. */
const INFO64_WAIT = '10 minutes'
const INFO64_WAIT_TRIES = 6
const BUSY = new Set(['queued', 'running', 'waiting', 'waitingForPause'])

/** Resultado de leer una retransmisión. null en status: no se decide hasta que tenga jugadores. */
export interface TourSummary {
	status: LichessTourStatus | null
	games: number
	espPlayers: number
	/** Lecturas que una guarda no ha dejado guardar: un torneo propio que se conserva. */
	avisos?: number
}

export class LichessSyncWorkflow extends WorkflowEntrypoint<Env, LichessSyncParams> {
	async run(event: WorkflowEvent<LichessSyncParams>, step: WorkflowStep): Promise<void> {
		const params = event.payload ?? {}
		const db = this.env.DB
		const daily = !params.rounds && !params.tours
		const today = isoDate(event.timestamp)
		const lichess: LichessRequest = async (name, fn) => {
			const result = await step.do(name, LICHESS_STEP, fn)
			await step.sleep(`pausa ${name}`, LICHESS_PAUSE)
			return result
		}

		for (let i = 0; i < INFO64_WAIT_TRIES; i++) {
			const busy = await step.do(`info64 en marcha ${i}`, () => info64Running(this.env, today))
			if (!busy) break
			await step.sleep(`espera a info64 ${i}`, INFO64_WAIT)
		}

		const candidates: BroadcastCandidate[] = (params.tours ?? []).map((id) => ({ id, name: id, finished: false }))
		// La ronda da ya el torneo y sus datos: syncTour no tiene que pedirlos.
		const preloaded = new Map<string, TourInfo>()
		for (const round of params.rounds ?? []) {
			// Una ronda que no se puede leer no para las demás.
			try {
				const info = await lichess(`ronda ${round}`, async () => {
					const detail = await fetchRound(round)
					return detail ? tourInfo(detail, false, Date.now()) : null
				})
				if (info) {
					candidates.push({ id: info.tour.id, name: info.tour.name, finished: info.finished, round })
					preloaded.set(info.tour.id, info)
				}
			} catch (error) {
				console.warn(`[lichess] ronda ${round}: ${String(error)}`)
			}
		}
		if (daily) {
			const since = await step.do('desde', async () =>
				sinceOf(params.since, await loadSyncState(db, LAST_RUN_KEY), event.timestamp)
			)
			candidates.push(...(await listCandidates(since, lichess)))
		}

		const pending = await step.do('pendientes', async () => {
			// Las sensibles (torneos_sensibles) y las de menores no se leen, ni con
			// force. Con tours aún no se sabe el nombre: lo mira syncTour. Las
			// del listado son de estos días; las de rounds pueden ser antiguas, y
			// con la fecha de hoy una temporada («2019-2020») parecería de niños.
			const excluded = await loadExcluded(db, SOURCE)
			const dateOf = (c: BroadcastCandidate) => {
				const info = preloaded.get(c.id)
				return info ? dayOf(info.tour.dates?.[0]) : today
			}
			const allowed = candidates.filter((c) => !excluded.has(c.id) && !isMinorsTournament(c.name, dateOf(c)))
			return selectTours(
				allowed,
				await loadLichessTours(
					db,
					allowed.map((c) => c.id)
				),
				params.force ?? false
			)
		})
		console.log(`[lichess] ${candidates.length} retransmisiones, ${pending.length} pendientes`)

		let saved = 0
		const health = { ok: 0, fallos: 0, avisos: 0 }
		for (const candidate of pending) {
			// Un fallo en una retransmisión no para las demás.
			try {
				const summary = await syncTour(db, candidate, lichess, preloaded.get(candidate.id))
				health.ok++
				health.avisos += summary.avisos ?? 0
				if (summary.games > 0) {
					saved++
					console.log(`[lichess] ${candidate.id} ${candidate.name}: ${JSON.stringify(summary)}`)
				}
			} catch (error) {
				health.fallos++
				console.warn(`[lichess] ${candidate.id}: ${String(error)}`)
			}
		}
		if (saved > 0) await step.do('totales', () => refreshTotals(db))
		if (daily) {
			await step.do('fin', () => saveSyncState(db, LAST_RUN_KEY, event.timestamp.toISOString()))
			// Sólo la diaria: una relectura a mano no debe tapar que falle (lib/salud.ts).
			await step.do('salud', () => saveHealth(db, 'lichess', health))
		}
	}
}

async function info64Running(env: Env, today: string): Promise<boolean> {
	try {
		const instance = await env.INFO64_SYNC.get(dailyInstanceId(today))
		return BUSY.has((await instance.status()).status)
	} catch {
		// Aún no existe (o ya no se guarda): no está en marcha.
		return false
	}
}

/** Desde cuándo (milisegundos) se miran las terminadas. */
export function sinceOf(param: string | undefined, lastRun: string | null, now: Date): number {
	if (param) return Date.parse(`${param}T00:00:00Z`)
	const base = lastRun ? Date.parse(lastRun) : now.getTime() - FIRST_RUN_DAYS * DAY_MS
	return base - (lastRun ? SINCE_MARGIN_DAYS * DAY_MS : 0)
}

/**
 * Activas y terminadas desde `since`. El listado muestra un único torneo de
 * cada grupo (un festival con varios grupos, un campeonato por edades): los
 * demás se piden aparte.
 */
async function listCandidates(since: number, lichess: LichessRequest): Promise<BroadcastCandidate[]> {
	const candidates: BroadcastCandidate[] = []
	for (let page = 1; page <= TOP_MAX_PAGES; page++) {
		const { candidates: found, more } = await lichess(`listado ${page}`, async () => {
			const top = await fetchTopPage(page)
			return top ? topCandidates(top, since) : { candidates: [], more: false }
		})
		candidates.push(...found)
		if (!more) break
		if (page === TOP_MAX_PAGES) {
			console.warn(`[lichess] el listado no llega hasta ${new Date(since).toISOString()}: lo anterior, con los volcados`)
		}
	}
	const result: BroadcastCandidate[] = []
	for (const candidate of candidates) {
		result.push(candidate)
		if (!candidate.group) continue
		const tours = await lichess(`grupo ${candidate.id}`, async () =>
			((await fetchTourDetail(candidate))?.group?.tours ?? []).map((t) => ({ id: t.id, name: t.name }))
		)
		for (const tour of tours) {
			if (tour.id !== candidate.id) result.push({ ...tour, finished: candidate.finished })
		}
	}
	return result
}

/**
 * Qué retransmisiones hay que leer: las nuevas, las propias que siguen en
 * marcha y las que no tenían españoles cuando terminan. Las enlazadas las
 * relee la sincronización de info64; las duplicadas no se tocan.
 */
export function selectTours(
	candidates: BroadcastCandidate[],
	known: LichessTour[],
	force: boolean
): BroadcastCandidate[] {
	const byId = new Map(known.map((k) => [k.tourId, k]))
	const seen = new Set<string>()
	return candidates.filter((candidate) => {
		if (seen.has(candidate.id)) return false
		seen.add(candidate.id)
		const tour = byId.get(candidate.id)
		if (!tour || force) return true
		if (tour.finished) return false
		if (tour.status === 'propio') return true
		return tour.status === 'sin_espanoles' && candidate.finished
	})
}

/**
 * Dónde van las partidas: al torneo de info64 si lo hay y no tiene partidas
 * (o sólo las de esta retransmisión), a ninguno si ya las tiene, y a uno
 * propio si no está en info64.
 */
export function decide(
	match: Info64Match | null,
	espPlayers: number,
	tourId: string
): { status: Exclude<LichessTourStatus, 'sin_espanoles'>; tournamentId: number | null } {
	if (!match || match.overlap < MIN_OVERLAP || match.overlap < espPlayers * MIN_OVERLAP_SHARE) {
		return { status: 'propio', tournamentId: null }
	}
	const ref = match.gamesSourceUrl ? parseBroadcastUrl(match.gamesSourceUrl) : null
	const ours = ref?.kind === 'tour' && ref.id === tourId
	return { status: match.gamesSource && !ours ? 'duplicado' : 'enlazado', tournamentId: match.id }
}

/** Lo que se sabe de una retransmisión tras pedir sus jugadores. */
interface ListedPlayers {
	/** later: aún sin jugadores, se mira otro día; none: sin españoles; go: hay que leerla. */
	verdict: 'later' | 'none' | 'go'
	/** null si lichess no da la lista: los españoles se buscan en el PGN. */
	players: BroadcastPlayer[] | null
	spanish: number[] | null
	/** Con none: era un torneo propio y se ha conservado (discard). */
	kept?: boolean
}

/** Torneo de la retransmisión, con lo que se guarda de él. */
export interface TourInfo {
	tour: BroadcastTour
	finished: boolean
}

/**
 * Datos del torneo: por una de sus rondas si se conoce, porque lichess limita
 * mucho menos ese endpoint, y si no (los demás torneos de un grupo, `tours`),
 * por el del torneo.
 */
function fetchTourDetail(candidate: BroadcastCandidate): Promise<BroadcastDetail | BroadcastRoundDetail | null> {
	return candidate.round ? fetchRound(candidate.round) : fetchTour(candidate.id)
}

/**
 * Lo que se guarda del torneo. Está terminado si lo dice el listado, si lo
 * están todas sus rondas (sólo las da el endpoint del torneo) o si ya pasó su
 * último día.
 */
export function tourInfo(detail: BroadcastDetail | BroadcastRoundDetail, listedFinished: boolean, now: number): TourInfo {
	const { id, name, url, dates, teamTable, info } = detail.tour
	const rounds = 'rounds' in detail ? detail.rounds : []
	const last = dates?.[1] ?? dates?.[0]
	return {
		tour: { id, name, url, dates, teamTable, info: { tc: info?.tc, fideTC: info?.fideTC, location: info?.location } },
		finished:
			listedFinished ||
			(rounds.length > 0 && rounds.every((r) => r.finished)) ||
			(last !== undefined && last + DAY_MS < now)
	}
}

/**
 * Lee una retransmisión, decide qué es y guarda sus partidas. Son hasta tres
 * peticiones (jugadores, torneo y PGN), cada una en su paso; dos si ya se
 * tienen los datos del torneo (`preloaded`, los de la carga inicial).
 */
export async function syncTour(
	db: D1Database,
	candidate: BroadcastCandidate,
	lichess: LichessRequest,
	preloaded?: TourInfo
): Promise<TourSummary> {
	const skip = (status: LichessTourStatus | null): TourSummary => ({ status, games: 0, espPlayers: 0 })
	// Los jugadores filtran sin bajar el PGN: la mayoría no tiene españoles.
	const listed = await lichess(`jugadores ${candidate.id}`, () => checkPlayers(db, candidate))
	if (listed.verdict === 'later') return skip(null)
	if (listed.verdict === 'none') return listed.kept ? { ...skip('propio'), avisos: 1 } : skip('sin_espanoles')
	const info = preloaded ?? (await lichess(`torneo ${candidate.id}`, () => loadTour(db, candidate)))
	if (!info) return skip('sin_espanoles')
	// De menores (con tours, sólo ahora se sabe su nombre): no se guarda ni se apunta.
	if (isMinorsTournament(info.tour.name, dayOf(info.tour.dates?.[0]))) return skip(null)
	return lichess(`partidas ${candidate.id}`, () => syncTourGames(db, candidate, info, listed))
}

/**
 * Sin españoles (o ya no existe): se apunta para no volver a pedirla. Si era
 * un torneo propio, se conserva tal cual, con sus partidas (una lista sin
 * españoles o una retransmisión borrada no dicen que las guardadas estén mal),
 * y devuelve true para avisar.
 */
async function discard(db: D1Database, candidate: BroadcastCandidate, finished: boolean): Promise<boolean> {
	const [previous] = await loadLichessTours(db, [candidate.id])
	const now = new Date().toISOString()
	if (previous?.status === 'propio') {
		console.warn(`[lichess] ${candidate.id}: el torneo propio ya no trae españoles; se conserva`)
		await saveLichessTour(db, { ...previous, finished: previous.finished || finished }, now)
		return true
	}
	await saveLichessTour(
		db,
		{
			tourId: candidate.id,
			name: candidate.name,
			url: previous?.url ?? null,
			status: 'sin_espanoles',
			tournamentId: null,
			espPlayers: 0,
			finished
		},
		now
	)
	return false
}

async function checkPlayers(db: D1Database, candidate: BroadcastCandidate): Promise<ListedPlayers> {
	const listed = await fetchTourPlayers(candidate.id)
	if (!listed) return { verdict: 'go', players: null, spanish: null }
	// Sin jugadores todavía (aún no ha empezado): se mira otro día.
	if (listed.length === 0 && !candidate.finished) return { verdict: 'later', players: null, spanish: null }
	// Sólo lo que se usa: la lista trae también puntos, desempates…
	const players = listed.map(({ name, fideId, fed, rating, title, team }) => ({ name, fideId, fed, rating, title, team }))
	const ids = players.map((p) => p.fideId).filter((id): id is number => typeof id === 'number')
	const spanish = [
		...new Set([
			...(await spanishFideIds(db, ids)),
			...players.filter((p) => p.fed === 'ESP' && p.fideId).map((p) => p.fideId as number)
		])
	]
	if (spanish.length > 0) return { verdict: 'go', players, spanish }
	const kept = await discard(db, candidate, candidate.finished)
	return { verdict: 'none', players: null, spanish: null, kept }
}

async function loadTour(db: D1Database, candidate: BroadcastCandidate): Promise<TourInfo | null> {
	const detail = await fetchTourDetail(candidate)
	if (!detail) {
		// Borrada o privada: no hay nada que leer, ni ahora ni después.
		await discard(db, candidate, true)
		return null
	}
	return tourInfo(detail, candidate.finished, Date.now())
}

async function syncTourGames(
	db: D1Database,
	candidate: BroadcastCandidate,
	{ tour, finished }: TourInfo,
	{ players, spanish: listedSpanish }: ListedPlayers
): Promise<TourSummary> {
	const now = new Date().toISOString()
	const [previous] = await loadLichessTours(db, [candidate.id])
	const record = (row: LichessTour) => saveLichessTour(db, row, now)
	const skip = (status: LichessTourStatus): TourSummary => ({ status, games: 0, espPlayers: 0 })
	const pgn = await fetchBroadcastPgn(candidate.id)
	if (pgn === null) return skip((await discard(db, candidate, true)) ? 'propio' : 'sin_espanoles')
	// Sin lista de jugadores, los españoles se buscan en las cabeceras.
	const spanish = new Set(listedSpanish ?? (await spanishFideIds(db, pgnFideIds(pgn))))

	const games = gamesWithPlayers(pgn, spanish).filter((g) => g.plyCount > 0)
	const espPlayers = spanishIn(games, spanish)
	const base = { tourId: tour.id, name: tour.name, url: tour.url, espPlayers: espPlayers.length, finished }
	if (games.length === 0) {
		// Un torneo propio que de pronto no trae partidas con españoles (el PGN
		// sin las cabeceras FideId, una ronda reiniciada) se conserva.
		if (previous?.status === 'propio') {
			console.warn(`[lichess] ${candidate.id}: la relectura no trae partidas con españoles; se conserva el torneo propio`)
			await record({ ...previous, finished: previous.finished || finished })
			return { ...skip('propio'), avisos: 1 }
		}
		await record({ ...base, status: 'sin_espanoles', tournamentId: null })
		return skip('sin_espanoles')
	}

	const [from, to] = dateRange(tour, games)
	const match = await findInfo64Tournament(
		db,
		espPlayers,
		addDays(from, -MATCH_MARGIN_DAYS),
		addDays(to, MATCH_MARGIN_DAYS)
	)
	const decision = decide(match, espPlayers.length, tour.id)
	// Era propio y ahora info64 lo tiene (lo ha publicado después): fuera el propio.
	if (previous?.status === 'propio' && previous.tournamentId && decision.status !== 'propio') {
		await deleteLichessTournament(db, previous.tournamentId)
	}

	if (decision.status === 'duplicado') {
		await record({ ...base, ...decision })
		return { status: 'duplicado', games: 0, espPlayers: espPlayers.length }
	}
	if (decision.status === 'enlazado') {
		const { games: saved, kept } = await saveLinkedGames(db, decision.tournamentId as number, pgn, tour.url, now)
		// Si no casa ninguna partida con sus participantes, mejor no enlazarla.
		// Si la guarda de saveGames ha conservado las guardadas, sigue enlazada.
		const status = saved > 0 || kept ? 'enlazado' : 'duplicado'
		await record({ ...base, ...decision, status })
		return { status, games: saved, espPlayers: espPlayers.length, avisos: Number(kept) }
	}
	return saveOwnTournament(db, { tour, games, players, spanish, from, to, previous, now, base })
}

/** FIDE ID de los españoles que juegan esas partidas. */
function spanishIn(games: ParsedGame[], spanish: ReadonlySet<number>): number[] {
	const ids = new Set<number>()
	for (const game of games) {
		for (const color of ['White', 'Black'] as const) {
			const id = Number(game.game.headers.get(`${color}FideId`))
			if (spanish.has(id)) ids.add(id)
		}
	}
	return [...ids]
}

/** Día (YYYY-MM-DD) de unos milisegundos de la API, o null si no es una fecha verosímil. */
function dayOf(ms: number | undefined): string | null {
	const date = new Date(ms ?? Number.NaN)
	return Number.isNaN(date.getTime()) ? null : validDate(isoDate(date))
}

/** Primer y último día: los del torneo y, si no los da, los de las partidas. */
function dateRange(tour: BroadcastTour, games: ParsedGame[]): [string, string] {
	const dates = games
		.map((g) => g.date)
		.filter((d): d is string => d !== null)
		.sort()
	const start = dayOf(tour.dates?.[0])
	const end = dayOf(tour.dates?.[1]) ?? start
	const today = isoDate(new Date())
	return [start ?? dates[0] ?? today, end ?? dates.at(-1) ?? today]
}

/**
 * Partidas de la retransmisión en el torneo de info64, como hace la
 * sincronización de info64 con las que enlaza (info64/sync.ts): todas las de
 * sus participantes, no sólo las de españoles. `kept`: la guarda de saveGames
 * ha conservado las que ya tenía.
 */
async function saveLinkedGames(
	db: D1Database,
	tournamentId: number,
	pgn: string,
	url: string,
	now: string
): Promise<{ games: number; kept: boolean }> {
	const participants = await loadParticipants(db, tournamentId)
	const context = await loadTournamentContext(db, tournamentId)
	if (!context) return { games: 0, kept: false }
	const rows = buildGameRows(gamesOfTournament(parseGames(pgn), participants), participants, context)
	if (rows.length === 0) return { games: 0, kept: false }
	if (await saveGames(db, tournamentId, rows, now, { name: SOURCE, url })) return { games: rows.length, kept: false }
	console.warn(`[lichess] torneo ${tournamentId}: la retransmisión trae menos de la mitad de las partidas guardadas; se conservan`)
	return { games: 0, kept: true }
}

interface OwnTournamentInput {
	tour: BroadcastTour
	games: ParsedGame[]
	players: BroadcastPlayer[] | null
	spanish: ReadonlySet<number>
	from: string
	to: string
	previous: LichessTour | undefined
	now: string
	base: Omit<LichessTour, 'status' | 'tournamentId'>
}

/** Torneo que no está en info64: se guarda con las partidas en las que juega algún español. */
async function saveOwnTournament(db: D1Database, input: OwnTournamentInput): Promise<TourSummary> {
	const { tour, players, spanish, previous, now, base } = input
	const context: TournamentContext = {
		name: tour.name,
		city: tour.info?.location?.trim() || null,
		startDate: input.from,
		timeControl: tournamentTimeControl(tour)
	}
	const participants = broadcastParticipants(input.games, players, spanish)
	let rows = buildGameRows(input.games, participants, context)
	// La misma partida puede estar ya en otro torneo (en info64 con otro
	// nombre, o en otra retransmisión): no se repite.
	const ownId = previous?.status === 'propio' ? previous.tournamentId : null
	const keyed = rows.flatMap((r, i) =>
		r.whiteFideId && r.blackFideId && r.date ? [{ i, key: { white: r.whiteFideId, black: r.blackFideId, date: r.date } }] : []
	)
	const elsewhere = await gamesStoredElsewhere(
		db,
		ownId,
		keyed.map((k) => k.key)
	)
	const repeated = new Set([...elsewhere].map((j) => keyed[j].i))
	rows = rows.filter((_, i) => !repeated.has(i))
	if (rows.length === 0) {
		if (ownId) await deleteLichessTournament(db, ownId)
		await saveLichessTour(db, { ...base, status: 'duplicado', tournamentId: null }, now)
		return { status: 'duplicado', games: 0, espPlayers: base.espPlayers }
	}

	const id = await upsertTournament(db, {
		source: SOURCE,
		key: tour.id,
		type: tour.teamTable ? 'team' : 'individual',
		name: tour.name,
		city: context.city,
		startDate: input.from,
		endDate: input.to,
		timeControl: context.timeControl,
		url: tour.url,
		syncedAt: now
	})
	// Si lo parece, se apunta para revisarlo, como en info64. Las que se enlazan
	// a un torneo de info64 ya las apunta su pasada.
	if (looksSensitive(tour.name)) await proposeSensitive(db, [{ source: SOURCE, key: tour.id, name: tour.name }])
	// Primero las partidas: si la guarda de saveGames conserva las guardadas,
	// los participantes tampoco cambian.
	if (!(await saveGames(db, id, rows, now, { name: SOURCE, url: tour.url }))) {
		console.warn(`[lichess] ${tour.id}: la relectura trae menos de la mitad de las partidas guardadas; se conservan`)
		await saveLichessTour(db, { ...base, status: 'propio', tournamentId: id }, now)
		return { status: 'propio', games: 0, espPlayers: base.espPlayers, avisos: 1 }
	}
	// Los nombres de las filas ya van sin el año de los menores: los de los
	// participantes se comparan igual.
	const named = new Set(rows.flatMap((r) => [r.whiteName, r.blackName].map(normalizeName)))
	await replaceParticipations(
		db,
		id,
		participants.filter((p) => named.has(normalizeName(publicName(p.name))))
	)
	await saveLichessTour(db, { ...base, status: 'propio', tournamentId: id }, now)
	return { status: 'propio', games: rows.length, espPlayers: base.espPlayers }
}

/**
 * Ritmo del torneo: el texto de la retransmisión si trae cifras
 * ("90 min + 30 sec / move") y, si no, la clase FIDE, que también da la
 * cabecera TimeControl de cada partida si la trae.
 */
export function tournamentTimeControl(tour: BroadcastTour): string | null {
	const text = tour.info?.tc?.trim() || null
	if (text && /\d/.test(text)) return text
	const fide = tour.info?.fideTC
	return fide ? TIME_CLASS_LABEL[fide] : text
}

/**
 * Participantes de un torneo propio: los jugadores de esas partidas, con los
 * datos de la lista de la retransmisión (federación, título, ELO, equipo) si
 * la hay. Se numeran por ELO, como un ranking inicial; en los torneos por
 * equipos, dentro de cada equipo.
 */
export function broadcastParticipants(
	games: ParsedGame[],
	players: BroadcastPlayer[] | null,
	spanish: ReadonlySet<number>
): TournamentPlayer[] {
	const byFideId = new Map((players ?? []).filter((p) => p.fideId).map((p) => [p.fideId as number, p]))
	const byKey = new Map<string, Omit<TournamentPlayer, 'startRank'>>()
	for (const game of games) {
		const headers = game.game.headers
		for (const color of ['White', 'Black'] as const) {
			const name = color === 'White' ? game.white : game.black
			const fideId = Number.parseInt(headers.get(`${color}FideId`) ?? '', 10) || null
			const listed = fideId ? byFideId.get(fideId) : undefined
			const key = fideId ? `#${fideId}` : normalizeName(name)
			if (!name || byKey.has(key)) continue
			// Como en info64: un ELO inverosímil no se guarda (games.ts cuenta con
			// que el de los participantes ya viene filtrado).
			const rating =
				plausibleRating(listed?.rating) ?? plausibleRating(Number.parseInt(headers.get(`${color}Elo`) ?? '', 10))
			byKey.set(key, {
				name: listed?.name ?? name,
				fideId,
				title: listed?.title ?? headers.get(`${color}Title`) ?? null,
				rating,
				fed: listed?.fed ?? (fideId && spanish.has(fideId) ? 'ESP' : null),
				team: listed?.team ?? headers.get(`${color}Team`) ?? null
			})
		}
	}
	const sorted = [...byKey.values()].sort(
		(a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name, 'es')
	)
	const ranks = new Map<string, number>()
	return sorted.map((p) => {
		const team = p.team ?? ''
		const rank = (ranks.get(team) ?? 0) + 1
		ranks.set(team, rank)
		return { ...p, startRank: rank }
	})
}
