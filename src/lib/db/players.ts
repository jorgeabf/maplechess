// Consultas de jugadores.
import { madridYear } from '../dates'
import { outcomeFor } from '../format'
import { prefixTerms } from './fts'
import { hasGamesSql } from './games'
import { countAndPlan, countSql, offset, PAGE_SIZE, searchPage, toCappedPage, type Page } from './pagination'

export interface PlayerRow {
	fideId: number
	name: string
	title: string | null
	birthYear: number | null
	ratingStd: number | null
	ratingRapid: number | null
	ratingBlitz: number | null
	inactive: number
	games: number
}

export interface PlayerFilters {
	q: string
	title: string
	sex: string
	minElo: number | null
	maxElo: number | null
	/** Sólo quien tiene partidas. Afina la búsqueda, no la lanza (isPlayerSearch). */
	withGames: boolean
	/** Sólo activos en la lista FIDE. También afina, no lanza. */
	active: boolean
	page: number
}

export const TITLES = ['GM', 'IM', 'FM', 'CM', 'WGM', 'WIM', 'WFM', 'WCM'] as const

const PLAYER_COLUMNS = `p.fide_id AS fideId, p.name, p.title, p.birth_year AS birthYear,
	p.rating_std AS ratingStd, p.rating_rapid AS ratingRapid, p.rating_blitz AS ratingBlitz, p.inactive`

const GAMES_COUNT = `(SELECT count(*) FROM games WHERE white_fide_id = p.fide_id)
	+ (SELECT count(*) FROM games WHERE black_fide_id = p.fide_id)`

/**
 * Por ELO estándar, sin ELO al final, y por nombre. Sin "rating_std IS NULL":
 * en orden DESC SQLite ya deja los NULL al final, y así recorre el índice
 * players_rating_std en vez de ordenar todos los jugadores que encuentra. El
 * FIDE ID desempata a los homónimos con el mismo ELO: es la última columna de
 * cada entrada del índice, así que tampoco obliga a ordenar, y la página es la
 * misma lo recorra o no (walkOrderIndex).
 */
export const PLAYER_ORDER = 'ORDER BY p.rating_std DESC, p.name, p.fide_id'

/** Cuántos jugadores se ofrecen al buscarte por tu nombre en el dossier. */
const NAME_CHOICES = 8

/** Condición de los jugadores cuyo nombre casa con el parámetro ?n (prefixTerms). */
const nameMatches = (param: string) => `p.fide_id IN (SELECT rowid FROM players_fts WHERE players_fts MATCH ${param})`

/** La tabla de jugadores, recorriendo players_rating_std si `byRating` (walkOrderIndex). */
function playersFrom(byRating: boolean): string {
	return byRating ? 'players p INDEXED BY players_rating_std' : 'players p'
}

/**
 * Búsqueda con tope (COUNT_LIMIT y SEARCH_PAGES). Con nombre, el recuento va
 * primero: dice si recorrer players_rating_std (countAndPlan) o leer las
 * coincidencias por players_fts y ordenarlas todas. Si el nombre es el único
 * filtro, se cuenta en players_fts, una fila por jugador.
 */
export async function searchPlayers(
	db: D1Database,
	f: PlayerFilters,
	year = madridYear(new Date())
): Promise<Page<PlayerRow>> {
	const where: string[] = []
	const params: unknown[] = []
	const terms = prefixTerms(f.q)
	if (terms) {
		params.push(terms)
		where.push(nameMatches(`?${params.length}`))
	}
	if (f.title) {
		params.push(f.title)
		where.push(`p.title = ?${params.length}`)
	}
	if (f.sex) {
		params.push(f.sex)
		where.push(`p.sex = ?${params.length}`)
	}
	if (f.minElo) {
		params.push(f.minElo)
		where.push(`p.rating_std >= ?${params.length}`)
	}
	if (f.maxElo) {
		params.push(f.maxElo)
		where.push(`p.rating_std <= ?${params.length}`)
	}
	// Una fila más por jugador encontrado que tiene partidas (ver hasGamesSql).
	if (f.withGames) where.push(hasGamesSql('p.fide_id'))
	if (f.active) where.push('p.inactive = 0')
	const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
	const page = searchPage(f.page)

	const list = (byRating: boolean) =>
		db
			.prepare(
				`SELECT ${PLAYER_COLUMNS}, ${GAMES_COUNT} AS games
				FROM ${playersFrom(byRating)} ${whereSql}
				${PLAYER_ORDER}
				LIMIT ${PAGE_SIZE} OFFSET ${offset(page)}`
			)
			.bind(...params)
	const countFrom = terms && where.length === 1 ? 'FROM players_fts WHERE players_fts MATCH ?1' : `FROM players p ${whereSql}`

	let rows: PlayerRow[]
	let total: number
	if (terms) {
		const plan = await countAndPlan(db, countFrom, params, 'players', offset(page) + PAGE_SIZE)
		total = plan.count
		rows = total > offset(page) ? (await list(plan.walk).all<PlayerRow>()).results : []
	} else {
		const [listed, counted] = await db.batch<PlayerRow | { n: number }>([
			list(false),
			db.prepare(countSql(countFrom)).bind(...params)
		])
		rows = listed.results as PlayerRow[]
		total = (counted.results[0] as { n: number }).n
	}
	return toCappedPage(rows.map((p) => publicBirthYear(p, year)), total, page)
}

