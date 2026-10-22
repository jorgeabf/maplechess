import { describe, expect, it } from 'vitest'
import { formatScore, gameOver, parseInfo, whitePov, winningChances } from '../../src/lib/chess/uci'

const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const WHITE_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('parseInfo', () => {
	it('lee profundidad, multipv, puntuación y variante', () => {
		expect(
			parseInfo('info depth 18 seldepth 24 multipv 2 score cp -34 nodes 123456 nps 800000 time 150 pv e7e5 g1f3 b8c6')
		).toEqual({ depth: 18, multipv: 2, score: { cp: -34 }, bound: false, pv: ['e7e5', 'g1f3', 'b8c6'] })
	})

	it('lee mates y marca las puntuaciones provisionales', () => {
		expect(parseInfo('info depth 9 multipv 1 score mate -3 upperbound pv h7h6')).toMatchObject({
			score: { mate: -3 },
			bound: true
		})
	})

	it('ignora las líneas sin variante', () => {
		expect(parseInfo('info depth 1 currmove e2e4 currmovenumber 1')).toBeNull()
		expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeNull()
		expect(parseInfo('bestmove e2e4 ponder e7e5')).toBeNull()
	})
})

describe('whitePov', () => {
	it('invierte la puntuación cuando mueven las negras', () => {
		expect(whitePov({ cp: 30 }, BLACK_TO_MOVE)).toEqual({ cp: -30 })
		expect(whitePov({ mate: 2 }, BLACK_TO_MOVE)).toEqual({ mate: -2 })
		expect(whitePov({ cp: 30 }, WHITE_TO_MOVE)).toEqual({ cp: 30 })
	})
})

describe('winningChances', () => {
	it('es simétrica, acotada y satura con el mate', () => {
		expect(winningChances({ cp: 0 })).toBe(0)
		expect(winningChances({ cp: 300 })).toBeCloseTo(-winningChances({ cp: -300 }))
		expect(winningChances({ cp: 300 })).toBeGreaterThan(0.4)
		expect(winningChances({ cp: 100000 })).toBeLessThan(1)
		expect(winningChances({ mate: 3 })).toBe(1)
		expect(winningChances({ mate: -1 })).toBe(-1)
	})
})

describe('gameOver', () => {
	it('da el mate con el ganador', () => {
		// Mate del loco: mueven blancas y están en mate.
		expect(gameOver('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toEqual({
			reason: 'mate',
			winning: -1
		})
		// Mate del pastor: mueven negras.
		expect(gameOver('r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4')).toEqual({
			reason: 'mate',
			winning: 1
		})
	})

	it('da tablas con el rey ahogado y sin material para dar mate', () => {
		expect(gameOver('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ reason: 'stalemate', winning: 0 })
		expect(gameOver('8/8/8/8/8/8/k7/7K w - - 0 1')).toEqual({ reason: 'material', winning: 0 })
	})

	it('no da nada si la partida sigue o el FEN no vale', () => {
		expect(gameOver(WHITE_TO_MOVE)).toBeNull()
		expect(gameOver('esto no es un FEN')).toBeNull()
	})
})

describe('formatScore', () => {
	it('formatea peones y mates', () => {
		expect(formatScore({ cp: 35 })).toBe('+0.35')
		expect(formatScore({ cp: -120 })).toBe('−1.20')
		expect(formatScore({ cp: 0 })).toBe('0.00')
		expect(formatScore({ mate: 3 })).toBe('#3')
		expect(formatScore({ mate: -2 })).toBe('#−2')
	})
})
