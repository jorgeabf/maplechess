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
	const place = (provinces: string[], communities: string[], name: string, named: string) => ({
		provinces,
		communities,
		name: `name : (${name})`,
		named: `name : (${named})`
	})
	const ALAVA = '"alava"* OR "araba"* OR "alaves"*'

	it('una provincia, por cualquiera de sus nombres o gentilicios, con la palabra escrita para el nombre', () => {
		expect(tournamentTerms('alava')).toEqual({ text: null, places: [place(['01'], [], '"alava"*', ALAVA)] })
		expect(tournamentTerms('Alavesa')).toEqual({ text: null, places: [place(['01'], [], '"alavesa"*', ALAVA)] })
		expect(tournamentTerms('ARABA')).toEqual({ text: null, places: [place(['01'], [], '"araba"*', ALAVA)] })
	})

	it('reconoce el plural del gentilicio', () => {
		expect(tournamentTerms('gallegos')?.places).toEqual([
			place([], ['12'], '"gallegos"*', '"galicia"* OR "gallego"* OR "gallega"* OR "galego"* OR "galega"*')
		])
		// Para ordenar, también el plural en -ces, que el prefijo «andaluz» no encuentra.
		expect(tournamentTerms('andaluces')?.places).toEqual([
			place([], ['01'], '"andaluces"*', '"andalucia"* OR "andaluz"* OR "andaluces"*')
		])
	})

	it('gana el nombre más largo', () => {
		expect(tournamentTerms('castilla y león')?.places).toEqual([
			place([], ['07'], '"castilla y leon"*', '"castilla y leon"* OR "castilla leon"* OR "castellanoleones"* OR "castellano leones"*')
		])
		expect(tournamentTerms('leon')?.places).toEqual([place(['24'], [], '"leon"*', '"leon"*')])
		expect(tournamentTerms('a coruña')?.places).toEqual([place(['15'], [], '"a coruna"*', '"coruna"* OR "corunes"*')])
	})

	it('si el nombre es de una provincia y de su comunidad, basta la comunidad', () => {
		expect(tournamentTerms('valenciana')?.places).toEqual([place([], ['10'], '"valenciana"*', '"valencia"*')])
		expect(tournamentTerms('valencia')?.places).toEqual([place(['46'], [], '"valencia"*', '"valencia"*')])
	})

	it('las demás palabras, como en prefixTerms, en el nombre o en la ciudad', () => {
		expect(tournamentTerms('open lugo 2026')).toEqual({
			text: '"open"* AND "2026"*',
			places: [place(['27'], [], '"lugo"*', '"lugo"* OR "lucense"*')]
		})
		expect(tournamentTerms('open gijon')).toEqual({ text: '"open"* AND "gijon"*', places: [] })
		expect(tournamentTerms('a')).toBeNull()
	})

	it('los torneos internacionales, también por su nombre en inglés, en singular y en plural', () => {
		expect(tournamentTerms('Campeonato Europeo')?.text).toBe('"campeonato"* AND ("europeo"* OR "europe"*)')
		expect(tournamentTerms('mundiales')?.text).toBe('("mundiales"* OR "world"*)')
		expect(tournamentTerms('olimpiada')?.text).toBe('("olimpiada"* OR "olympiad"*)')
		expect(tournamentTerms('copas galicia')).toEqual({
			text: '("copas"* OR "cup"*)',
			places: [place([], ['12'], '"galicia"*', '"galicia"* OR "gallego"* OR "gallega"* OR "galego"* OR "galega"*')]
		})
		// «ce» no: como prefijo, sería también «Cervera».
		expect(tournamentTerms('ce')?.text).toBe('"ce"*')
	})

	it('sólo las palabras de la lista tienen equivalente, no las propiedades de un objeto', () => {
		// Con un objeto, EQUIVALENTS['constructor'] era la función Object, también en plural.
		expect(tournamentTerms('constructor')?.text).toBe('"constructor"*')
		expect(tournamentTerms('constructores')?.text).toBe('"constructores"*')
	})
})
