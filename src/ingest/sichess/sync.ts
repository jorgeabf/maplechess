// Workflow SICHESS_IMPORT: añade a torneos de info64 ya guardados las partidas
// que info64 no publica y sí están en SICHESS (torneos.ts). Se lanza a mano
// (`{"workflow":"sichess"}`), sin cron: es una lista cerrada. Relanzarlo relee
// la lista y no duplica nada, porque saveGames conserva los id de las partidas.
//
// Sólo escribe partidas: el torneo, sus participantes y su clasificación siguen
// siendo los de info64. Las mismas funciones que en info64 quitan el año de los
// menores de los nombres y aplican las retiradas, las ocultaciones y las
// rectificaciones. Lo que ya tiene partidas de otra fuente no se toca.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers'
import { eventHeaders, parseGames, parsePgnDate, type ParsedGame } from '../../lib/chess/pgn'
import { buildGameRows, type Participant } from '../games'
import { fetchText } from '../http'
import { msUntilInfo64Hours } from '../info64/sync'
import { gamesOfTournament } from '../lichess/api'
import { isListedMinors, isMinorsTournament } from '../menores'
import { RETIRED_NAME } from '../nombres'
import { loadExcluded, loadParticipants, saveGames } from '../repo'
import { isListedCopy } from '../repetidos'
import { SICHESS_TOURNAMENTS, type SichessTournament } from './torneos'

/** La fuente de los torneos: SICHESS sólo pone las partidas. */
const SOURCE = 'info64'
const GAMES_SOURCE = 'sichess'

export interface SichessImportParams {
	/** Sólo estos torneos (SichessTournament.key); sin él, todos. */
	keys?: string[]
}

export interface SichessSummary {
	tournaments: number
	games: number
	/** FIDE ID de las partidas guardadas: dos por partida si cruzan todos. */
	identified: number
	/** Partidas con alguna jugada ilegal, cortadas ahí. */
	illegal: number
	/** Torneos que no se han leído (ver loadTarget). */
	skipped: number
	/** Lecturas que no se guardan (ver importTournament). */
	avisos: number
}

/** La salida de la instancia: lo que hay que mirar al acabar la carga. */
export interface SichessResult extends SichessSummary {
	/** Torneos que han fallado tras sus reintentos: se relanzan con `keys`. */
	failed: string[]
}

const EMPTY: SichessSummary = { tournaments: 0, games: 0, identified: 0, illegal: 0, skipped: 0, avisos: 0 }

const TOURNAMENT_STEP: WorkflowStepConfig = {
	retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
	timeout: '5 minutes'
}

/** Entre torneo y torneo y entre archivo y archivo: como mucho una petición por segundo. */
const PAUSE = '1 second'
const PAUSE_MS = 1000

export class SichessImportWorkflow extends WorkflowEntrypoint<Env, SichessImportParams> {
	async run(event: WorkflowEvent<SichessImportParams>, step: WorkflowStep): Promise<SichessResult> {
		// Lanzada a otra hora, espera a la madrugada, como las de info64.
		const wait = await step.do('franja de madrugada', async () => msUntilInfo64Hours(new Date()))
		if (wait > 0) await step.sleep('espera a la madrugada', wait)
		const only = event.payload?.keys
		const tournaments = only ? SICHESS_TOURNAMENTS.filter((t) => only.includes(t.key)) : SICHESS_TOURNAMENTS
		const totals = { ...EMPTY }
		const failed: string[] = []
		for (const [i, entry] of tournaments.entries()) {
			if (i > 0) await step.sleep(`pausa ${entry.key}`, PAUSE)
			// Un torneo que falla tras sus reintentos no para los demás.
			try {
				const summary = await step.do(`torneo ${entry.key}`, TOURNAMENT_STEP, async () => {
					const target = await loadTarget(this.env.DB, entry.key)
					if (!target) return { ...EMPTY, skipped: 1 }
					return importTournament(this.env.DB, target, entry, await fetchFiles(entry.files), new Date().toISOString())
				})
				for (const k of Object.keys(totals) as (keyof SichessSummary)[]) totals[k] += summary[k]
			} catch (error) {
				failed.push(entry.key)
				console.error(`[sichess] ${entry.key}: ${String(error)}`)
			}
		}
		console.log(`[sichess] ${tournaments.length} torneos, ${failed.length} fallidos: ${JSON.stringify(totals)}`)
		return { ...totals, failed }
	}
}

