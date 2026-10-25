// Consultas de partidas.
import type { TimeClass } from '../chess/timecontrol'
import { gamesNameQuery, type Color } from './fts'
import { COUNT_LIMIT, countAndPlan, countSql, offset, PAGE_SIZE, searchPage, toCappedPage, toPage, type Page } from './pagination'

/**
 * 1 si el jugador de la columna `fideIdColumn` (de la consulta que la usa)
 * tiene alguna partida; 0 si no o si no tiene FIDE ID. Para enlazar al dossier
 * sólo a quien tiene partidas. Cada EXISTS lee como mucho una entrada de su
 * índice (games_white, games_black): 2 filas por jugador.
 *
 * La columna, con su tabla ('pa.fide_id', 'pairings.white_fide_id'): dentro
 * del EXISTS, un white_fide_id suelto sería el de games.
 */
export function hasGamesSql(fideIdColumn: string): string {
	return `(${fideIdColumn} IS NOT NULL AND (
		EXISTS (SELECT 1 FROM games g WHERE g.white_fide_id = ${fideIdColumn})
		OR EXISTS (SELECT 1 FROM games g WHERE g.black_fide_id = ${fideIdColumn})))`
}

export interface GameListRow {
	id: number
	date: string | null
	round: number
	board: number
	whiteName: string
	blackName: string
	whiteFideId: number | null
	blackFideId: number | null
	whiteElo: number | null
	blackElo: number | null
	result: string
	eco: string | null
	opening: string | null
	tournamentId: number
	tournamentName: string
}

export interface GameFilters {
	/** Partidas de un jugador concreto (por FIDE ID). */
	fideId?: number | null
	/** Nombre del jugador y del rival (búsqueda por texto). */
	player?: string
	opponent?: string
	/** Color del jugador (de fideId o de `player`). */
	color?: Color
	/** Resultado desde el punto de vista del jugador si hay uno; si no, literal. */
	result?: 'win' | 'draw' | 'loss' | '1-0' | '0-1' | '1/2-1/2' | ''
	eco?: string
	from?: string
	to?: string
	/** Ritmo (sin índice: sólo refina otro filtro). */
	timeClass?: TimeClass | null
	tournamentId?: number | null
	/** Ronda del torneo; 0 son las que no traen ronda en el PGN. */
	round?: number | null
	/** Sólo estas partidas (p. ej. las de una posición del repertorio); vacío no da ninguna. */
	ids?: number[]
}

const LIST_COLUMNS = `g.id, g.date, g.round, g.board, g.white_name AS whiteName, g.black_name AS blackName,
	g.white_fide_id AS whiteFideId, g.black_fide_id AS blackFideId, g.white_elo AS whiteElo,
	g.black_elo AS blackElo, g.result, g.eco, g.opening,
	t.id AS tournamentId, t.name AS tournamentName`

/**
 * Búsquedas: lo más reciente primero. Sin "date IS NULL": en orden DESC SQLite
 * ya deja las que no tienen fecha al final, y así recorre games_date en vez
 * de ordenar todas las coincidencias (/partidas?desde=1000-01-01 leía 397.314
 * filas, y ahora 737). Dentro de un torneo: por ronda y tablero.
 */
const ORDERS = {
	recent: 'ORDER BY g.date DESC, g.tournament_id DESC, g.round, g.board, g.seq',
	round: 'ORDER BY g.round, g.board, g.seq'
} as const

export type GameOrder = keyof typeof ORDERS

export interface GamesWhere {
	sql: string
	params: unknown[]
	/** El nombre es el único filtro: se cuenta en games_fts, sin pasar por games (countGames). */
	namesOnly: boolean
	/**
	 * Cómo leerlas de la más reciente a la más antigua:
	 * - 'own': por el índice de un jugador, un torneo o una lista de partidas,
	 *   que dan pocas, y ordenarlas. Contarlas es barato, así que no son una
	 *   búsqueda con tope: total exacto y todas sus páginas (la ficha);
	 * - 'date': recorriendo games_date, el índice del orden, que ya acota las
	 *   fechas. Con LIMIT 5000 (exportGameIds) SQLite prefería ordenar la tabla
	 *   entera: 264.000 filas, y 10.000 recorriéndolo;
	 * - 'count': las del nombre o el ECO pueden ser decenas o decenas de miles,
	 *   así que lo decide su recuento (countAndPlan).
	 */
	recent: 'own' | 'date' | 'count'
}

