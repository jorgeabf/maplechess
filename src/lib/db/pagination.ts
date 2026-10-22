export const PAGE_SIZE = 50

/**
 * Páginas de una búsqueda de partidas o de jugadores: con una mayor, la
 * última. Más allá se afina la búsqueda. La ficha y las demás listas propias
 * (un jugador, un torneo) no tienen tope: su recuento va por su índice y es
 * barato.
 */
export const SEARCH_PAGES = 20

/** Tope del recuento de una búsqueda (countSql): sus 20 páginas. Por encima, «más de 1.000». */
export const COUNT_LIMIT = SEARCH_PAGES * PAGE_SIZE

export interface Page<T> {
	rows: T[]
	total: number
	page: number
	pages: number
	/** El recuento llegó al tope: hay más de `total` (toCappedPage). */
	capped?: boolean
}

export function toPage<T>(rows: T[], total: number, page: number): Page<T> {
	return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) }
}

/** Página de un recuento con tope (countSql): por encima de COUNT_LIMIT, `capped`. */
export function toCappedPage<T>(rows: T[], count: number, page: number): Page<T> {
	return count > COUNT_LIMIT ? { ...toPage(rows, COUNT_LIMIT, page), capped: true } : toPage(rows, count, page)
}

/** Página de una búsqueda, como mucho la última (SEARCH_PAGES). */
export function searchPage(page: number): number {
	return Math.min(page, SEARCH_PAGES)
}

export function offset(page: number): number {
	return (page - 1) * PAGE_SIZE
}

/**
 * Recuento de las filas de `from` («FROM … WHERE …») que para en `limit`.
 * D1 cobra cada fila contada: «garcia» eran 46.725 en cada búsqueda.
 */
export function countSql(from: string, limit = COUNT_LIMIT + 1): string {
	return `SELECT count(*) AS n FROM (SELECT 1 ${from} LIMIT ${limit})`
}

/**
 * ¿Conviene recorrer el índice del orden (games_date, players_rating_std) y
 * quedarse con las filas que cumplen los filtros, en vez de leer todas las
 * coincidencias por otro índice (el FTS, games_eco) y ordenarlas? Recorriéndolo
 * se leen unas `needed` (desplazamiento más página) × `rows` / `matches`
 * entradas; ordenando, al menos las coincidencias. Con un apellido raro,
 * recorrerlo leería la tabla entera. Sin el total de la tabla (`rows`), no se
 * recorre.
 */
export function walkOrderIndex(matches: number, rows: number | null, needed: number): boolean {
	return rows !== null && needed * rows <= matches * matches
}

/**
 * Recuento con tope de las filas de `from` y si conviene recorrer el índice
 * del orden para leer `needed` (walkOrderIndex), con el total de la tabla de
 * site_totals.
 *
 * Con el recuento en el tope no se sabe cuántas son, y en una página honda
 * importa: «santos» (1.263 partidas) lee 6.315 filas en la página 20
 * ordenándolas y 105.076 recorriendo games_date. Entonces se cuentan hasta
 * √(needed × rows), lo justo para decidir: con más, recorrerlo sale barato;
 * con menos, el recuento es exacto. «garcia» (46.725) recorre el índice en las
 * 20 páginas.
 */
export async function countAndPlan(
	db: D1Database,
	from: string,
	params: unknown[],
	table: 'games' | 'players',
	needed: number
): Promise<{ count: number; walk: boolean }> {
	const [counted, totals] = await db.batch<{ n: number }>([
		db.prepare(countSql(from)).bind(...params),
		db.prepare(`SELECT ${table} AS n FROM site_totals WHERE id = 1`)
	])
	const count = counted.results[0].n
	const rows = totals.results[0]?.n ?? null
	let matches = count
	if (count > COUNT_LIMIT && rows !== null && !walkOrderIndex(count, rows, needed)) {
		const enough = Math.ceil(Math.sqrt(needed * rows))
		matches = (await db.prepare(countSql(from, enough)).bind(...params).first<{ n: number }>())!.n
	}
	return { count, walk: walkOrderIndex(matches, rows, needed) }
}
