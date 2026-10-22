import { env } from 'cloudflare:workers'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exportGameIds, gamesPgn, searchGames, type GameFilters } from '../../src/lib/db/games'
import { COUNT_LIMIT, PAGE_SIZE, SEARCH_PAGES } from '../../src/lib/db/pagination'
import { findPlayersByName, searchPlayers } from '../../src/lib/db/players'
import { playerFilters } from '../../src/lib/params'

// Más partidas y jugadores que el tope de los recuentos, para ver que los
// totales de las búsquedas paran ahí, que los de la ficha no, y que cada
// página es la misma recorra o no el índice del orden (countAndPlan), que
// depende del recuento y de site_totals.
const db = env.DB
const GAMES = 6000
const PLAYERS = COUNT_LIMIT + 100
/** El de la ficha: juega con blancas una de cada cuatro. */
const FIDE_ID = 9000001

/** env.DB, apuntando el SQL de cada consulta para ver por qué índice va. */
function spied(): { db: D1Database; sql: string[] } {
	const sql: string[] = []
	const proxy = new Proxy(db, {
		get(target, prop) {
			if (prop === 'prepare') return (query: string) => (sql.push(query), target.prepare(query))
			const value: unknown = Reflect.get(target, prop)
			return typeof value === 'function' ? value.bind(target) : value
		}
	})
	return { db: proxy, sql }
}

const withTotals = () =>
	db
		.prepare(`INSERT OR REPLACE INTO site_totals (id, players, games, tournaments, updated_at) VALUES (1, ?1, ?2, 40, '2026-10-22')`)
		.bind(PLAYERS, GAMES)
		.run()

beforeAll(async () => {
	await db.batch([db.prepare('DELETE FROM games'), db.prepare('DELETE FROM tournaments'), db.prepare('DELETE FROM players')])
	await db
		.prepare(
			`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 40)
			INSERT INTO tournaments (id, source, source_key, name, type, url) SELECT i, 'info64', 't' || i, 'Torneo ' || i, 'individual', 'https://info64.org/t' || i FROM n`
		)
		.run()
	// Todas contra «Martin»; una de cada tres, de «Garcia» (2.000: más que el
	// tope, pero pocas para recorrer games_date en la página 20); la mitad, con
	// un ECO B; una de cada 97, sin fecha; y muchas el mismo día, para que
	// desempaten el torneo, la ronda y el tablero.
	await db
		.prepare(
			`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
			INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_fide_id, result, eco, ply_count, pgn, seen_at)
			SELECT 1 + i % 40, 1 + i % 9, i,
				CASE WHEN i % 97 = 0 THEN NULL ELSE date('2020-01-01', '+' || (i * 7 % 900) || ' days') END,
				CASE WHEN i % 3 = 0 THEN 'Garcia Lopez, Ana' ELSE 'Perez Ruiz, Juan' END, 'Martin Gil, Luis',
				CASE WHEN i % 4 = 0 THEN ?2 END, '1-0',
				CASE WHEN i % 2 = 0 THEN 'B' || (10 + i % 90) ELSE 'C' || (10 + i % 90) END, 40,
				'[Event "' || i || '"]' || char(10) || char(10) || '1. e4 *' || char(10), '2026-10-22'
			FROM n`
		)
		.bind(GAMES, FIDE_ID)
		.run()
	// Jugadores «Martin»: muchos con el mismo ELO y el mismo nombre, que desempata el FIDE ID.
	await db
		.prepare(
			`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
			INSERT INTO players (fide_id, name, rating_std, seen_at)
			SELECT 5000000 + (i * 7919) % 100000, 'Martin ' || CASE WHEN i % 5 = 0 THEN 'Gil, Ana' ELSE 'Ruiz, Luis' END,
				CASE WHEN i % 11 = 0 THEN NULL ELSE 1400 + i % 50 END, '2026-10-22'
			FROM n`
		)
		.bind(PLAYERS)
		.run()
})

beforeEach(withTotals)

