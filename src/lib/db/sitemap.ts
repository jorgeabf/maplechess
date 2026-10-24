// Consultas del sitemap (lib/sitemap.ts). Medido en la D1 remota el 22-oct-2026
// con 98.047 jugadores, 12.528 torneos y 132.438 partidas: el índice lee 3
// filas y los trozos, unas 335.000 en total (CLAUDE.md, «D1 cobra por filas recorridas»).
import { madridYear } from '../dates'
import { SITEMAP_SIZE, type SitemapKind } from '../sitemap'
import { hasGamesSql } from './games'
import { minorsBornSince } from './players'
import { indexableTournamentSql } from './tournaments'

/**
 * Trozos de cada tipo, para el índice. Las partidas y los torneos van por
 * rangos de id, así que basta su `max(id)`: SQLite lo saca de la clave primaria
 * en una fila (con `min` en la misma consulta, recorre la tabla). Los jugadores
 * van por posición: basta el total de site_totals.
 */
export async function sitemapCounts(db: D1Database, size = SITEMAP_SIZE): Promise<Record<SitemapKind, number>> {
	const [games, tournaments, players] = await db.batch<{ n: number | null }>([
		db.prepare('SELECT max(id) AS n FROM games'),
		db.prepare('SELECT max(id) AS n FROM tournaments'),
		db.prepare('SELECT players AS n FROM site_totals WHERE id = 1')
	])
	const parts = (result: D1Result<{ n: number | null }>) => Math.ceil((result.results[0]?.n ?? 0) / size)
	return { jugadores: parts(players), torneos: parts(tournaments), partidas: parts(games) }
}

/**
 * Trozo n (desde 1) de un tipo: los id de sus páginas que se indexan.
 * - Torneos: los del rango de id ((n - 1) · size, n · size] con partidas o al
 *   menos dos jugadores (torneos/[id].astro no indexa los demás). Lee una fila
 *   por id del rango y, en los torneos sin partidas, hasta dos de la clave de
 *   participations: el 24-oct-2026, 23.365 filas por 8.803 torneos, 7.322 sin
 *   partidas (antes del filtro, 8.803).
 * - Partidas: las del rango con jugadas (partidas/[id].astro no indexa las
 *   demás). Lee una fila por id del rango (unas 49.000 por trozo): ply_count
 *   está en la misma fila.
 * - Jugadores: los FIDE ID son dispersos (de 100.234 a 652.009.386, en
 *   bloques), así que van por posición, de `size` en `size`, y sólo las fichas
 *   con torneos o partidas que no pueden ser de un menor en `year`
 *   (mayBeMinor), el criterio del noindex de la ficha. Lee las filas que
 *   salta OFFSET más una por ficha que entra: el segundo trozo, unas 120.000.
 *   Un EXISTS que no encuentra nada no suma, y el año va en la misma fila.
 */
export async function sitemapIds(
	db: D1Database,
	kind: SitemapKind,
	n: number,
	size = SITEMAP_SIZE,
	year = madridYear(new Date())
): Promise<number[]> {
	const from = (n - 1) * size
	const statement =
		kind === 'jugadores'
			? db
					.prepare(
						`SELECT p.fide_id AS id FROM (SELECT fide_id, birth_year FROM players ORDER BY fide_id LIMIT ?1 OFFSET ?2) p
						WHERE (p.birth_year IS NULL OR p.birth_year < ?3)
							AND (EXISTS (SELECT 1 FROM participations pa WHERE pa.fide_id = p.fide_id) OR ${hasGamesSql('p.fide_id')})`
					)
					.bind(size, from, minorsBornSince(year))
			: db
					.prepare(
						kind === 'partidas'
							? 'SELECT id FROM games WHERE id > ?1 AND id <= ?2 AND ply_count > 0'
							: `SELECT t.id FROM tournaments t WHERE t.id > ?1 AND t.id <= ?2 AND ${indexableTournamentSql('t')}`
					)
					.bind(from, from + size)
	const { results } = await statement.all<{ id: number }>()
	return results.map((row) => row.id)
}
