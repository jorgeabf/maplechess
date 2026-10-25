import { describe, expect, it } from 'vitest'
import { legalMoves, readMove } from '../src/client/visor/campo-jugada'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// Las blancas pueden enrocar a los dos lados y el peón de b7 corona.
const CASTLE = '4k3/1P6/8/8/8/8/8/R3K2R w KQ - 0 40'
// Dos caballos llegan a d4; el alfil de c4 y el peón de b2 a la columna b.
const KNIGHTS = '4k3/8/8/1N3N2/2B5/8/1P6/4K3 w - - 0 40'

describe('readMove', () => {
	it('lee la SAN y la UCI, también con signos detrás', () => {
		expect(readMove(START, 'Nf3')).toEqual({ kind: 'move', uci: 'g1f3' })
		expect(readMove(START, 'g1f3')).toEqual({ kind: 'move', uci: 'g1f3' })
		expect(readMove(START, ' e4!? ')).toEqual({ kind: 'move', uci: 'e2e4' })
		expect(readMove(START, 'E2-E4')).toEqual({ kind: 'move', uci: 'e2e4' })
	})

	it('acepta la pieza en minúscula; la «b», primero como peón', () => {
		expect(readMove(START, 'nf3')).toEqual({ kind: 'move', uci: 'g1f3' })
		expect(readMove(KNIGHTS, 'b4')).toEqual({ kind: 'move', uci: 'b2b4' })
		expect(readMove(KNIGHTS, 'bd5')).toEqual({ kind: 'move', uci: 'c4d5' })
	})

	it('acepta el enroque con ceros o letras, y lo da como e1g1', () => {
		expect(readMove(CASTLE, '0-0')).toEqual({ kind: 'move', uci: 'e1g1' })
		expect(readMove(CASTLE, 'o-o-o')).toEqual({ kind: 'move', uci: 'e1c1' })
		expect(readMove(CASTLE, 'O-O+')).toEqual({ kind: 'move', uci: 'e1g1' })
	})

	it('una coronación con pieza se juega; sin ella, pide elegirla', () => {
		expect(readMove(CASTLE, 'b8=N')).toEqual({ kind: 'move', uci: 'b7b8n' })
		expect(readMove(CASTLE, 'b7b8q')).toEqual({ kind: 'move', uci: 'b7b8q' })
		expect(readMove(CASTLE, 'b8')).toEqual({ kind: 'promotion', orig: 'b7', dest: 'b8' })
		expect(readMove(CASTLE, 'b7b8')).toEqual({ kind: 'promotion', orig: 'b7', dest: 'b8' })
	})

	it('si hay varias jugadas así, da las posibles', () => {
		expect(readMove(KNIGHTS, 'Nd4')).toEqual({ kind: 'ambiguous', options: ['Nbd4', 'Nfd4'] })
		expect(readMove(KNIGHTS, 'Nbd4')).toEqual({ kind: 'move', uci: 'b5d4' })
	})

	it('lo que no es legal o no es una jugada', () => {
		expect(readMove(START, 'Nf6')).toEqual({ kind: 'illegal' })
		expect(readMove(START, 'hola')).toEqual({ kind: 'illegal' })
		expect(readMove('no es un FEN', 'e4')).toEqual({ kind: 'illegal' })
		expect(readMove(START, '   ')).toEqual({ kind: 'empty' })
	})
})

describe('legalMoves', () => {
	it('las jugadas legales en SAN', () => {
		const moves = legalMoves(START)
		expect(moves).toHaveLength(20)
		expect(moves).toEqual(expect.arrayContaining(['e4', 'Nf3', 'a3']))
	})

	it('el enroque una vez y cada coronación a las cuatro piezas', () => {
		const moves = legalMoves(CASTLE)
		expect(moves.filter((m) => m === 'O-O')).toHaveLength(1)
		expect(moves).toEqual(expect.arrayContaining(['O-O-O', 'b8=Q+', 'b8=R+', 'b8=B', 'b8=N']))
	})
})
