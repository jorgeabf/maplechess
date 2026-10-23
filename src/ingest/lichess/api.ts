// Retransmisiones de lichess (https://lichess.org/api#tag/broadcasts).
//
// Muchos torneos de info64 no publican el PGN pero enlazan su retransmisión en
// lichess, cuyo PGN es completo (FIDE ID, ELO, ECO, reloj); y lichess
// retransmite torneos con españoles que no están en info64 (sync.ts). Normas
// de la API: una petición cada vez y, ante un 429, esperar al menos un minuto;
// las peticiones van de una en una dentro de un paso del Workflow y los
// reintentos de ese paso empiezan en un minuto.
//
// Las partidas de las retransmisiones tienen licencia CC BY-SA 4.0
// (https://database.lichess.org/#broadcasts): la web lo indica donde salen.
import { env, type WorkflowStepConfig } from 'cloudflare:workers'
import { matchName, type NameCandidate } from '../../lib/chess/names'
import { parseGames, type ParsedGame } from '../../lib/chess/pgn'
import type { TimeClass } from '../../lib/chess/timecontrol'
import type { Participant } from '../games'
import { fetchOk, HttpError } from '../http'

export const LICHESS_URL = 'https://lichess.org'

/** Paso que pide a lichess: tras un 429 hay que esperar al menos un minuto. */
export const LICHESS_STEP: WorkflowStepConfig = {
	retries: { limit: 4, delay: '1 minute', backoff: 'exponential' },
	timeout: '5 minutes'
}

/** Identificador de torneo o de ronda: 8 caracteres alfanuméricos. */
const ID = /^[A-Za-z0-9]{8}$/

export type BroadcastRef = { kind: 'tour'; id: string } | { kind: 'round'; id: string }

/**
 * Qué identifica una URL de retransmisión:
 * - /broadcast/{torneo}/{idTorneo}
 * - /broadcast/{torneo}/{ronda}/{idRonda}[/{idPartida}]
 */
export function parseBroadcastUrl(url: string): BroadcastRef | null {
	let path: string[]
	try {
		path = new URL(url).pathname.split('/').filter(Boolean)
	} catch {
		return null
	}
	if (path[0] !== 'broadcast') return null
	if (path.length === 3 && ID.test(path[2])) return { kind: 'tour', id: path[2] }
	if (path.length >= 4 && ID.test(path[3])) return { kind: 'round', id: path[3] }
	return null
}

/**
 * Cabeceras de las peticiones a lichess: un token de lichess de sólo lectura
 * (secreto LICHESS_TOKEN, sólo study:read). La API de retransmisiones limita
 * mucho las peticiones anónimas y anuncia que dejará de responderlas
 * (lichess-org/lila#21283); con token, 120 por minuto. Sin él (en local, sin
 * .dev.vars), se pide como anónimo. Sólo va a lichess, nunca a info64.
 */