/** Los id de una página con el orden de antes, con "date IS NULL", sin recorrer ningún índice a la fuerza. */
async function reference(where: string, page: number, limit = PAGE_SIZE): Promise<number[]> {
	const { results } = await db
		.prepare(
			`SELECT id FROM games ${where}
			ORDER BY date IS NULL, date DESC, tournament_id DESC, round, board, seq LIMIT ${limit} OFFSET ${(page - 1) * PAGE_SIZE}`
		)
		.all<{ id: number }>()
	return results.map((r) => r.id)
}

const SEARCHES: [string, GameFilters, string][] = [
	['todas (con su nombre)', { player: 'martin' }, ''],
	['una de cada tres', { player: 'garcia' }, `WHERE white_name LIKE 'Garcia%'`],
	['ECO', { eco: 'B' }, `WHERE eco >= 'B' AND eco < 'C'`],
	['nombre y ECO', { player: 'garcia', eco: 'B' }, `WHERE white_name LIKE 'Garcia%' AND eco >= 'B' AND eco < 'C'`],
	['fechas', { from: '1000-01-01' }, 'WHERE date IS NOT NULL']
]

describe('searchGames con muchas coincidencias', () => {
	it('el total de una búsqueda para en 1.000, y las páginas en 20', async () => {
		expect(await searchGames(db, { from: '1000-01-01' }, 1)).toMatchObject({ total: COUNT_LIMIT, pages: SEARCH_PAGES, capped: true })
		const exact = await searchGames(db, { player: 'garcia', eco: 'B' }, 1)
		expect(exact).toMatchObject({ total: 1000, pages: SEARCH_PAGES })
		expect(exact.capped).toBeUndefined()
	})

	it('cada página es la de antes, recorra o no games_date, y las que no tienen fecha van al final', async () => {
		for (const [label, filters, where] of SEARCHES) {
			for (const page of [1, 2, 10, SEARCH_PAGES]) {
				const expected = await reference(where, page)
				await withTotals()
				expect((await searchGames(db, filters, page)).rows.map((g) => g.id), `${label}, p. ${page}`).toEqual(expected)
				// Sin site_totals no recorre el índice.
				await db.prepare('DELETE FROM site_totals').run()
				expect((await searchGames(db, filters, page)).rows.map((g) => g.id), `${label}, p. ${page}`).toEqual(expected)
			}
		}
	})

	it('pasada la última página, la última', async () => {
		const found = await searchGames(db, { player: 'garcia' }, SEARCH_PAGES + 5)
		expect(found.page).toBe(SEARCH_PAGES)
		expect(found.rows.map((g) => g.id)).toEqual(await reference(`WHERE white_name LIKE 'Garcia%'`, SEARCH_PAGES))
	})

	it('con muchas, recorre games_date en las 20 páginas; con algo más del tope, en la 20 cuenta más y ordena', async () => {
		const read = async (filters: GameFilters, page: number) => {
			const { db: spying, sql } = spied()
			await searchGames(spying, filters, page)
			return { walks: sql.some((query) => query.includes('INDEXED BY games_date')), recounts: sql.some((query) => query.includes('LIMIT 2450)')) }
		}
		// √(1.000 × 6.000) = 2.450: hasta ahí cuenta en la página 20.
		expect(await read({ player: 'martin' }, 1)).toEqual({ walks: true, recounts: false })
		expect(await read({ player: 'martin' }, SEARCH_PAGES)).toEqual({ walks: true, recounts: true })
		expect(await read({ player: 'garcia' }, 1)).toEqual({ walks: true, recounts: false })
		expect(await read({ player: 'garcia' }, SEARCH_PAGES)).toEqual({ walks: false, recounts: true })
	})

	it('si sólo filtra el nombre, lo cuenta en games_fts', async () => {
		const { db: counting, sql } = spied()
		await searchGames(counting, { player: 'garcia' }, 1)
		expect(sql.some((query) => query.includes(`FROM games_fts WHERE games_fts MATCH ?1 LIMIT ${COUNT_LIMIT + 1}`))).toBe(true)
	})
})

