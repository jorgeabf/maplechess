import { describe, expect, it } from 'vitest'
import { placeTerms, prefixTerms } from '../../src/lib/db/fts'

describe('prefixTerms', () => {
	it('cada palabra como prefijo, sin tildes', () => {
		expect(prefixTerms('Álava 2026')).toBe('"alava"* "2026"*')
	})

	it('una letra suelta sólo cuenta junto a una palabra más larga', () => {
		expect(prefixTerms('a')).toBeNull()
		expect(prefixTerms('j garcia')).toBe('"j"* "garcia"*')
	})
})

describe('placeTerms', () => {
	it('una provincia, por su topónimo, su nombre cooficial y su gentilicio', () => {
		const alava = '("alava"* OR "araba"* OR "alaves"*)'
		expect(placeTerms('alava')).toBe(alava)
		expect(placeTerms('Álava 2026')).toBe(`${alava} AND "2026"*`)
		expect(placeTerms('Alavesa')).toBe(alava)
		expect(placeTerms('ARABA')).toBe(alava)
	})

	it('reconoce el plural del gentilicio', () => {
		const galicia = '("galicia"* OR "gallego"* OR "gallega"* OR "galego"* OR "galega"*)'
		expect(placeTerms('gallegos')).toBe(galicia)
		expect(placeTerms('galegas')).toBe(galicia)
		expect(placeTerms('andaluces')).toBe('("andalucia"* OR "andaluz"*)')
	})

	it('quita los nombres que ya encuentra otro', () => {
		// «madrid» encuentra «Comunidad de Madrid»; «balear», «Baleares» e «Illes Balears».
		expect(placeTerms('comunidad de madrid')).toBe('("madrid"* OR "madrileno"* OR "madrilena"*)')
		expect(placeTerms('illes balears')).toBe('"balear"*')
		expect(placeTerms('a coruña')).toBe('("coruna"* OR "corunes"*)')
	})

	it('gana el nombre más largo', () => {
		expect(placeTerms('castilla y león')).toBe(
			'("castilla y leon"* OR "castellanoleones"* OR "castellano leones"*)'
		)
		expect(placeTerms('leon')).toBe('"leon"*')
	})

	it('si el nombre es de dos sitios, busca los de los dos', () => {
		// «valenciana» es de la provincia y de la comunidad: «valencia» encuentra todo.
		expect(placeTerms('valenciana')).toBe('"valencia"*')
		expect(placeTerms('comunitat valenciana')).toBe('("valenciano"* OR "valenciana"*)')
	})

	it('las demás palabras, como en prefixTerms', () => {
		expect(placeTerms('open lugo')).toBe('"open"* AND ("lugo"* OR "lucense"*)')
		expect(placeTerms('a')).toBeNull()
	})
})