/** Traduce los filtros a WHERE. Devuelve también los parámetros en orden. */
export function gamesWhere(f: GameFilters): GamesWhere {
	const where: string[] = []
	const params: unknown[] = []
	const p = (value: unknown) => {
		params.push(value)
		return `?${params.length}`
	}
	const color = f.color ?? 'any'

	if (f.fideId) {
		const id = p(f.fideId)
		if (color === 'white') where.push(`g.white_fide_id = ${id}`)
		else if (color === 'black') where.push(`g.black_fide_id = ${id}`)
		else where.push(`(g.white_fide_id = ${id} OR g.black_fide_id = ${id})`)
	}

	const names = gamesNameQuery(f.player ?? '', f.opponent ?? '', f.fideId ? 'any' : color)
	if (names) where.push(`g.id IN (SELECT rowid FROM games_fts WHERE games_fts MATCH ${p(names)})`)

	if (f.result) {
		if (f.result === 'win' || f.result === 'loss') {
			// Ganar con blancas es 1-0 y con negras 0-1; perder, al revés.
			const asWhite = f.result === 'win' ? '1-0' : '0-1'
			const asBlack = f.result === 'win' ? '0-1' : '1-0'
			if (f.fideId) {
				const id = p(f.fideId)
				where.push(
					`((g.white_fide_id = ${id} AND g.result = '${asWhite}') OR (g.black_fide_id = ${id} AND g.result = '${asBlack}'))`
				)
			} else if (color === 'black') where.push(`g.result = '${asBlack}'`)
			else where.push(`g.result = '${asWhite}'`)
		} else if (f.result === 'draw') {
			where.push(`g.result = '1/2-1/2'`)
		} else {
			where.push(`g.result = ${p(f.result)}`)
		}
	}
	if (f.eco) {
		// Rango de prefijo y no LIKE: LIKE no distingue mayúsculas, así que no usa
		// el índice games_eco (BINARY) y recorre todas las partidas. 'B9' va de
		// 'B9' a 'B:', el carácter que sigue al 9.
		const prefix = f.eco.toUpperCase()
		const next = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)
		where.push(`g.eco >= ${p(prefix)} AND g.eco < ${p(next)}`)
	}
	if (f.from) where.push(`g.date >= ${p(f.from)}`)
	if (f.to) where.push(`g.date <= ${p(f.to)}`)
	if (f.timeClass) where.push(`g.time_class = ${p(f.timeClass)}`)
	if (f.tournamentId) where.push(`g.tournament_id = ${p(f.tournamentId)}`)
	if (f.round != null) where.push(`g.round = ${p(f.round)}`)
	if (f.ids) where.push(`g.id IN (SELECT value FROM json_each(${p(JSON.stringify(f.ids))}))`)

	return {
		sql: where.length ? `WHERE ${where.join(' AND ')}` : '',
		params,
		namesOnly: names !== null && where.length === 1,
		recent: f.fideId || f.tournamentId || f.ids ? 'own' : names || f.eco ? 'count' : 'date'
	}
}

/** La tabla de partidas, recorriendo games_date si `byDate` (walkOrderIndex). */
function gamesFrom(byDate: boolean): string {
	return byDate ? 'games g INDEXED BY games_date' : 'games g'
}

/** Una página de las partidas del WHERE de gamesWhere, sin contarlas. */
function listGames(
	db: D1Database,
	{ sql, params }: GamesWhere,
	page: number,
	order: GameOrder,
	byDate = false
): D1PreparedStatement {
	return db
		.prepare(
			`SELECT ${LIST_COLUMNS} FROM ${gamesFrom(byDate)} JOIN tournaments t ON t.id = g.tournament_id
			${sql} ${ORDERS[order]} LIMIT ${PAGE_SIZE} OFFSET ${offset(page)}`
		)
		.bind(...params)
}