/** Clave de sync_state con el Last-Modified de la última lista FIDE importada. */
export const FIDE_LIST_KEY = 'fide.lastModified'

/** Categorías del ranking de /jugadores; '' es el absoluto. */
export const RANKING_CATEGORIES = ['', 'femenino', 'sub18', 'mas50', 'mas65'] as const
export type RankingCategory = (typeof RANKING_CATEGORIES)[number]

/**
 * Categorías por edad, por año natural como en la FIDE y la FEDA: sub-18 es
 * quien tiene menos de 18 el 1 de enero, es decir, cumple como mucho 18 en el
 * año (nacidos desde `year - 18`); +50 y +65,
 * quien cumple al menos 50 o 65 (nacidos hasta `year - 50` o `year - 65`).
 */
const AGE_CATEGORIES = {
	sub18: { years: 18, born: 'since' },
	mas50: { years: 50, born: 'until' },
	mas65: { years: 65, born: 'until' }
} as const

/** Año de nacimiento que delimita una categoría por edad en `year`, y si es desde o hasta; null en las demás. */
export function ageLimit(category: RankingCategory, year: number): { born: 'since' | 'until'; year: number } | null {
	if (category === '' || category === 'femenino') return null
	const { years, born } = AGE_CATEGORIES[category]
	return { born, year: year - years }
}

/**
 * Quien puede ser menor de edad en `year`. De la lista FIDE sólo se sabe el año
 * de nacimiento, así que son los sub-18: los nacidos en `year - 18` cumplen 18
 * en algún momento del año. Sin año, como un adulto. Su año de nacimiento no
 * sale en ninguna página (lo quitan estas consultas), ni tampoco en el nombre
 * de los homónimos (upsertFidePlayers), aunque la FIDE lo publique. Su ficha
 * no se indexa ni enseña su próxima partida, y no tiene dossier ni repertorio.
 */
export function mayBeMinor(birthYear: number | null, year: number): boolean {
	return birthYear !== null && birthYear >= minorsBornSince(year)
}

/** Año de nacimiento desde el que se puede ser menor en `year` (mayBeMinor), para las consultas. */
export function minorsBornSince(year: number): number {
	return year - AGE_CATEGORIES.sub18.years
}

/**
 * Condición SQL de quien tiene dossier y repertorio: tiene partidas y no puede
 * ser menor. `bornSince` es el parámetro con minorsBornSince del año. La edad
 * se mira sólo en quien tiene partidas (SQLite no evalúa el resto de un AND
 * falso): una fila más por cada uno de la lista FIDE. Al revés, la sumaba
 * cada jugador, también los que no tienen partidas.
 */
export function hasDossierSql(fideIdColumn: string, bornSince: string): string {
	return `(${hasGamesSql(fideIdColumn)}
		AND NOT EXISTS (SELECT 1 FROM players m WHERE m.fide_id = ${fideIdColumn} AND m.birth_year >= ${bornSince}))`
}

/** Lo que dicen el dossier, el repertorio y su PGN de un posible menor (jugadores/[fideId]/no-disponible.astro). */
export const MINOR_UNAVAILABLE = 'El dossier y el repertorio no están disponibles para jugadores que pueden ser menores de edad.'

