import { describe, expect, it } from 'vitest'
import { pointsTiebreaks, TIEBREAK_NAMES, tiebreakLabel } from '../../src/lib/chess/tiebreaks'

describe('pointsTiebreaks', () => {
	const row = (points: number, ...tiebreaks: (number | null)[]) => ({ points, tiebreaks })

	it('da los desempates iguales a los puntos en todas las filas', () => {
		const standings = {
			tiebreaks: ['MP', 'GP', 'BH:MP'],
			rows: [row(15, 15, 24, 81), row(13, 13, 22.5, 88), row(12, 12, 22, 83), row(11, 11, 23, 69)]
		}
		expect(pointsTiebreaks(standings)).toEqual([0])
	})

	it('no da uno que sólo coincide en algunas filas', () => {
		const standings = { tiebreaks: ['GP', 'BH:MP'], rows: [row(6, 6, 40), row(5, 4, 38), row(4, 4, 36), row(3, 3, 30)] }
		expect(pointsTiebreaks(standings)).toEqual([])
	})

	it('no da uno sin valor en alguna fila', () => {
		const standings = { tiebreaks: ['MP'], rows: [row(4, 4), row(3, 3), row(2, 2), row(1, null)] }
		expect(pointsTiebreaks(standings)).toEqual([])
	})

	it('con menos de 4 equipos no da ninguno: pueden coincidir por casualidad', () => {
		expect(pointsTiebreaks({ tiebreaks: ['Dir_MP'], rows: [row(2, 2), row(1, 1), row(0, 0)] })).toEqual([])
		expect(pointsTiebreaks({ tiebreaks: ['MP'], rows: [] })).toEqual([])
	})
})

describe('tiebreakLabel', () => {
	it('explica el código con su nombre', () => {
		expect(tiebreakLabel('REP')).toBe('REP (rondas que decidió jugar)')
		expect(tiebreakLabel('BH:MP')).toBe('BH:MP (Buchholz por puntos de encuentro)')
	})

	it('deja el código solo si no se conoce', () => {
		expect(tiebreakLabel('Inventado')).toBe('Inventado')
	})

	it('explica igual las grafías de un mismo desempate', () => {
		// La FIDE en su lista de códigos, el texto del C.07 y Vega antes de seguirla.
		const same = [
			['REP', 'GE'],
			['BH/C1', 'BH-C1', 'Buc1'],
			['BH/M1', 'BH-M1', 'BucM'],
			['SB/C1', 'SB-C1', 'SB_C1'],
			['ARO/C1', 'ARO-C1', 'ARO1'],
			['BH:MP', 'EMPBH'],
			['MP', 'MatPnt']
		]
		for (const codes of same) {
			expect(new Set(codes.map((code) => TIEBREAK_NAMES[code])).size, codes.join(', ')).toBe(1)
			expect(TIEBREAK_NAMES[codes[0]]).toBeDefined()
		}
	})
})
