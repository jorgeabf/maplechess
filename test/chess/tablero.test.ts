import { describe, expect, it } from 'vitest'
import { placement, staticBoard } from '../../src/lib/chess/tablero'

const INITIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// 1.e4 f6 2.Qh5+: el rey negro, en jaque.
const CHECK = 'rnbqkbnr/ppppp1pp/5p2/7Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2'
// Tras 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O.
const CASTLED = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4'

const at = (board: ReturnType<typeof staticBoard>, x: number, y: number) =>
	board.pieces.find((p) => p.x === x && p.y === y)?.className

describe('staticBoard', () => {
	it('coloca las piezas desde arriba a la izquierda, con las blancas abajo', () => {
		const board = staticBoard(INITIAL, 'white')
		expect(board.pieces).toHaveLength(32)
		expect(at(board, 0, 7)).toBe('white rook')
		expect(at(board, 4, 7)).toBe('white king')
		expect(at(board, 3, 0)).toBe('black queen')
		expect(at(board, 4, 1)).toBe('black pawn')
	})

	it('gira el tablero con las negras abajo', () => {
		const board = staticBoard(INITIAL, 'black')
		expect(at(board, 7, 0)).toBe('white rook')
		expect(at(board, 3, 0)).toBe('white king')
		expect(at(board, 4, 7)).toBe('black queen')
		expect(at(board, 3, 6)).toBe('black pawn')
	})

	it('marca las dos casillas de la última jugada', () => {
		expect(staticBoard(INITIAL, 'white', 'e2e4').lastMove).toEqual([
			{ x: 4, y: 6 },
			{ x: 4, y: 4 }
		])
		expect(staticBoard(INITIAL, 'black', 'e2e4').lastMove).toEqual([
			{ x: 3, y: 1 },
			{ x: 3, y: 3 }
		])
	})

	it('marca el enroque en el rey, como chessground con UCI estándar', () => {
		expect(staticBoard(CASTLED, 'white', 'e1g1').lastMove).toEqual([
			{ x: 4, y: 7 },
			{ x: 6, y: 7 }
		])
	})

	it('marca el rey del bando que mueve si está en jaque', () => {
		expect(staticBoard(CHECK, 'white', 'd1h5').check).toEqual({ x: 4, y: 0 })
		expect(staticBoard(CHECK, 'black', 'd1h5').check).toEqual({ x: 3, y: 7 })
		expect(staticBoard(INITIAL, 'white').check).toBeNull()
	})

	it('sin jugada no marca casillas, y un FEN que no se lee da el tablero vacío', () => {
		expect(staticBoard(INITIAL, 'white').lastMove).toEqual([])
		expect(staticBoard('no es un FEN', 'white')).toEqual({ pieces: [], lastMove: [], check: null })
	})
})

describe('placement', () => {
	it('desplaza la casilla en tantos por ciento de su tamaño', () => {
		expect(placement({ x: 0, y: 0 })).toBe('transform:translate(0%,0%)')
		expect(placement({ x: 5, y: 7 })).toBe('transform:translate(500%,700%)')
	})
})