/**
 * De dónde se cuentan las partidas de `where`. Si el nombre es el único
 * filtro, de games_fts, que tiene una fila por partida: con el tope de 10.000,
 * «garcia» leía 10.000 filas así y 35.577 pasando por games con `g.id IN (…)`.
 */
function countFrom({ sql, namesOnly }: GamesWhere): string {
	return namesOnly ? 'FROM games_fts WHERE games_fts MATCH ?1' : `FROM games g ${sql}`
}

/**
 * Una página de partidas, de la más reciente a la más antigua, y cuántas son.
 * Las de un jugador (la ficha), un torneo o una lista: el total exacto y todas
 * sus páginas. Las búsquedas, con tope (COUNT_LIMIT y SEARCH_PAGES); si salen
 * del nombre o del ECO, el recuento va primero y dice si recorrer games_date
 * (countAndPlan).
 */
export async function searchGames(db: D1Database, f: GameFilters, page: number): Promise<Page<GameListRow>> {
	const where = gamesWhere(f)
	if (where.recent === 'own') {
		const [rows, count] = await db.batch<GameListRow | { n: number }>([
			listGames(db, where, page, 'recent'),
			db.prepare(`SELECT count(*) AS n FROM games g ${where.sql}`).bind(...where.params)
		])
		return toPage(rows.results as GameListRow[], (count.results[0] as { n: number }).n, page)
	}
	const at = searchPage(page)
	if (where.recent === 'date') {
		const [rows, count] = await db.batch<GameListRow | { n: number }>([
			listGames(db, where, at, 'recent', true),
			db.prepare(countSql(countFrom(where))).bind(...where.params)
		])
		return toCappedPage(rows.results as GameListRow[], (count.results[0] as { n: number }).n, at)
	}
	const { count, walk } = await countAndPlan(db, countFrom(where), where.params, 'games', offset(at) + PAGE_SIZE)
	const rows = count > offset(at) ? (await listGames(db, where, at, 'recent', walk).all<GameListRow>()).results : []
	return toCappedPage(rows, count, at)
}

/**
 * Cuántas partidas juega alguien con ese nombre, con el tope de las búsquedas
 * (countSql): para ofrecerlas cuando /jugadores no lo encuentra (es de otra
 * federación o el apellido tiene una errata). Una fila por coincidencia de
 * games_fts, como mucho COUNT_LIMIT + 1. Null si el nombre no tiene palabras.
 */
export async function countGamesByName(db: D1Database, name: string): Promise<{ total: number; capped: boolean } | null> {
	const names = gamesNameQuery(name, '', 'any')
	if (!names) return null
	const { n } = (await db.prepare(countSql('FROM games_fts WHERE games_fts MATCH ?1')).bind(names).first<{ n: number }>())!
	return n > COUNT_LIMIT ? { total: COUNT_LIMIT, capped: true } : { total: n, capped: false }
}

export interface RoundGames {
	round: number
	games: number
}

/**
 * Partidas de un torneo, o de una de sus rondas (null, todas), por ronda y
 * tablero, y las rondas que tienen partidas con cuántas tiene cada una. Las
 * rondas recorren el índice único (tournament_id, round, …): una entrada por
 * partida del torneo, lo mismo que contarlas, así que el total sale de ellas.
 */
export async function getTournamentGames(
	db: D1Database,
	tournamentId: number,
	round: number | null,
	page: number
): Promise<{ rounds: RoundGames[]; games: Page<GameListRow> }> {
	const [rows, counts] = await db.batch<GameListRow | RoundGames>([
		listGames(db, gamesWhere({ tournamentId, round }), page, 'round'),
		db
			.prepare('SELECT round, count(*) AS games FROM games WHERE tournament_id = ?1 GROUP BY round ORDER BY round')
			.bind(tournamentId)
	])
	const rounds = counts.results as RoundGames[]
	const total =
		round === null ? rounds.reduce((sum, r) => sum + r.games, 0) : (rounds.find((r) => r.round === round)?.games ?? 0)
	return { rounds, games: toPage(rows.results as GameListRow[], total, page) }
}

/** Máximo de partidas por descarga PGN de un jugador, un torneo o una lista. */
const PGN_EXPORT_LIMIT = 5000

