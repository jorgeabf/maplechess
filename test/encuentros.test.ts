import { describe, expect, it } from 'vitest'
import { gameMatches } from '../src/lib/encuentros'

const member = (team: string | null, name: string, fideId: number | null = null) => ({ team, name, fideId })
const game = (id: number, round: number, white: [string, number | null], black: [string, number | null]) => ({
	id,
	round,
	whiteName: white[0],
	whiteFideId: white[1],
	blackName: black[0],
	blackFideId: black[1]
})

describe('gameMatches', () => {
	const members = [
		member('Club Alfa', 'Supuesto Irreal, Uno', 100),
		member('Club Alfa', 'Supuesto Irreal, Dos', 101),
		member('Club Beta', 'Inventado Ficticio, Tres', 200),
		member('Club Beta', 'Inventado Ficticio, Cuatro', null)
	]

	it('pone los dos equipos en el orden del primer tablero, en todas las partidas del encuentro', () => {
		const matches = gameMatches(
			[
				game(1, 1, ['Supuesto Irreal, Uno', 100], ['Inventado Ficticio, Tres', 200]),
				game(2, 1, ['Inventado Ficticio, Cuatro', null], ['Supuesto Irreal, Dos', 101])
			],
			members
		)
		expect(matches.get(1)).toEqual(['Club Alfa', 'Club Beta'])
		expect(matches.get(2)).toEqual(['Club Alfa', 'Club Beta'])
	})

	it('decide el orden en cada ronda', () => {
		const matches = gameMatches(
			[
				game(1, 1, ['Supuesto Irreal, Uno', 100], ['Inventado Ficticio, Tres', 200]),
				game(2, 2, ['Inventado Ficticio, Tres', 200], ['Supuesto Irreal, Uno', 100])
			],
			members
		)
		expect(matches.get(2)).toEqual(['Club Beta', 'Club Alfa'])
	})

	it('busca primero por el FIDE ID y, sin él, por el nombre', () => {
		// La plantilla corta el nombre; la partida lo trae entero, con el mismo FIDE ID.
		const matches = gameMatches(
			[game(1, 1, ['Supuesto Irreal, Uno Entero', 100], ['Inventado Ficticio, Cuatro', null])],
			members
		)
		expect(matches.get(1)).toEqual(['Club Alfa', 'Club Beta'])
	})

	it('no da encuentro si falta el equipo de un jugador o si los dos son del mismo', () => {
		const matches = gameMatches(
			[
				game(1, 1, ['Nadie, Fuera', 999], ['Inventado Ficticio, Tres', 200]),
				game(2, 1, ['Supuesto Irreal, Uno', 100], ['Supuesto Irreal, Dos', 101])
			],
			members
		)
		expect(matches.size).toBe(0)
	})

	it('no adivina el equipo de un nombre que está en dos', () => {
		const matches = gameMatches(
			[game(1, 1, ['Jugador retirado', null], ['Inventado Ficticio, Tres', 200])],
			[...members, member('Club Alfa', 'Jugador retirado'), member('Club Gamma', 'Jugador retirado')]
		)
		expect(matches.has(1)).toBe(false)
	})

	it('no cuenta a los participantes sin equipo', () => {
		const matches = gameMatches(
			[game(1, 1, ['Supuesto Irreal, Uno', 100], ['Inventado Ficticio, Tres', 200])],
			[member(null, 'Supuesto Irreal, Uno', 100), member(null, 'Inventado Ficticio, Tres', 200)]
		)
		expect(matches.size).toBe(0)
	})
})