function publicBirthYear<T extends { birthYear: number | null }>(player: T, year: number): T {
	return mayBeMinor(player.birthYear, year) ? { ...player, birthYear: null } : player
}

const RANKING_SIZE = 10

export interface RankingRow {
	fideId: number
	name: string
	title: string | null
	birthYear: number | null
	ratingStd: number
}

export interface RiserRow extends RankingRow {
	/** Puntos ganados respecto a la lista anterior. */
	gain: number
}

export interface Ranking {
	/** Cuándo se importó la lista FIDE (ISO); null si no consta. */
	listDate: string | null
	/** Los primeros por ELO estándar, sólo activos. */
	top: RankingRow[]
	/** Los que más suben respecto a la lista anterior; vacío hasta tener dos listas. */
	risers: RiserRow[]
}

/**
 * Las dos listas del ranking: los primeros y los que más suben. Cada una
 * recorre su índice desde arriba y para en cuanto tiene diez: los primeros,
 * players_rating_std (en femenino, players_sex, sólo por las jugadoras), y los
 * que suben, players_rating_gain. Unas diez filas en el absoluto y en
 * femenino, y unos cientos en las categorías por edad. No cuentan las
 * partidas: con los primeros serían cientos de filas. Las que suben repiten la
 * expresión del índice tal cual.
 */
export function rankingQueries(category: RankingCategory, year: number): { top: string; risers: string; params: number[] } {
	const age = ageLimit(category, year)
	const filter =
		category === 'femenino'
			? "AND p.sex = 'F'"
			: age
				? `AND p.birth_year ${age.born === 'since' ? '>=' : '<='} ?1`
				: ''
	// En las que suben, el sexo con +, para que no vaya por players_sex: sin
	// sqlite_stat1, el planificador lo prefería a players_rating_gain y ordenaba
	// a todas las jugadoras (de 206 filas a 11.885 con 98.000 jugadores).
	const risersFilter = category === 'femenino' ? "AND +p.sex = 'F'" : filter
	const columns = 'p.fide_id AS fideId, p.name, p.title, p.birth_year AS birthYear, p.rating_std AS ratingStd'
	return {
		top: `SELECT ${columns} FROM players p
			WHERE p.inactive = 0 AND p.rating_std IS NOT NULL ${filter}
			${PLAYER_ORDER} LIMIT ${RANKING_SIZE}`,
		risers: `SELECT ${columns}, p.rating_std - p.rating_std_prev AS gain FROM players p
			WHERE p.rating_std - p.rating_std_prev > 0 ${risersFilter}
			ORDER BY p.rating_std - p.rating_std_prev DESC, p.name LIMIT ${RANKING_SIZE}`,
		params: age ? [age.year] : []
	}
}

/** Ranking de una categoría en el año `year`, con la fecha de la lista FIDE. */
export async function getRanking(db: D1Database, category: RankingCategory, year: number): Promise<Ranking> {
	const { top: topSql, risers: risersSql, params } = rankingQueries(category, year)
	const [list, top, risers] = await db.batch<{ updatedAt: string } | RankingRow | RiserRow>([
		db.prepare('SELECT updated_at AS updatedAt FROM sync_state WHERE key = ?1').bind(FIDE_LIST_KEY),
		db.prepare(topSql).bind(...params),
		db.prepare(risersSql).bind(...params)
	])
	return {
		listDate: (list.results[0] as { updatedAt: string } | undefined)?.updatedAt ?? null,
		top: (top.results as RankingRow[]).map((p) => publicBirthYear(p, year)),
		risers: (risers.results as RiserRow[]).map((p) => publicBirthYear(p, year))
	}
}

export type PlayerChoice = Omit<PlayerRow, 'games'>

/**
 * Jugadores cuyo nombre casa con `name`, para elegirte en el dossier de
 * `exceptId` (el rival, que no sale): los `limit` primeros en el orden de
 * /jugadores, también los que no tienen partidas. Sin contar partidas: se
 * pide uno más para saber si hay más. Como en /jugadores, el recuento con tope
 * de los que casan dice si recorrer players_rating_std: «garcia» (6.008
 * jugadores) leía unas 24.000 filas ordenándolos a todos.
 */
