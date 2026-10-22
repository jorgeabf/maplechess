import { describe, expect, it } from 'vitest'
import { matchName, normalizeName } from '../../src/lib/chess/names'

// Nombres inventados.
describe('normalizeName', () => {
	it('quita tildes, pasa a minúsculas y separa apellidos y nombre', () => {
		expect(normalizeName('Pruébez Ensayo, Tomás')).toBe('pruebez ensayo, tomas')
	})

	it('admite la coma sin espacio que usan algunos PGN', () => {
		expect(normalizeName('Pruebez Ensayo,Tomas')).toBe('pruebez ensayo, tomas')
	})

	it('trata guiones y puntos como separadores', () => {
		expect(normalizeName('Ficticio-Inventádez, M.  Ángel')).toBe('ficticio inventadez, m angel')
	})

	it('sin coma devuelve las palabras', () => {
		expect(normalizeName('  Nombre   Supuesto ')).toBe('nombre supuesto')
	})
})

describe('matchName', () => {
	const players = [
		{ name: 'Pruébez Ensayo, Tomás', value: 1 },
		{ name: 'Supuesto Irreal, Otro', value: 2 },
		{ name: 'Ejémplez Inventado, Juan', value: 3 },
		{ name: 'Ejémplez Inventado, Juan Carlos', value: 4 }
	]

	it('cruza por forma canónica', () => {
		expect(matchName('Pruebez Ensayo,Tomas', players)).toBe(1)
	})

	it('cruza con las palabras en otro orden', () => {
		expect(matchName('Otro Supuesto Irreal', players)).toBe(2)
	})

	it('cruza si falta un apellido y el candidato es único', () => {
		expect(matchName('Supuesto, Otro', players)).toBe(2)
	})

	it('prefiere la coincidencia exacta a la parcial', () => {
		expect(matchName('Ejemplez Inventado, Juan', players)).toBe(3)
	})

	it('no asigna si la coincidencia parcial es ambigua', () => {
		expect(matchName('Ejemplez, Juan', players)).toBeUndefined()
	})

	it('no cruza por una sola palabra', () => {
		expect(matchName('Ejemplez', players)).toBeUndefined()
	})
})
