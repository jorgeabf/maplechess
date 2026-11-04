import { describe, expect, it } from 'vitest'
import { myPlace } from '../src/lib/tu-torneo'

const ME = 100
const individual = { isTeam: false, numbered: true }
const team = { isTeam: true, numbered: true }
const standing = (pos: number, name: string | null, fideId: number | null) => ({ pos, name, fideId })
const participant = (startRank: number, fideId: number | null, team: string | null = null) => ({ startRank, fideId, team })
const pairing = (board: number, white: number | null, black: number | null) => ({
	board,
	white: { fideId: white },
	black: { fideId: black }
})

describe('myPlace', () => {
	it('sin cookie no hay nada', () => {
		expect(myPlace(null, individual, [standing(1, 'Supuesto Irreal, Uno', ME)], [], [])).toBeNull()
	})

	it('en uno individual con clasificación, tu puesto de cuántos', () => {
		const rows = [standing(1, 'Supuesto Irreal, Uno', 7), standing(2, 'Supuesto Irreal, Dos', ME), standing(3, null, null)]
		expect(myPlace(ME, individual, rows, [], [])).toEqual({
			member: true,
			team: null,
			target: 'clasificacion',
			label: 'Tu puesto: 2.º de 3',
			board: null
		})
	})

	it('sin clasificación, tu número inicial de cuántos; en uno propio de lichess, nada arriba', () => {
		const participants = [participant(1, 7), participant(2, null), participant(3, ME)]
		expect(myPlace(ME, individual, null, participants, [])).toMatchObject({
			member: true,
			target: 'participantes',
			label: 'Tu número inicial: 3 de 3'
		})
		expect(myPlace(ME, { isTeam: false, numbered: false }, null, participants, [])).toMatchObject({
			member: true,
			target: 'participantes',
			label: null
		})
	})

	it('tu mesa en la próxima ronda, con blancas o con negras', () => {
		const rows = [standing(1, 'Supuesto Irreal, Uno', ME)]
		expect(myPlace(ME, individual, rows, [], [pairing(1, 7, 8), pairing(2, 9, ME)])?.board).toBe(2)
		expect(myPlace(ME, individual, rows, [], [pairing(4, ME, 8)])?.board).toBe(4)
	})

	it('con la mesa pero sin estar entre los jugadores, sólo la mesa', () => {
		expect(myPlace(ME, individual, [standing(1, 'Supuesto Irreal, Uno', 7)], [], [pairing(3, ME, 7)])).toEqual({
			member: false,
			team: null,
			target: null,
			label: null,
			board: 3
		})
	})

	it('si no juegas, null', () => {
		expect(myPlace(ME, individual, [standing(1, 'Supuesto Irreal, Uno', 7)], [], [pairing(1, 7, 8)])).toBeNull()
		expect(myPlace(ME, team, null, [participant(1, 7, 'Club Alfa')], [])).toBeNull()
	})

	it('no confunde a un homónimo sin FIDE ID contigo', () => {
		expect(myPlace(ME, individual, [standing(1, 'Supuesto Irreal, Uno', null)], [], [])).toBeNull()
	})

	it('por equipos, tu equipo y su puesto en la clasificación', () => {
		const participants = [participant(1, 7, 'Club Alfa'), participant(2, ME, 'Club Beta')]
		const rows = [standing(1, 'Club Alfa', null), standing(2, 'Club Beta', null)]
		expect(myPlace(ME, team, rows, participants, [])).toEqual({
			member: true,
			team: 'Club Beta',
			target: 'clasificacion',
			label: 'Tu equipo: Club Beta, 2.º de 2',
			board: null
		})
	})

	it('por equipos sin clasificación, a la plantilla de tu equipo', () => {
		const participants = [participant(1, ME, 'Club Beta')]
		expect(myPlace(ME, team, null, participants, [])).toMatchObject({
			team: 'Club Beta',
			target: 'plantilla',
			label: 'Tu equipo: Club Beta'
		})
	})

	it('sin equipo (una retransmisión de lichess), juegas, pero no hay adónde llevarte', () => {
		expect(myPlace(ME, team, null, [participant(1, ME, null)], [])).toEqual({
			member: true,
			team: null,
			target: null,
			label: null,
			board: null
		})
	})
})
