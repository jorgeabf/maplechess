import { describe, expect, it } from 'vitest'
import { boardMove, extendVariant, playLine, type LineMove } from '../src/client/visor/variante'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// Juegan negras en la jugada 34.
const BLACK_34 = '6k1/5ppp/8/8/8/2q5/5PPP/3Q2K1 b - - 0 34'
// Las blancas pueden enrocar corto y el peón de a7 corona.
const CASTLE = '4k3/P7/8/8/8/8/8/4K2R w K - 0 40'

describe('playLine', () => {
	it('da cada jugada con su SAN, su número y la posición que deja', () => {
		const moves = playLine(START, ['e2e4', 'e7e5', 'g1f3'])
		expect(moves.map((m) => [m.ply, m.san, m.uci])).toEqual([
			[1, 'e4', 'e2e4'],
			[2, 'e5', 'e7e5'],
			[3, 'Nf3', 'g1f3']
		])
		expect(moves[2].fen).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2')
	})

	it('numera desde el FEN, también si empiezan las negras', () => {
		const moves = playLine(BLACK_34, ['c3c1', 'd1c1'])
		expect(moves.map((m) => [m.ply, m.san])).toEqual([
			[68, 'Qc1'],
			[69, 'Qxc1']
		])
	})

	it('marca el jaque', () => {
		expect(playLine(BLACK_34, ['c3e1'])[0]).toMatchObject({ san: 'Qe1+', check: true })
	})

	it('para en la primera jugada ilegal o mal escrita', () => {
		expect(playLine(START, ['e2e4', 'e2e4', 'd2d4'])).toHaveLength(1)
		expect(playLine(START, ['zz'])).toEqual([])
		expect(playLine('no es un FEN', ['e2e4'])).toEqual([])
	})

	it('acepta el enroque de las dos formas y lo da como e1g1', () => {
		expect(playLine(CASTLE, ['e1g1'])[0]).toMatchObject({ san: 'O-O', uci: 'e1g1' })
		expect(playLine(CASTLE, ['e1h1'])[0]).toMatchObject({ san: 'O-O', uci: 'e1g1' })
	})
})

describe('boardMove', () => {
	it('corona a la pieza elegida', () => {
		expect(boardMove(CASTLE, 'a7', 'a8', 'queen')).toMatchObject({ san: 'a8=Q+', uci: 'a7a8q' })
		expect(boardMove(CASTLE, 'a7', 'a8', 'knight')).toMatchObject({ san: 'a8=N', uci: 'a7a8n' })
	})

	it('sin pieza, la coronación no es legal', () => {
		expect(boardMove(CASTLE, 'a7', 'a8')).toBeNull()
	})

	it('null si la jugada no es legal', () => {
		expect(boardMove(START, 'e2', 'e5')).toBeNull()
	})
})

describe('extendVariant', () => {
	const [e4, e5, nf3] = playLine(START, ['e2e4', 'e7e5', 'g1f3'])
	const [, c5] = playLine(START, ['e2e4', 'c7c5'])
	const line: LineMove[] = [e4, e5, nf3]

	it('empieza la variante desde la posición de la partida', () => {
		expect(extendVariant([], 0, [e4])).toEqual([e4])
	})

	it('con la jugada que ya seguía, la variante no cambia', () => {
		expect(extendVariant(line, 1, [e5])).toBe(line)
	})

	it('con otra, sustituye a lo que seguía', () => {
		expect(extendVariant(line, 1, [c5])).toEqual([e4, c5])
	})

	it('una línea del motor sustituye a lo que seguía aunque empiece igual', () => {
		expect(extendVariant(line, 0, [e4, c5])).toEqual([e4, c5])
	})
})