/** Los PGN de un torneo, de uno en uno. Con uno que falle, falla el paso: nunca se guarda un torneo a medias. */
async function fetchFiles(urls: string[]): Promise<string[]> {
	const texts: string[] = []
	for (const url of urls) {
		if (texts.length > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
		texts.push(await fetchText(url))
	}
	return texts
}

/** Lo que hace falta del torneo guardado para cruzar sus partidas. */
export interface StoredTournament {
	id: number
	name: string
	city: string | null
	startDate: string | null
	timeControl: string | null
	participants: Participant[]
}

/**
 * El torneo de info64 al que se le pueden añadir partidas; null si no está, si
 * no se guarda (sensible, de menores o repetido), si ya tiene partidas de otra
 * fuente, que mandan: info64 o lichess pueden haberlas publicado después, o si
 * no se pueden cruzar sin riesgo: sin participantes, o con un jugador retirado.
 * Los participantes guardados ya están saneados y, sin FIDE ID en el PGN, al
 * retirado no se le reconocería en sus partidas: saldrían con su nombre.
 */
export async function loadTarget(db: D1Database, key: string): Promise<StoredTournament | null> {
	const row = await db
		.prepare(
			`SELECT id, name, city, start_date AS startDate, time_control AS timeControl,
				games_count AS gamesCount, games_source AS gamesSource
			FROM tournaments WHERE source = ?1 AND source_key = ?2`
		)
		.bind(SOURCE, key)
		.first<StoredTournament & { gamesCount: number; gamesSource: string | null }>()
	if (!row) {
		console.warn(`[sichess] ${key}: no está guardado`)
		return null
	}
	const excluded = await loadExcluded(db, SOURCE)
	if (
		excluded.has(key) ||
		isListedMinors(SOURCE, key) ||
		isListedCopy(key) ||
		isMinorsTournament(row.name, row.startDate)
	) {
		console.warn(`[sichess] ${key}: no se guarda`)
		return null
	}
	if (row.gamesCount > 0 && row.gamesSource !== GAMES_SOURCE) {
		console.warn(`[sichess] ${key}: ya tiene ${row.gamesCount} partidas de ${row.gamesSource}`)
		return null
	}
	const participants = await loadParticipants(db, row.id)
	if (participants.length === 0 || participants.some((p) => p.name === RETIRED_NAME)) {
		console.warn(`[sichess] ${key}: sin participantes o con un jugador retirado; no se lee`)
		return null
	}
	const { id, name, city, startDate, timeControl } = row
	return { id, name, city, startDate, timeControl, participants }
}

/**
 * Cada partida, con el día de su ronda: el más repetido entre las suyas (a igual
 * número, el primero). Su cabecera no basta: en la Primera de 2025, Date es el primer
 * día en todas, y UTCDate, que acierta, falla en una por ronda; en la de 2024, cuatro
 * por ronda se quedan en el primer día.
 */
function withRoundDays(games: ParsedGame[]): ParsedGame[] {
	const rounds = new Map<number, Map<string, number>>()
	for (const game of games) {
		const day = parsePgnDate(game.game.headers.get('UTCDate')) ?? game.date
		if (!day) continue
		const days = rounds.get(game.round) ?? new Map<string, number>()
		rounds.set(game.round, days.set(day, (days.get(day) ?? 0) + 1))
	}
	const roundDay = new Map(
		[...rounds].map(([round, days]) => [round, [...days].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0][0]])
	)
	return games.map((game) => ({ ...game, date: roundDay.get(game.round) ?? game.date }))
}

/**
 * Guarda las partidas de un torneo ya descargadas: las que tienen jugadas y algún
 * participante (gamesOfTournament), con el visor en la cabecera Source. No se
 * guarda nada si algún PGN trae menos partidas leídas que cabeceras Event (una
 * llave sin cerrar se traga el resto) o si no queda ninguna. Puede traer más: en
 * los de equipos, alguna partida viene sin Event.
 */
export async function importTournament(
	db: D1Database,
	target: StoredTournament,
	entry: SichessTournament,
	pgnTexts: string[],
	now: string
): Promise<SichessSummary> {
	const read = pgnTexts.map(parseGames)
	const cut = pgnTexts.findIndex((text, i) => read[i].length < eventHeaders(text))
	if (cut !== -1) {
		console.warn(`[sichess] ${entry.key}: ${entry.files[cut]} no se lee entero; no se guarda`)
		return { ...EMPTY, avisos: 1 }
	}
	const { participants } = target
	const games = gamesOfTournament(read.flat(), participants)
	if (games.length === 0) {
		console.warn(`[sichess] ${entry.key}: sin partidas de sus participantes; no se guarda`)
		return { ...EMPTY, avisos: 1 }
	}
	for (const game of games) game.game.headers.set('Source', entry.viewer)
	const rows = buildGameRows(withRoundDays(games), participants, target)
	if (!(await saveGames(db, target.id, rows, now, { name: GAMES_SOURCE, url: entry.viewer }))) {
		console.warn(`[sichess] ${entry.key}: la lectura trae menos de la mitad de las partidas guardadas; se conservan`)
		return { ...EMPTY, avisos: 1 }
	}
	return {
		...EMPTY,
		tournaments: 1,
		games: rows.length,
		identified: rows.reduce((n, r) => n + Number(r.whiteFideId !== null) + Number(r.blackFideId !== null), 0),
		illegal: games.filter((g) => g.illegalAt !== undefined).length
	}
}