describe('la ficha', () => {
	const where = `WHERE white_fide_id = ${FIDE_ID} OR black_fide_id = ${FIDE_ID}`

	it('el total exacto y todas sus páginas, también pasada la 20', async () => {
		const page = await searchGames(db, { fideId: FIDE_ID }, 25)
		expect(page).toMatchObject({ total: GAMES / 4, pages: GAMES / 4 / PAGE_SIZE, page: 25 })
		expect(page.capped).toBeUndefined()
		expect(page.rows.map((g) => g.id)).toEqual(await reference(where, 25))
	})

	it('su descarga, todas: hasta 5.000', async () => {
		expect(await exportGameIds(db, { fideId: FIDE_ID })).toEqual(await reference(where, 1, 5000))
	})
})

describe('exportGameIds y gamesPgn', () => {
	it('las de una búsqueda, las 1.000 que enseña, en el orden del listado; sus PGN, en ese orden', async () => {
		for (const [label, filters, where] of SEARCHES) {
			const ids = await exportGameIds(db, filters)
			expect(ids, label).toEqual(await reference(where, 1, COUNT_LIMIT))
		}
		const ids = await exportGameIds(db, { player: 'martin' })
		const events: string[] = []
		for await (const pgn of gamesPgn(db, ids)) events.push(/\[Event "(\d+)"\]/.exec(pgn)![1])
		const boards = await db
			.prepare('SELECT g.board FROM json_each(?1) j JOIN games g ON g.id = j.value ORDER BY j.key')
			.bind(JSON.stringify(ids))
			.all<{ board: number }>()
		expect(events).toEqual(boards.results.map((r) => String(r.board)))
	})

	it('salta las partidas que ya no existen', async () => {
		const ids = await exportGameIds(db, { player: 'garcia' })
		const pgns: string[] = []
		for await (const pgn of gamesPgn(db, [ids[0], 999999999, ids[1]])) pgns.push(pgn)
		expect(pgns).toHaveLength(2)
	})
})

describe('jugadores con muchas coincidencias', () => {
	const reference = async (page: number, limit = PAGE_SIZE) =>
		(
			await db
				.prepare(`SELECT fide_id FROM players ORDER BY rating_std DESC, name, fide_id LIMIT ${limit} OFFSET ${(page - 1) * PAGE_SIZE}`)
				.all<{ fide_id: number }>()
		).results.map((r) => r.fide_id)

	it('el total para en 1.000, y cada página es la de siempre, recorra o no players_rating_std', async () => {
		for (const page of [1, 10, SEARCH_PAGES]) {
			const expected = await reference(page)
			await withTotals()
			const found = await searchPlayers(db, playerFilters(new URLSearchParams(`q=martin&p=${page}`)), 2026)
			expect(found).toMatchObject({ total: COUNT_LIMIT, pages: SEARCH_PAGES, capped: true })
			expect(found.rows.map((p) => p.fideId), `p. ${page}`).toEqual(expected)
			await db.prepare('DELETE FROM site_totals').run()
			const unwalked = await searchPlayers(db, playerFilters(new URLSearchParams(`q=martin&p=${page}`)), 2026)
			expect(unwalked.rows.map((p) => p.fideId), `p. ${page}`).toEqual(expected)
		}
	})

	it('pasada la última página, la última', async () => {
		const found = await searchPlayers(db, playerFilters(new URLSearchParams('q=martin&p=99')), 2026)
		expect(found.page).toBe(SEARCH_PAGES)
		expect(found.rows.map((p) => p.fideId)).toEqual(await reference(SEARCH_PAGES))
	})

	it('«Tú contra…»: los primeros recorriendo el índice, sin el rival', async () => {
		const [rival, ...rest] = await reference(1, 10)
		const { db: spying, sql } = spied()
		const { rows, more } = await findPlayersByName(spying, 'martin', rival, 8, 2026)
		expect(rows.map((p) => p.fideId)).toEqual(rest.slice(0, 8))
		expect(more).toBe(true)
		expect(sql.some((query) => query.includes('INDEXED BY players_rating_std'))).toBe(true)
	})
})
