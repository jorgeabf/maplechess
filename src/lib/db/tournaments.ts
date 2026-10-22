// Consultas de torneos.
import { prefixTerms } from './fts'
import { hasGamesSql } from './games'
import { offset, PAGE_SIZE, toPage, type Page } from './pagination'

export interface TournamentRow {
	id: number
	name: string
	type: string
	city: string | null
	startDate: string | null
	endDate: string | null
	timeControl: string | null
	/** Fuente de las partidas ('info64', 'lichess') y su página si es otra. */
	gamesSource: string | null
	gamesSourceUrl: string | null
	gamesCount: number
	url: string
	source: string
}

/** En el listado de /torneos, también cuántos jugadores tiene. */
export interface TournamentListRow extends TournamentRow {
	players: number
}

export interface TournamentFilters {
	q: string
	/** Los que aún no han empezado («Próximos»); si no, los ya empezados («En curso y terminados»). */
	upcoming: boolean
	/** Sólo torneos con partidas (no se aplica a los próximos). */
	withGames: boolean
	from: string
	to: string
	/** Modalidad (tournaments.type); null, las dos. */
	type: 'individual' | 'team' | null
	page: number
}

const COLUMNS = `t.id, t.name, t.type, t.city, t.start_date AS startDate, t.end_date AS endDate,
	t.time_control AS timeControl, t.games_count AS gamesCount, t.url, t.source,
	t.games_source AS gamesSource, t.games_source_url AS gamesSourceUrl`

/**
 * Jugadores del torneo: lee una fila por participante (D1 las cobra), así que
 * sólo va donde se enseña, en el listado.
 */
const PLAYERS = '(SELECT count(*) FROM participations WHERE tournament_id = t.id) AS players'

/**
 * Más recientes primero. Sin "start_date IS NULL": en orden DESC SQLite ya deja
 * los NULL al final, y así recorre el índice tournaments_start_date en vez de
 * ordenar la tabla entera.
 */
export const TOURNAMENT_ORDER = 'ORDER BY t.start_date DESC, t.id DESC'

/** Próximos: el más cercano primero, recorriendo el mismo índice hacia delante. */
const UPCOMING_ORDER = 'ORDER BY t.start_date, t.id'

/**
 * Torneos ya empezados (los que empiezan `today` o antes) o, con `f.upcoming`,
 * los próximos. Da también cuántos próximos cumplen los filtros, para su
 * pestaña: son pocos (los anunciados), así que contarlos es barato.
 */
export async function searchTournaments(
	db: D1Database,
	f: TournamentFilters,
	today: string
): Promise<Page<TournamentListRow> & { upcoming: number }> {
	const where: string[] = []
	const params: unknown[] = []
	const p = (value: unknown) => {
		params.push(value)
		return `?${params.length}`
	}
	const terms = prefixTerms(f.q)
	if (terms) where.push(`t.id IN (SELECT rowid FROM tournaments_fts WHERE tournaments_fts MATCH ${p(terms)})`)
	if (f.from) where.push(`t.end_date >= ${p(f.from)}`)
	if (f.to) where.push(`t.start_date <= ${p(f.to)}`)
	if (f.type) where.push(`t.type = ${p(f.type)}`)
	const filtered = where.length > 0 || f.withGames
	const day = p(today)
	const upcomingSql = `WHERE ${[...where, `t.start_date > ${day}`].join(' AND ')}`
	const startedSql = `WHERE ${[...where, `t.start_date <= ${day}`, ...(f.withGames ? ['t.games_count > 0'] : [])].join(' AND ')}`

	const statements = [
		db
			.prepare(
				`SELECT ${COLUMNS}, ${PLAYERS} FROM tournaments t ${f.upcoming ? upcomingSql : startedSql}
				${f.upcoming ? UPCOMING_ORDER : TOURNAMENT_ORDER}
				LIMIT ${PAGE_SIZE} OFFSET ${offset(f.page)}`
			)
			.bind(...params),
		db.prepare(`SELECT count(*) AS n FROM tournaments t ${upcomingSql}`).bind(...params)
	]
	// Total de los empezados. Sin filtros, todos menos los próximos, con el
	// total ya calculado: contarlos recorrería la tabla entera. (Si aún no hay
	// totales, como recién creada la base, se cuentan todos.)
	if (!f.upcoming) {
		statements.push(
			filtered
				? db.prepare(`SELECT count(*) AS n FROM tournaments t ${startedSql}`).bind(...params)
				: db.prepare(
						'SELECT coalesce((SELECT tournaments FROM site_totals WHERE id = 1), (SELECT count(*) FROM tournaments)) AS n'
					)
		)
	}
	const [rows, upcomingCount, startedCount] = await db.batch<TournamentListRow | { n: number }>(statements)
	const count = (result: D1Result<TournamentListRow | { n: number }>) => (result.results[0] as { n: number }).n
	const upcoming = count(upcomingCount)
	const total = f.upcoming ? upcoming : filtered ? count(startedCount) : count(startedCount) - upcoming
	return { ...toPage(rows.results as TournamentListRow[], total, f.page), upcoming }
}

export async function getTournament(db: D1Database, id: number): Promise<TournamentRow | null> {
	return db.prepare(`SELECT ${COLUMNS} FROM tournaments t WHERE t.id = ?1`).bind(id).first<TournamentRow>()
}

export interface TournamentParticipant {
	/** Número inicial; en torneos por equipos, tablero dentro del equipo. */
	startRank: number
	/** Equipo, sólo en torneos por equipos. */
	team: string | null
	name: string
	fideId: number | null
	title: string | null
	fed: string | null
	rating: number | null
	/** 1 si tiene partidas (de cualquier torneo): sólo entonces hay dossier. */
	hasGames: 0 | 1
}

export async function getTournamentParticipants(db: D1Database, id: number): Promise<TournamentParticipant[]> {
	const { results } = await db
		.prepare(
			`SELECT pa.start_rank AS startRank, nullif(pa.team, '') AS team, pa.name, pa.fide_id AS fideId,
				pa.title, pa.fed, pa.rating, ${hasGamesSql('pa.fide_id')} AS hasGames
			FROM participations pa WHERE pa.tournament_id = ?1 ORDER BY pa.team, pa.start_rank`
		)
		.bind(id)
		.all<TournamentParticipant>()
	return results
}

/** Torneos recientes con partidas, para la portada. */
export async function latestTournamentsWithGames(db: D1Database, limit = 8): Promise<TournamentRow[]> {
	const { results } = await db
		.prepare(
			`SELECT ${COLUMNS} FROM tournaments t WHERE t.games_count > 0
			${TOURNAMENT_ORDER} LIMIT ?1`
		)
		.bind(limit)
		.all<TournamentRow>()
	return results
}

/** Totales de la portada, recalculados al final de cada sincronización (refreshTotals). */
export async function getTotals(db: D1Database): Promise<{ players: number; games: number; tournaments: number }> {
	const row = await db
		.prepare('SELECT players, games, tournaments FROM site_totals WHERE id = 1')
		.first<{ players: number; games: number; tournaments: number }>()
	return row ?? { players: 0, games: 0, tournaments: 0 }
}

