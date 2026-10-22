import { describe, expect, it } from 'vitest'
import { COUNT_LIMIT, countSql, SEARCH_PAGES, searchPage, toCappedPage, toPage, walkOrderIndex } from '../../src/lib/db/pagination'

describe('toCappedPage', () => {
	it('hasta 1.000, el total exacto', () => {
		expect(toCappedPage([], COUNT_LIMIT, 1)).toEqual(toPage([], COUNT_LIMIT, 1))
		expect(toCappedPage([], 0, 1)).toMatchObject({ total: 0, pages: 1 })
	})

	it('por encima, «más de 1.000» y 20 páginas', () => {
		expect(toCappedPage([], COUNT_LIMIT + 1, 3)).toEqual({ rows: [], total: COUNT_LIMIT, page: 3, pages: SEARCH_PAGES, capped: true })
	})
})

describe('searchPage', () => {
	it('como mucho la 20', () => {
		expect(searchPage(3)).toBe(3)
		expect(searchPage(SEARCH_PAGES)).toBe(SEARCH_PAGES)
		expect(searchPage(201)).toBe(SEARCH_PAGES)
	})
})

describe('countSql', () => {
	it('cuenta como mucho una fila más que el tope, u otro límite', () => {
		expect(countSql('FROM games g WHERE g.eco = ?1')).toBe(
			`SELECT count(*) AS n FROM (SELECT 1 FROM games g WHERE g.eco = ?1 LIMIT ${COUNT_LIMIT + 1})`
		)
		expect(countSql('FROM games g', 2450)).toBe('SELECT count(*) AS n FROM (SELECT 1 FROM games g LIMIT 2450)')
	})
})

describe('walkOrderIndex', () => {
	const games = 132_438

	it('recorre el índice con muchas coincidencias, también en la página 20', () => {
		// «garcia», 46.725 partidas.
		expect(walkOrderIndex(46_725, games, 50)).toBe(true)
		expect(walkOrderIndex(46_725, games, SEARCH_PAGES * 50)).toBe(true)
		expect(walkOrderIndex(COUNT_LIMIT + 1, games, 5)).toBe(true)
	})

	it('no lo recorre con pocas, ni sin el total de la tabla', () => {
		// «santos», 1.263: en la página 20, 6.315 filas ordenándolas y 105.076 recorriendo games_date.
		expect(walkOrderIndex(1263, games, SEARCH_PAGES * 50)).toBe(false)
		expect(walkOrderIndex(479, games, 50)).toBe(false)
		expect(walkOrderIndex(46_725, null, 50)).toBe(false)
	})
})
