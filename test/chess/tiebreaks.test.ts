import { describe, expect, it } from 'vitest'
import { TIEBREAK_NAMES, tiebreakLabel } from '../../src/lib/chess/tiebreaks'

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