function lichessHeaders(): HeadersInit {
	const token = env.LICHESS_TOKEN
	return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchOrNull(url: string): Promise<Response | null> {
	try {
		return await fetchOk(url, { headers: lichessHeaders() })
	} catch (error) {
		// Retransmisión borrada o privada: se trata como si no hubiera.
		if (error instanceof HttpError && error.status === 404) return null
		throw error
	}
}

async function fetchJson<T>(url: string): Promise<T | null> {
	const response = await fetchOrNull(url)
	return response ? ((await response.json()) as T) : null
}

/** Id del torneo de lichess; para un enlace a una ronda se pregunta a la API. */
export async function resolveTourId(ref: BroadcastRef): Promise<string | null> {
	if (ref.kind === 'tour') return ref.id
	const data = await fetchRound(ref.id)
	return data?.tour?.id && ID.test(data.tour.id) ? data.tour.id : null
}

/** PGN de todas las rondas del torneo, o null si la retransmisión no existe. */
export async function fetchBroadcastPgn(tourId: string): Promise<string | null> {
	const response = await fetchOrNull(`${LICHESS_URL}/api/broadcast/${tourId}.pgn`)
	return response ? response.text() : null
}

/**
 * Partidas de la retransmisión que son de este torneo: con jugadas y con al
 * menos un participante del torneo (por FIDE ID o por nombre). Así un enlace a
 * otro grupo del mismo festival no mete partidas ajenas. Sin lista de
 * participantes no hay con qué filtrar y se aceptan todas.
 */
export function gamesOfTournament(games: ParsedGame[], participants: Participant[]): ParsedGame[] {
	const played = games.filter((g) => g.plyCount > 0)
	if (participants.length === 0) return played
	const fideIds = new Set(participants.map((p) => p.fideId).filter((id): id is number => id !== null))
	const candidates: NameCandidate<true>[] = participants.map((p) => ({ name: p.name, value: true }))
	const isParticipant = (game: ParsedGame, color: 'White' | 'Black') => {
		const fideId = Number.parseInt(game.game.headers.get(`${color}FideId`) ?? '', 10)
		if (fideIds.has(fideId)) return true
		return matchName(color === 'White' ? game.white : game.black, candidates) === true
	}
	return played.filter((g) => isParticipant(g, 'White') || isParticipant(g, 'Black'))
}

// --- Retransmisiones oficiales con jugadores españoles (sync.ts) ---

/** Torneo de una retransmisión, con lo que se usa de la API. */
export interface BroadcastTour {
	id: string
	name: string
	url: string
	/** Inicio y, si lo hay, fin, en milisegundos. */
	dates?: number[]
	teamTable?: boolean
	info?: {
		/** Ritmo en texto libre ("90 min + 30 sec / move", "Classical"). */
		tc?: string
		fideTC?: TimeClass
		location?: string
	}
}

/** GET /api/broadcast/{id}: el torneo, sus rondas y, si es de un grupo, los torneos del grupo. */
export interface BroadcastDetail {
	tour: BroadcastTour
	rounds: { id: string; finished?: boolean }[]
	group?: { tours: { id: string; name: string }[] }
}

/**
 * GET /api/broadcast/-/-/{idRonda}: la ronda, su torneo y, si es de un grupo,
 * los torneos del grupo. Da del torneo lo mismo que GET /api/broadcast/{id}
 * salvo las demás rondas, y lichess lo limita mucho menos: a una petición cada
 * 6 s, ningún 429 en 285 peticiones, frente a uno cada tres minutos del otro.
 */
export interface BroadcastRoundDetail {
	tour: BroadcastTour
	round: { id: string; finished?: boolean }
	group?: { tours: { id: string; name: string }[] }
}

/** Jugador de GET /broadcast/{id}/players. */
export interface BroadcastPlayer {
	name: string
	fideId?: number
	fed?: string
	rating?: number
	title?: string
	team?: string
}

interface TopEntry {
	tour: { id: string; name: string }
	round?: { id?: string; finishedAt?: number; startsAt?: number }
	/** Nombre del grupo: el listado muestra un único torneo de cada grupo. */
	group?: string
}

/** GET /api/broadcast/top: las activas (sólo en la página 1) y las terminadas, de la más reciente a la más antigua. */
export interface TopPage {
	active: TopEntry[]
	past: { currentPageResults: TopEntry[]; nextPage: number | null }
}

/** Retransmisión que hay que mirar: activa o terminada hace poco. */
export interface BroadcastCandidate {
	id: string
	name: string
	finished: boolean
	/** Es uno de los torneos de un grupo: hay que pedir los demás. */
	group?: boolean
	/** Una de sus rondas: con ella se piden los datos del torneo (ver BroadcastRoundDetail). */
	round?: string
}

/**
 * Páginas de terminadas que da la API, unos 22 días. La documentación dice
 * 20, pero la 6 responde 400 (19-oct-2026). Lo anterior está en los volcados
 * mensuales (scripts/lichess-rondas.mjs).
 */
export const TOP_MAX_PAGES = 5

/** Una página del listado, o null si la API ya no da más. */
export async function fetchTopPage(page: number): Promise<TopPage | null> {
	try {
		return await fetchJson<TopPage>(`${LICHESS_URL}/api/broadcast/top?page=${page}`)
	} catch (error) {
		// Pasada la última página, la API responde 400, no 404.
		if (error instanceof HttpError && error.status === 400) return null
		throw error
	}
}

export function fetchRound(roundId: string): Promise<BroadcastRoundDetail | null> {
	// La API acepta "-" en lugar de los slugs del torneo y la ronda.
	return fetchJson<BroadcastRoundDetail>(`${LICHESS_URL}/api/broadcast/-/-/${roundId}`)
}

export function fetchTour(tourId: string): Promise<BroadcastDetail | null> {
	return fetchJson<BroadcastDetail>(`${LICHESS_URL}/api/broadcast/${tourId}`)
}

export function fetchTourPlayers(tourId: string): Promise<BroadcastPlayer[] | null> {
	return fetchJson<BroadcastPlayer[]>(`${LICHESS_URL}/broadcast/${tourId}/players`)
}

/**
 * Retransmisiones de una página del listado: las activas y las terminadas
 * desde `since` (milisegundos). `more` dice si la página siguiente puede traer
 * más terminadas en ese plazo.
 */
export function topCandidates(page: TopPage, since: number): { candidates: BroadcastCandidate[]; more: boolean } {
	const candidate = (entry: TopEntry, finished: boolean): BroadcastCandidate => ({
		id: entry.tour.id,
		name: entry.tour.name,
		finished,
		...(entry.group ? { group: true } : {}),
		...(entry.round?.id ? { round: entry.round.id } : {})
	})
	const past = page.past.currentPageResults.filter((e) => (e.round?.finishedAt ?? e.round?.startsAt ?? 0) >= since)
	return {
		candidates: [...page.active.map((e) => candidate(e, false)), ...past.map((e) => candidate(e, true))],
		more: past.length > 0 && page.past.nextPage !== null
	}
}

const FIDE_ID_HEADER = /^\[(?:White|Black)FideId "(\d+)"\]/gm

/** FIDE ID de todos los jugadores del PGN, sin parsear las partidas. */
export function pgnFideIds(pgn: string): number[] {
	return [...new Set([...pgn.matchAll(FIDE_ID_HEADER)].map((m) => Number(m[1])))]
}

/**
 * Partidas del PGN en las que juega alguno de esos FIDE ID. Las demás no se
 * parsean: una Olimpiada trae más de mil partidas y sólo interesan unas pocas.
 * Lichess separa las partidas con una línea en blanco antes de las cabeceras.
 */
export function gamesWithPlayers(pgn: string, fideIds: ReadonlySet<number>): ParsedGame[] {
	const chunks = pgn.split(/\r?\n[ \t]*\r?\n(?=\[)/)
	const kept = chunks.filter((chunk) => [...chunk.matchAll(FIDE_ID_HEADER)].some((m) => fideIds.has(Number(m[1]))))
	return kept.length > 0 ? parseGames(kept.join('\n\n')) : []
}
