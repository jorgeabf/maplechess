// Consultas de torneos.
import { isMinorsTournament } from '../../ingest/menores'
import { looksSensitive } from '../../ingest/sensibles'
import { madridYear } from '../dates'
import { formatNumber } from '../format'
import { tournamentTerms } from './fts'
import { COUNT_LIMIT, countSql, offset, PAGE_SIZE, toPage, type Page } from './pagination'
import { hasDossierSql, minorsBornSince } from './players'

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
	/** Cuántas de ellas son de lichess, por sus cabeceras (lichessUrl): también en las de info64. */
	lichessGames: number
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
	t.time_control AS timeControl, t.games_count AS gamesCount, t.lichess_games AS lichessGames, t.url, t.source,
	t.games_source AS gamesSource, t.games_source_url AS gamesSourceUrl`

/**
 * Jugadores del torneo: lee una fila por participante (D1 las cobra), así que
 * sólo va donde se enseña, en el listado, y sólo para los torneos de la página
 * (searchTournaments).
 */
const PLAYERS = '(SELECT count(*) FROM participations WHERE tournament_id = t.id) AS players'

/**
 * Más recientes primero. Sin "start_date IS NULL": en orden DESC SQLite ya deja
 * los NULL al final, y así recorre el índice tournaments_start_date en vez de
 * ordenar la tabla entera.
 */
const NEWEST_FIRST = 't.start_date DESC, t.id DESC'
export const TOURNAMENT_ORDER = `ORDER BY ${NEWEST_FIRST}`

/** Próximos: el más cercano primero, recorriendo el mismo índice hacia delante. */
const SOONEST_FIRST = 't.start_date, t.id'

/**
 * Lo que filtra la búsqueda de torneos, sin la pestaña: las palabras y los
 * sitios (tournamentTerms), las fechas y la modalidad. Da también `p`, que
 * añade un parámetro, y `fts`, que busca en tournaments_fts, para lo que
 * venga detrás.
 */
function tournamentsWhere(f: Pick<TournamentFilters, 'q' | 'from' | 'to' | 'type'>) {
	const where: string[] = []
	const params: unknown[] = []
	const p = (value: unknown) => {
		params.push(value)
		return `?${params.length}`
	}
	const fts = (match: string) => `t.id IN (SELECT rowid FROM tournaments_fts WHERE tournaments_fts MATCH ${p(match)})`
	const terms = tournamentTerms(f.q)
	if (terms?.text) where.push(fts(terms.text))
	// Un sitio: los torneos que se juegan en él (por su índice) o que lo dicen en el nombre.
	for (const place of terms?.places ?? []) {
		const located = [
			...(place.provinces.length > 0 ? [`t.provincia IN (${place.provinces.map(p).join(', ')})`] : []),
			...(place.communities.length > 0 ? [`t.comunidad IN (${place.communities.map(p).join(', ')})`] : [])
		]
		where.push(`(${[...located, fts(place.name)].join(' OR ')})`)
	}
	if (f.from) where.push(`t.end_date >= ${p(f.from)}`)
	if (f.to) where.push(`t.start_date <= ${p(f.to)}`)
	if (f.type) where.push(`t.type = ${p(f.type)}`)
	return { where, params, p, fts, terms }
}

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
	const { where, params, p, fts, terms } = tournamentsWhere(f)
	const filtered = where.length > 0 || f.withGames
	const day = p(today)
	const upcomingSql = `WHERE ${[...where, `t.start_date > ${day}`].join(' AND ')}`
	const startedSql = `WHERE ${[...where, `t.start_date <= ${day}`, ...(f.withGames ? ['t.games_count > 0'] : [])].join(' AND ')}`
	// Los recuentos no ordenan: llevan sólo los parámetros hasta aquí.
	const counted = params.slice()
	// Con sitios, primero los torneos que los nombran, por cualquiera de sus
	// nombres o gentilicios (cuantos más de los buscados, antes): «campeonato
	// andalucia» empieza por los Campeonatos de Andalucía. Sólo ordenan: qué
	// torneos salen lo ha decidido el WHERE, así que no cuelan los de otro sitio.
	const named = (terms?.places ?? []).map((place) => `(${fts(place.named)})`).join(' + ')
	const byDate = f.upcoming ? SOONEST_FIRST : NEWEST_FIRST

	const statements = [
		// Primero la página (los id) y después sus jugadores. Cuando hay que
		// ordenar (una búsqueda, por el FTS o por un sitio), SQLite calcula las
		// columnas de cada torneo que casa antes de ordenar y cortar: contaba los
		// participantes de todos, 59.412 filas en remoto con «asturias».
		db
			.prepare(
				`SELECT ${COLUMNS}, ${PLAYERS}
				FROM (SELECT t.id${named ? `, ${named} AS named` : ''} FROM tournaments t ${f.upcoming ? upcomingSql : startedSql}
					ORDER BY ${named ? 'named DESC, ' : ''}${byDate} LIMIT ${PAGE_SIZE} OFFSET ${offset(f.page)}) AS page
				JOIN tournaments t ON t.id = page.id
				ORDER BY ${named ? 'page.named DESC, ' : ''}${byDate}`
			)
			.bind(...params),
		db.prepare(`SELECT count(*) AS n FROM tournaments t ${upcomingSql}`).bind(...counted)
	]
	// Total de los empezados. Sin filtros, todos menos los próximos, con el
	// total ya calculado: contarlos recorrería la tabla entera. (Si aún no hay
	// totales, como recién creada la base, se cuentan todos.)
	if (!f.upcoming) {
		statements.push(
			filtered
				? db.prepare(`SELECT count(*) AS n FROM tournaments t ${startedSql}`).bind(...counted)
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

/**
 * Cuántos torneos ya empezados encuentra /torneos?q=`name`, lo mismo que su
 * pestaña por defecto (con sitios y equivalencias), con el tope de las
 * búsquedas (countSql): para ofrecerlos cuando /jugadores no encuentra a nadie
 * con ese nombre. Null si el nombre no tiene palabras.
 */
export async function countTournamentsByName(
	db: D1Database,
	name: string,
	today: string
): Promise<{ total: number; capped: boolean } | null> {
	const { where, params, p, terms } = tournamentsWhere({ q: name, from: '', to: '', type: null })
	if (!terms) return null
	const started = [...where, `t.start_date <= ${p(today)}`].join(' AND ')
	const { n } = (await db.prepare(countSql(`FROM tournaments t WHERE ${started}`)).bind(...params).first<{ n: number }>())!
	return n > COUNT_LIMIT ? { total: COUNT_LIMIT, capped: true } : { total: n, capped: false }
}

/** Un torneo del grupo de la fuente (tournaments.related; migración 0018). */
export interface RelatedTournament {
	/** Su clave en la fuente (source_key). */
	key: string
	/** El rótulo de su pestaña en la fuente, que pone el organizador. */
	label: string
}

/** La página del torneo lee además su clave y su grupo, que van en la misma fila. */
export interface TournamentPageRow extends TournamentRow {
	/** Su clave en la fuente (source_key): dice si es un campeonato de España (championshipsOf). */
	sourceKey: string
	/** El grupo, con el propio torneo; null si no tiene. */
	related: RelatedTournament[] | null
}

export async function getTournament(db: D1Database, id: number): Promise<TournamentPageRow | null> {
	const row = await db
		.prepare(`SELECT ${COLUMNS}, t.source_key AS sourceKey, t.related FROM tournaments t WHERE t.id = ?1`)
		.bind(id)
		.first<TournamentRow & { sourceKey: string; related: string | null }>()
	return row && { ...row, related: row.related === null ? null : (JSON.parse(row.related) as RelatedTournament[]) }
}

// Lo que queda en el borde de un rótulo recortado y también se quita: el guion
// de «- Fase Final», el «de» de «de Veteranos S50».
const EDGE_WORD = /^(?:[-–—·:,;|/]+|de|del|y|e|en)$/i

// El número romano de una edición, de I a XXXIX: el «IV» de «IV Open».
const EDITION = /^(?=[IVX])X{0,3}(?:IX|IV|V?I{0,3})$/

/**
 * Una palabra que dice algo: con alguna letra, de dos caracteres o más, no
 * de borde ni el número de la edición. «S50», «O11» o «CD» sí; «A», «2»,
 * «2000» o «IV» solas no.
 */
const isWord = (word: string) =>
	!EDGE_WORD.test(word) && !EDITION.test(word) && /\p{L}/u.test(word) && /[\p{L}\p{N}]{2}/u.test(word)

/**
 * Los rótulos de las pestañas sin las palabras que comparten todos al
 * principio y al final: «Campeonato Absoluto de Bizkaia 2026» y «Campeonato
 * Primera de Bizkaia 2026» pasan a «Absoluto» y «Primera». Las palabras van
 * separadas por espacios o por puntos («2026.GrupoA»), y lo que queda es el
 * trozo del rótulo tal como viene.
 *
 * Al que se queda sin una palabra que diga algo se le devuelven sólo a él las
 * suyas, primero por el principio: «Open 2026» y «Open 2026 - Rápido» pasan a
 * «Open 2026» y «Rápido»; «Grupo A» y «Grupo B», «Sub 2000» y «Sub 1600» se
 * quedan como están. Si dos quedan iguales al quitar el «de» del borde, se
 * recorta menos a todos.
 */
export function groupLabels(labels: readonly string[]): string[] {
	if (labels.length < 2) return [...labels]
	const tokens = labels.map((label) => [...label.matchAll(/[^\s.]+/g)])
	const words = tokens.map((t) => t.map((match) => match[0]))
	const shared = (at: (w: string[]) => string | undefined) =>
		words.every((w) => at(w)?.localeCompare(at(words[0]) ?? '', 'es', { sensitivity: 'base' }) === 0)
	const shortest = Math.min(...words.map((w) => w.length))
	let head = 0
	while (head < shortest && shared((w) => w[head])) head++
	let tail = 0
	while (head + tail < shortest && shared((w) => w.at(-1 - tail))) tail++
	// El rótulo i sin h palabras al principio ni t al final, ni lo que quede en
	// el borde; null si no le queda una palabra que diga algo.
	const cut = (i: number, h: number, t: number) => {
		const w = words[i]
		let from = h
		let to = w.length - t
		while (h > 0 && to - from > 1 && EDGE_WORD.test(w[from])) from++
		while (t > 0 && to - from > 1 && EDGE_WORD.test(w[to - 1])) to--
		if (!w.slice(from, to).some(isWord)) return null
		return labels[i].slice(tokens[i][from].index, tokens[i][to - 1].index + w[to - 1].length)
	}
	for (; head + tail > 0; head > 0 ? head-- : tail--) {
		const rest = labels.map((_, i) => {
			let h = head
			let t = tail
			let label = cut(i, h, t)
			while (label === null && h + t > 0) {
				if (h > 0) h--
				else t--
				label = cut(i, h, t)
			}
			return label
		})
		if (rest.every((label): label is string => label !== null) && new Set(rest).size === new Set(labels).size) return rest
	}
	return [...labels]
}

/** Una pestaña del grupo: un torneo guardado. */
export interface GroupTab {
	id: number
	label: string
}

/**
 * Las pestañas del grupo: los torneos guardados, en el orden de la fuente y
 * con su rótulo recortado (groupLabels). Los demás no salen: aún no han
 * empezado, han fallado o no se guardan (los de menores y los sensibles).
 *
 * El rótulo lo pone el organizador y puede decir lo que el nombre calla
 * («Sub 12»): pasa por las mismas reglas que el nombre (menores.ts y
 * sensibles.ts), y si dice que es de menores o lo parece sensible, o si no
 * hay rótulo, la pestaña lleva el nombre del torneo. La ingesta ya no guarda
 * los que lo dicen en su propio rótulo; esto cubre los guardados antes.
 *
 * Recorre la lista y busca cada torneo por la clave única (source,
 * source_key): una fila por torneo del grupo y otra por cada uno guardado.
 * CROSS JOIN fija ese orden: con JOIN, SQLite recorría todos los torneos de
 * la fuente, y con IN (SELECT …) contaba además la lista.
 */
export async function getTournamentGroup(db: D1Database, source: string, related: RelatedTournament[]): Promise<GroupTab[]> {
	const { results } = await db
		.prepare(
			`SELECT t.id, t.source_key AS key, t.name, t.start_date AS startDate FROM json_each(?2) j
			CROSS JOIN tournaments t ON t.source = ?1 AND t.source_key = j.value`
		)
		.bind(source, JSON.stringify(related.map((r) => r.key)))
		.all<{ id: number; key: string; name: string; startDate: string | null }>()
	const byKey = new Map(results.map((t) => [t.key, t]))
	const tabs = related.flatMap((r) => {
		const t = byKey.get(r.key)
		if (!t) return []
		const telling = isMinorsTournament(r.label, t.startDate) || looksSensitive(r.label)
		return [{ id: t.id, label: r.label && !telling ? r.label : t.name }]
	})
	const labels = groupLabels(tabs.map((tab) => tab.label))
	return tabs.map((tab, i) => ({ ...tab, label: labels[i] }))
}

// Los títulos que cuenta el resumen: los que dicen cuánto pesa un torneo.
const SUMMARY_TITLES = ['GM', 'IM']

/**
 * La línea de resumen del torneo: «100 jugadores · 7 GM · 16 IM · ELO medio
 * 2211». `size` es el tamaño ya escrito («100 jugadores», «52 equipos»); los
 * títulos se cuentan en `players` y el ELO medio es el de `ratings`, sin los
 * que no tienen. Sale de las filas que la página ya lee.
 */
export function tournamentSummary(
	size: string,
	players: readonly { title: string | null }[],
	ratings: readonly (number | null)[]
): string {
	const titles = SUMMARY_TITLES.flatMap((title) => {
		const n = players.filter((p) => p.title === title).length
		return n > 0 ? [`${formatNumber(n)} ${title}`] : []
	})
	const rated = ratings.filter((r): r is number => r !== null)
	const average = rated.length > 0 ? [`ELO medio ${Math.round(rated.reduce((sum, r) => sum + r, 0) / rated.length)}`] : []
	return [size, ...titles, ...average].join(' · ')
}

/**
 * Un torneo se indexa si tiene partidas o al menos dos jugadores. Sin ninguna
 * de las dos cosas (cancelado, o la fuente no ha publicado ni la lista ni las
 * partidas) su página está casi vacía: lleva noindex (torneos/[id].astro) y no
 * entra en el sitemap (indexableTournamentSql). El 24-oct-2026 eran 47 de los
 * 8.803 torneos, todos de info64 y sin clasificación ni emparejamientos.
 */
export function isIndexableTournament(gamesCount: number, players: number): boolean {
	return gamesCount > 0 || players >= 2
}

/**
 * El mismo criterio en SQL, sobre el torneo `alias`. El EXISTS con OFFSET 1
 * mira si hay un segundo participante: lee como mucho dos entradas de la clave
 * de participations, y sólo en los torneos sin partidas.
 */
export function indexableTournamentSql(alias: string): string {
	return `(${alias}.games_count > 0
		OR EXISTS (SELECT 1 FROM participations pa WHERE pa.tournament_id = ${alias}.id LIMIT 1 OFFSET 1))`
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
	/** 1 si tiene dossier (hasDossierSql): sólo entonces se enlaza. */
	hasDossier: 0 | 1
}

export async function getTournamentParticipants(
	db: D1Database,
	id: number,
	year = madridYear(new Date())
): Promise<TournamentParticipant[]> {
	const { results } = await db
		.prepare(
			`SELECT pa.start_rank AS startRank, nullif(pa.team, '') AS team, pa.name, pa.fide_id AS fideId,
				pa.title, pa.fed, pa.rating, ${hasDossierSql('pa.fide_id', '?2')} AS hasDossier
			FROM participations pa WHERE pa.tournament_id = ?1 ORDER BY pa.team, pa.start_rank`
		)
		.bind(id, minorsBornSince(year))
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

