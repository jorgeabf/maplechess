import { describe, expect, it } from 'vitest'
import { CATEGORIES, CHAMPIONSHIPS, championshipsOf } from '../src/lib/campeonatos'

describe('CHAMPIONSHIPS', () => {
	it('una edición por categoría y año', () => {
		const keys = CHAMPIONSHIPS.map((c) => `${c.category} ${c.year}`)
		expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([])
	})

	it('cada categoría, de la más reciente a la más antigua, desde 2015', () => {
		for (const { id } of CATEGORIES) {
			const years = CHAMPIONSHIPS.filter((c) => c.category === id).map((c) => c.year)
			expect(years.length, id).toBeGreaterThan(0)
			expect(years, id).toEqual([...years].sort((a, b) => b - a))
			expect(Math.min(...years), id).toBeGreaterThanOrEqual(2015)
		}
	})

	it('cada torneo da como mucho el absoluto y el femenino', () => {
		for (const { source, sourceKey } of CHAMPIONSHIPS) {
			const categories = championshipsOf(source, sourceKey).map((c) => c.category)
			if (categories.length > 1) expect(categories, sourceKey).toEqual(['absoluto', 'femenino'])
		}
	})

	it('el campeón que no es el primero, por un número inicial válido', () => {
		for (const { sourceKey, startRank } of CHAMPIONSHIPS) {
			if (startRank !== undefined) expect(Number.isInteger(startRank) && startRank > 0, sourceKey).toBe(true)
		}
	})

	// Más estricta que isMinorsTournament, que deja pasar Sub 16 y Sub 18: aquí tampoco van.
	it('ningún campeonato de menores', () => {
		for (const { sourceKey } of CHAMPIONSHIPS) expect(sourceKey).not.toMatch(/sub-?1[0-8]|cadete|juvenil|edades|selecc/)
	})
})

describe('championshipsOf', () => {
	it('los títulos de un torneo de la lista, y ninguno de uno que no está', () => {
		expect(championshipsOf('info64', 'ce-rapido-2026')).toEqual([
			{ category: 'rapido', year: 2026, source: 'info64', sourceKey: 'ce-rapido-2026' }
		])
		expect(championshipsOf('info64', 'campeonato-de-espana-individual-absoluto-y-femenino-2026').map((c) => c.category)).toEqual([
			'absoluto',
			'femenino'
		])
		expect(championshipsOf('lichess', 'ce-rapido-2026')).toEqual([])
		expect(championshipsOf('info64', 'open-inventado-2026')).toEqual([])
	})
})
