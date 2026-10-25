import { describe, expect, it } from 'vitest'
import { prefixTerms, tournamentTerms } from '../../src/lib/db/fts'

describe('prefixTerms', () => {
	it('cada palabra como prefijo, sin tildes', () => {
		expect(prefixTerms('Álava 2026')).toBe('"alava"* "2026"*')
	})

	it('una letra suelta sólo cuenta junto a una palabra más larga', () => {
		expect(prefixTerms('a')).toBeNull()
		expect(prefixTerms('j garcia')).toBe('"j"* "garcia"*')
	})
})

describe('tournamentTerms', () => {
	const place = (provinces: string[], communities: string[], name: string) => ({
		provinces,
		communities,
		name: `name : (${name})`
	})

	it('una provincia, por cualquiera de sus nombres o gentilicios, con la palabra escrita para el nombre', () => {
		expect(tournamentTerms('alava')).toEqual({ text: null, places: [place(['01'], [], '"alava"*')] })
		expect(tournamentTerms('Alavesa')).toEqual({ text: null, places: [place(['01'], [], '"alavesa"*')] })
		expect(tournamentTerms('ARABA')).toEqual({ text: null, places: [place(['01'], [], '"araba"*')] })
	})

	it('reconoce el plural del gentilicio', () => {
		expect(tournamentTerms('gallegos')?.places).toEqual([place([], ['12'], '"gallegos"*')])
		expect(tournamentTerms('andaluces')?.places).toEqual([place([], ['01'], '"andaluces"*')])
	})

	it('gana el nombre más largo', () => {
		expect(tournamentTerms('castilla y león')?.places).toEqual([place([], ['07'], '"castilla y leon"*')])
		expect(tournamentTerms('leon')?.places).toEqual([place(['24'], [], '"leon"*')])
		expect(tournamentTerms('a coruña')?.places).toEqual([place(['15'], [], '"a coruna"*')])
	})

	it('si el nombre es de una provincia y de su comunidad, basta la comunidad', () => {
		expect(tournamentTerms('valenciana')?.places).toEqual([place([], ['10'], '"valenciana"*')])
		expect(tournamentTerms('valencia')?.places).toEqual([place(['46'], [], '"valencia"*')])
	})

	it('las demás palabras, como en prefixTerms, en el nombre o en la ciudad', () => {
		expect(tournamentTerms('open lugo 2026')).toEqual({ text: '"open"* "2026"*', places: [place(['27'], [], '"lugo"*')] })
		expect(tournamentTerms('open gijon')).toEqual({ text: '"open"* "gijon"*', places: [] })
		expect(tournamentTerms('a')).toBeNull()
	})
})