export async function findPlayersByName(
	db: D1Database,
	name: string,
	exceptId: number,
	limit = NAME_CHOICES,
	year = madridYear(new Date())
): Promise<{ rows: PlayerChoice[]; more: boolean }> {
	const terms = prefixTerms(name)
	if (!terms) return { rows: [], more: false }
	const plan = await countAndPlan(db, 'FROM players_fts WHERE players_fts MATCH ?1', [terms], 'players', limit + 1)
	if (plan.count === 0) return { rows: [], more: false }
	const { results } = await db
		.prepare(
			`SELECT ${PLAYER_COLUMNS}
			FROM ${playersFrom(plan.walk)}
			WHERE ${nameMatches('?1')} AND p.fide_id <> ?2
			${PLAYER_ORDER}
			LIMIT ?3`
		)
		.bind(terms, exceptId, limit + 1)
		.all<PlayerChoice>()
	return { rows: results.slice(0, limit).map((p) => publicBirthYear(p, year)), more: results.length > limit }
}

export interface PlayerProfile extends PlayerChoice {
	/** false si no está (o ya no está) en la lista FIDE como ESP: datos sacados de sus torneos. */
	inFideList: boolean
	/** Puede ser menor (mayBeMinor); el año ya no está en birthYear. */
	minor: boolean
}

export async function getPlayer(
	db: D1Database,
	fideId: number,
	year = madridYear(new Date())
): Promise<PlayerProfile | null> {
	const player = await db
		.prepare(`SELECT ${PLAYER_COLUMNS} FROM players p WHERE p.fide_id = ?1`)
		.bind(fideId)
		.first<Omit<PlayerProfile, 'inFideList' | 'minor'>>()
	if (player) return { ...publicBirthYear(player, year), inFideList: true, minor: mayBeMinor(player.birthYear, year) }

	// Jugador extranjero o dado de baja: se muestra con lo que digan sus torneos.
	const fallback = await db
		.prepare(
			`SELECT pa.name, pa.title, pa.rating
			FROM participations pa JOIN tournaments t ON t.id = pa.tournament_id
			WHERE pa.fide_id = ?1
			ORDER BY t.start_date DESC LIMIT 1`
		)
		.bind(fideId)
		.first<{ name: string; title: string | null; rating: number | null }>()
	if (!fallback) return null
	return {
		fideId,
		name: fallback.name,
		title: fallback.title,
		birthYear: null,
		ratingStd: fallback.rating,
		ratingRapid: null,
		ratingBlitz: null,
		inactive: 0,
		inFideList: false,
		minor: false
	}
}

export interface ColorStats {
	color: 'white' | 'black'
	games: number
	wins: number
	draws: number
	losses: number
}

export interface OpeningStats {
	/** Color del jugador. */
	color: 'white' | 'black'
	eco: string
	/** El nombre más repetido entre sus partidas de ese ECO con ese color. */
	opening: string
	/** Con resultado o sin él: las mismas que lista la ficha al filtrar por color y ECO. */
	games: number
	/** Puntos sobre las partidas con resultado, de 0 a 1; null si no tiene ninguna. */
	score: number | null
}

interface SummaryRow {
	color: 'white' | 'black'
	tournamentId: number
	eco: string | null
	opening: string | null
	result: string
	n: number
}

/** Partidas del jugador en un torneo (sólo las que tienen PGN). */
export interface TournamentScore {
	games: number
	/** Puntos en las partidas con resultado. */
	points: number
	/** Partidas con resultado. */
	decided: number
}

export interface PlayerSummary {
	colors: ColorStats[]
	/** Las OPENINGS_PER_COLOR más jugadas con cada color, primero las de blancas. */
	openings: OpeningStats[]
	byTournament: Map<number, TournamentScore>
}

/**
 * Lo que resume la ficha, en una sola consulta: resultados por color,
 * aperturas más jugadas y partidas y puntos en cada torneo. Recorre una vez
 * las partidas del jugador con cada color (índices games_white y games_black).
 */
export async function getPlayerSummary(db: D1Database, fideId: number): Promise<PlayerSummary> {
	const { results } = await db
		.prepare(
			`SELECT 'white' AS color, tournament_id AS tournamentId, eco, opening, result, count(*) AS n
			FROM games WHERE white_fide_id = ?1 GROUP BY tournament_id, eco, opening, result
			UNION ALL
			SELECT 'black', tournament_id, eco, opening, result, count(*)
			FROM games WHERE black_fide_id = ?1 GROUP BY tournament_id, eco, opening, result`
		)
		.bind(fideId)
		.all<SummaryRow>()
	return summarize(results)
}