/** Partidas por consulta al leer los PGN (gamesPgn): unos 2 MB. */
const PGN_BATCH = 500

/**
 * Cuántas partidas lleva como mucho la descarga PGN de `f`: la de una
 * búsqueda, las que enseña (COUNT_LIMIT); la de un jugador, un torneo o una
 * lista, hasta PGN_EXPORT_LIMIT.
 */
export function exportLimit(f: GameFilters): number {
	return gamesWhere(f).recent === 'own' ? PGN_EXPORT_LIMIT : COUNT_LIMIT
}

/**
 * Id de las partidas que cumplen los filtros, en el mismo orden que el
 * listado, como mucho exportLimit: la primera fase de una descarga. Salen de
 * los índices sin leer ningún PGN, y así D1 no ordena filas de 4 KB. Las del
 * nombre o el ECO se leen como la última página de su búsqueda (countAndPlan).
 */
export async function exportGameIds(db: D1Database, f: GameFilters, order: GameOrder = 'recent'): Promise<number[]> {
	const where = gamesWhere(f)
	const limit = exportLimit(f)
	const byDate =
		order === 'recent' &&
		(where.recent === 'count'
			? (await countAndPlan(db, countFrom(where), where.params, 'games', limit)).walk
			: where.recent === 'date')
	const { results } = await db
		.prepare(`SELECT g.id FROM ${gamesFrom(byDate)} ${where.sql} ${ORDERS[order]} LIMIT ${limit}`)
		.bind(...where.params)
		.all<{ id: number }>()
	return results.map((r) => r.id)
}

/**
 * PGN de las partidas `ids`, en ese orden, de PGN_BATCH en PGN_BATCH: la
 * descarga los va enviando sin tener los de 5.000 partidas (unos 20 MB) en
 * memoria. Las que ya no existen se saltan. Partiendo de json_each, dos filas
 * por partida; con `id IN (SELECT value FROM json_each(…))`, tres.
 */
export async function* gamesPgn(db: D1Database, ids: number[]): AsyncGenerator<string> {
	for (let start = 0; start < ids.length; start += PGN_BATCH) {
		const batch = ids.slice(start, start + PGN_BATCH)
		const { results } = await db
			.prepare('SELECT g.id, g.pgn FROM json_each(?1) j JOIN games g ON g.id = j.value')
			.bind(JSON.stringify(batch))
			.all<{ id: number; pgn: string }>()
		const pgns = new Map(results.map((r) => [r.id, r.pgn]))
		for (const id of batch) {
			const pgn = pgns.get(id)
			if (pgn !== undefined) yield pgn
		}
	}
}

/** Partidas por id, en cualquier orden (p. ej. las de una posición del repertorio). */
export async function getGamesByIds(db: D1Database, ids: number[]): Promise<GameListRow[]> {
	if (ids.length === 0) return []
	const { results } = await db
		.prepare(
			`SELECT ${LIST_COLUMNS} FROM games g JOIN tournaments t ON t.id = g.tournament_id
			WHERE g.id IN (SELECT value FROM json_each(?1))`
		)
		.bind(JSON.stringify(ids))
		.all<GameListRow>()
	return results
}

/**
 * Las `limit` filas de más ELO, como mucho `perTournament` de cada torneo para
 * que un torneo fuerte no las acapare. Las que no tienen ELO (null) no
 * entran; si empatan, queda el orden de entrada. Para las partidas y las mesas
 * destacadas de /partidas: elegirlas en SQL con ROW_NUMBER() OVER (PARTITION
 * BY tournament_id …) cuesta en D1 cuatro filas por candidata (lee, ordena,
 * numera y filtra), y aquí sólo la de leerla.
 */
export function topPerTournament<T extends { tournamentId: number; elo: number | null }>(
	rows: T[],
	limit: number,
	perTournament = 2
): T[] {
	const taken = new Map<number, number>()
	const top: T[] = []
	const rated = rows.filter((r): r is T & { elo: number } => r.elo !== null).sort((a, b) => b.elo - a.elo)
	for (const row of rated) {
		if (top.length === limit) break
		const n = taken.get(row.tournamentId) ?? 0
		if (n === perTournament) continue
		taken.set(row.tournamentId, n + 1)
		top.push(row)
	}
	return top
}

