import { describe, expect, it } from 'vitest'
import { myPlace } from '../src/lib/tu-torneo'

const ME = 100
const individual = { isTeam: false, numbered: true }
const team = { isTeam: true, numbered: true }
const standing = (pos: number, startRank: number, name: string | null, fideId: number | null) => ({ pos, startRank, name, fideId })
const participant = (startRank: number, fideId: number | null, team: string | null = null) => ({ startRank, fideId, team })
const pairing = (board: number, white: number | null, black: number | null) => ({
	board,
	white: { fideId: white },
	black: { fideId: black }
})

describe('myPlace', () => {
	it('sin cookie no hay nada', () => {
		expect(myPlace(null, individual, [standing(1, 1, 'Supuesto Irreal, Uno', ME)], [], [])).toBeNull()
	})

	it('en uno individual con clasificación, tu puesto de cuántos y el número de tu fila', () => {
		const rows = [standing(1, 4, 'Supuesto Irreal, Uno', 7), standing(2, 9, 'Supuesto Irreal, Dos', ME), standing(3, 1, null, null)]
		expect(myPlace(ME, individual, rows, [], [])).toEqual({
			member: true,
			team: null,
			target: 'clasificacion',
			startRank: 9,
			label: 'Tu puesto: 2.º de 3',
			board: null
		})
	})

	it('sin clasificación, tu número inicial de cuántos', () => {
		const participants = [participant(1, 7), participant(2, null), participant(3, ME)]
		expect(myPlace(ME, individual, null, participants, [])).toMatchObject({
			member: true,
			target: 'participantes',
			startRank: 3,
			label: 'Tu número inicial: 3 de 3'
		})
	})

	it('en uno propio de lichess o de la FCA (numerados por ELO o por el nombre), tu fila sin nada arriba', () => {
		const participants = [participant(1, 7), participant(2, ME)]
		expect(myPlace(ME, { isTeam: false, numbered: false }, null, participants, [])).toMatchObject({
			member: true,
			target: 'participantes',
			startRank: 2,
			label: null
		})
	})

	it('tu mesa en la próxima ronda, con blancas o con negras', () => {
		const rows = [standing(1, 1, 'Supuesto Irreal, Uno', ME)]
		expect(myPlace(ME, individual, rows, [], [pairing(1, 7, 8), pairing(2, 9, ME)])?.board).toBe(2)
		expect(myPlace(ME, individual, rows, [], [pairing(4, ME, 8)])?.board).toBe(4)
	})

	it('con la mesa pero sin estar entre los jugadores, sólo la mesa', () => {
		expect(myPlace(ME, individual, [standing(1, 1, 'Supuesto Irreal, Uno', 7)], [], [pairing(3, ME, 7)])).toEqual({
			member: false,
			team: null,
			target: null,
			startRank: null,
			label: null,
			board: 3
		})
	})

	it('si no juegas, null', () => {
		expect(myPlace(ME, individual, [standing(1, 1, 'Supuesto Irreal, Uno', 7)], [], [pairing(1, 7, 8)])).toBeNull()
		expect(myPlace(ME, team, null, [participant(1, 7, 'Club Alfa')], [])).toBeNull()
	})

	it('no confunde a un homónimo sin FIDE ID contigo', () => {
		expect(myPlace(ME, individual, [standing(1, 1, 'Supuesto Irreal, Uno', null)], [], [])).toBeNull()
	})

	it('por equipos, tu equipo, su puesto y su número en la clasificación', () => {
		const participants = [participant(1, 7, 'Club Alfa'), participant(2, ME, 'Club Beta')]
		const rows = [standing(1, 2, 'Club Alfa', null), standing(2, 1, 'Club Beta', null)]
		expect(myPlace(ME, team, rows, participants, [])).toEqual({
			member: true,
			team: 'Club Beta',
			target: 'clasificacion',
			startRank: 1,
			label: 'Tu equipo: Club Beta, 2.º de 2',
			board: null
		})
	})

	it('con dos equipos del mismo nombre, el de mejor puesto', () => {
		const rows = [standing(1, 5, 'Club Alfa', null), standing(2, 3, 'Club Beta', null), standing(3, 8, 'Club Beta', null)]
		expect(myPlace(ME, team, rows, [participant(1, ME, 'Club Beta')], [])).toMatchObject({
			startRank: 3,
			label: 'Tu equipo: Club Beta, 2.º de 3'
		})
	})

	it('por equipos sin clasificación, o sin tu equipo en ella, a su plantilla', () => {
		const participants = [participant(1, ME, 'Club Beta')]
		const expected = { team: 'Club Beta', target: 'plantilla', startRank: null, label: 'Tu equipo: Club Beta' }
		expect(myPlace(ME, team, null, participants, [])).toMatchObject(expected)
		expect(myPlace(ME, team, [standing(1, 1, 'Club Alfa', null)], participants, [])).toMatchObject(expected)
	})

	it('sin equipo (una retransmisión de lichess), juegas, pero no hay adónde llevarte', () => {
		expect(myPlace(ME, team, null, [participant(1, ME, null)], [])).toEqual({
			member: true,
			team: null,
			target: null,
			startRank: null,
			label: null,
			board: null
		})
	})
})