const POINTS = { win: 1, draw: 0.5, loss: 0 } as const
const OUTCOME_FIELD = { win: 'wins', draw: 'draws', loss: 'losses' } as const
const OPENINGS_PER_COLOR = 5

/** El nombre más repetido; uno vacío (partidas sin nombre de apertura), sólo si no hay otro. */
function mostCommon(names: Map<string, number>): string {
	const ranked = [...names].sort(([a, m], [b, n]) => Number(a === '') - Number(b === '') || n - m || a.localeCompare(b))
	return ranked[0]?.[0] ?? ''
}

/**
 * Agrega las filas de getPlayerSummary. Las partidas sin resultado cuentan por
 * torneo y en las aperturas (como en la lista a la que enlazan), pero no en los
 * resultados ni en las puntuaciones. Las aperturas van por color y ECO: para
 * preparar una partida, lo primero es con qué color, y el ECO es el filtro de
 * la lista.
 */
export function summarize(rows: SummaryRow[]): PlayerSummary {
	const colors = {
		white: { color: 'white', games: 0, wins: 0, draws: 0, losses: 0 },
		black: { color: 'black', games: 0, wins: 0, draws: 0, losses: 0 }
	} satisfies Record<string, ColorStats>
	const openings = new Map<
		string,
		{ color: 'white' | 'black'; eco: string; names: Map<string, number>; games: number; points: number; decided: number }
	>()
	const byTournament = new Map<number, TournamentScore>()

	for (const row of rows) {
		const outcome = outcomeFor(row.result, row.color)
		const tournament = byTournament.get(row.tournamentId) ?? { games: 0, points: 0, decided: 0 }
		tournament.games += row.n
		byTournament.set(row.tournamentId, tournament)

		if (row.eco) {
			const key = `${row.color}|${row.eco}`
			const stats = openings.get(key) ?? { color: row.color, eco: row.eco, names: new Map(), games: 0, points: 0, decided: 0 }
			const name = row.opening ?? ''
			stats.names.set(name, (stats.names.get(name) ?? 0) + row.n)
			stats.games += row.n
			if (outcome) {
				stats.points += POINTS[outcome] * row.n
				stats.decided += row.n
			}
			openings.set(key, stats)
		}

		if (!outcome) continue
		tournament.points += POINTS[outcome] * row.n
		tournament.decided += row.n

		const color = colors[row.color]
		color.games += row.n
		color[OUTCOME_FIELD[outcome]] += row.n
	}

	const ranked = [...openings.values()].sort((a, b) => b.games - a.games || (a.eco < b.eco ? -1 : a.eco > b.eco ? 1 : 0))
	return {
		colors: [colors.white, colors.black],
		openings: (['white', 'black'] as const).flatMap((color) =>
			ranked
				.filter((o) => o.color === color)
				.slice(0, OPENINGS_PER_COLOR)
				.map(({ eco, names, games, points, decided }) => ({
					color,
					eco,
					opening: mostCommon(names),
					games,
					score: decided ? points / decided : null
				}))
		),
		byTournament
	}
}

export interface ParticipationRow {
	tournamentId: number
	tournamentName: string
	city: string | null
	startDate: string | null
	endDate: string | null
	/** Ritmo del torneo, texto libre (ver timeClassOf). */
	timeControl: string | null
	rating: number | null
	/** Número inicial; en torneos por equipos, tablero dentro del equipo. */
	startRank: number
	team: string | null
}

export async function getPlayerTournaments(db: D1Database, fideId: number): Promise<ParticipationRow[]> {
	const { results } = await db
		.prepare(
			`SELECT t.id AS tournamentId, t.name AS tournamentName, t.city, t.start_date AS startDate,
				t.end_date AS endDate, t.time_control AS timeControl, pa.rating, pa.start_rank AS startRank, nullif(pa.team, '') AS team
			FROM participations pa JOIN tournaments t ON t.id = pa.tournament_id
			WHERE pa.fide_id = ?1
			ORDER BY t.start_date DESC`
		)
		.bind(fideId)
		.all<ParticipationRow>()
	return results
}