/**
 * Partidas jugadas desde ?1 (YYYY-MM-DD) para elegir las destacadas: el id,
 * el torneo y la suma de los dos ELO (NULL si falta alguno). Recorre
 * games_date sin ordenar, una fila por partida: 872 la semana del 15-oct-2026.
 */
export const RECENT_GAMES_SQL = 'SELECT id, tournament_id AS tournamentId, white_elo + black_elo AS elo FROM games WHERE date >= ?1'

/**
 * Las `limit` partidas de ELO medio más alto jugadas desde `from`, como mucho
 * dos por torneo, de más a menos ELO; y cuántas se han jugado desde entonces,
 * también sin ELO, para enlazar a todas.
 */
export async function getTopRecentGames(
	db: D1Database,
	from: string,
	limit = 10
): Promise<{ total: number; games: GameListRow[] }> {
	const { results } = await db
		.prepare(RECENT_GAMES_SQL)
		.bind(from)
		.all<{ id: number; tournamentId: number; elo: number | null }>()
	const top = topPerTournament(results, limit)
	const byId = new Map((await getGamesByIds(db, top.map((g) => g.id))).map((g) => [g.id, g]))
	return { total: results.length, games: top.flatMap((g) => byId.get(g.id) ?? []) }
}

/**
 * Partidas entre dos jugadores, de la más reciente a la más antigua. Recorre
 * las partidas con blancas de cada uno (índice games_white).
 */
export async function getHeadToHead(db: D1Database, a: number, b: number): Promise<GameListRow[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM (
				SELECT ${LIST_COLUMNS} FROM games g JOIN tournaments t ON t.id = g.tournament_id
				WHERE g.white_fide_id = ?1 AND g.black_fide_id = ?2
				UNION ALL
				SELECT ${LIST_COLUMNS} FROM games g JOIN tournaments t ON t.id = g.tournament_id
				WHERE g.white_fide_id = ?2 AND g.black_fide_id = ?1
			)
			ORDER BY date IS NULL, date DESC, id DESC`
		)
		.bind(a, b)
		.all<GameListRow>()
	return results
}

export interface GameDetail extends GameListRow {
	pgn: string
	tournamentUrl: string
	tournamentSource: string
	/** Fuente de las partidas del torneo ('info64', 'lichess'). */
	gamesSource: string | null
	/** Medias jugadas; sin ninguna, la página no se indexa ni entra en el sitemap. */
	plyCount: number
}

export async function getGame(db: D1Database, id: number): Promise<GameDetail | null> {
	return db
		.prepare(
			`SELECT ${LIST_COLUMNS}, g.pgn, g.ply_count AS plyCount, t.url AS tournamentUrl, t.source AS tournamentSource,
				t.games_source AS gamesSource
			FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE g.id = ?1`
		)
		.bind(id)
		.first<GameDetail>()
}

/** Partidas anterior y siguiente del mismo torneo, para navegar entre ellas. */
export async function getAdjacentGames(
	db: D1Database,
	game: Pick<GameDetail, 'id' | 'tournamentId' | 'round' | 'board'>
): Promise<{ prev: number | null; next: number | null }> {
	const [prev, next] = await db.batch<{ id: number }>([
		db
			.prepare(
				`SELECT id FROM games WHERE tournament_id = ?1 AND (round, board, seq) < (?2, ?3, (SELECT seq FROM games WHERE id = ?4))
				ORDER BY round DESC, board DESC, seq DESC LIMIT 1`
			)
			.bind(game.tournamentId, game.round, game.board, game.id),
		db
			.prepare(
				`SELECT id FROM games WHERE tournament_id = ?1 AND (round, board, seq) > (?2, ?3, (SELECT seq FROM games WHERE id = ?4))
				ORDER BY round, board, seq LIMIT 1`
			)
			.bind(game.tournamentId, game.round, game.board, game.id)
	])
	return { prev: prev.results[0]?.id ?? null, next: next.results[0]?.id ?? null }
}
