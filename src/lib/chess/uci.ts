// Notación UCI de las jugadas y lectura de la salida UCI de Stockfish.
//
// Stockfish da la puntuación desde el punto de vista del bando que mueve; para
// la barra y las líneas se pasa al de las blancas, que es lo habitual.
import { Chess, type Position } from 'chessops/chess'
import { parseFen } from 'chessops/fen'
import type { Move } from 'chessops/types'
import { makeSquare, makeUci, squareFile, squareFromCoords, squareRank } from 'chessops/util'

/**
 * UCI estándar de una jugada legal en `pos` (antes de jugarla). chessops
 * representa el enroque como rey→torre (e1h1); aquí sale como e1g1, que es lo
 * que esperan los motores, lichess y chessground. Para leerla de vuelta,
 * normalizeMove de chessops acepta las dos formas.
 */
export function standardUci(pos: Position, move: Move): string {
	if ('from' in move && pos.board.getRole(move.from) === 'king') {
		const target = pos.board.get(move.to)
		if (target?.role === 'rook' && target.color === pos.turn) {
			const file = squareFile(move.to) > squareFile(move.from) ? 6 : 2
			return makeSquare(move.from) + makeSquare(squareFromCoords(file, squareRank(move.from))!)
		}
	}
	return makeUci(move)
}

export type Score = { cp: number } | { mate: number }

export interface UciInfo {
	depth: number
	multipv: number
	/** Desde el punto de vista del bando que mueve. */
	score: Score
	/** Puntuación provisional (lowerbound/upperbound) de una búsqueda a medias. */
	bound: boolean
	pv: string[]
}

/** Lee una línea "info … score … pv …"; devuelve null si no es una línea con variante. */
export function parseInfo(line: string): UciInfo | null {
	const tokens = line.trim().split(/\s+/)
	if (tokens[0] !== 'info') return null
	let depth = 0
	let multipv = 1
	let score: Score | null = null
	let bound = false
	let pv: string[] = []
	for (let i = 1; i < tokens.length; i++) {
		switch (tokens[i]) {
			case 'depth':
				depth = Number(tokens[++i])
				break
			case 'multipv':
				multipv = Number(tokens[++i])
				break
			case 'score': {
				const kind = tokens[++i]
				const value = Number(tokens[++i])
				score = kind === 'mate' ? { mate: value } : { cp: value }
				break
			}
			case 'lowerbound':
			case 'upperbound':
				bound = true
				break
			case 'pv':
				pv = tokens.slice(i + 1)
				i = tokens.length
				break
		}
	}
	if (!score || pv.length === 0 || !depth) return null
	return { depth, multipv, score, bound, pv }
}

/** Bando que mueve según el FEN ("w" o "b"). */
export function sideToMove(fen: string): 'white' | 'black' {
	return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

/** Pasa una puntuación del bando que mueve al de las blancas. */
export function whitePov(score: Score, fen: string): Score {
	if (sideToMove(fen) === 'white') return score
	return 'mate' in score ? { mate: -score.mate } : { cp: -score.cp }
}

/**
 * Probabilidad de victoria de -1 (ganan negras) a 1 (ganan blancas), con la
 * curva que usa lichess para su barra de evaluación.
 */
export function winningChances(score: Score): number {
	if ('mate' in score) return score.mate > 0 ? 1 : score.mate < 0 ? -1 : 0
	const cp = Math.max(-1000, Math.min(1000, score.cp))
	return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1
}

/** Posición de un FEN, o null si no es válido. */
export function positionOf(fen: string): Chess | null {
	const setup = parseFen(fen)
	if (setup.isErr) return null
	const pos = Chess.fromSetup(setup.value)
	return pos.isErr ? null : pos.value
}

export interface GameOver {
	reason: 'mate' | 'stalemate' | 'material'
	/** Como winningChances: 1 si ganan las blancas, -1 si las negras, 0 tablas. */
	winning: number
}

/**
 * La partida ha terminado en esta posición: mate, rey ahogado o material
 * insuficiente para dar mate. Ahí Stockfish no da ninguna línea (sólo
 * "bestmove (none)"), así que no hay nada que preguntarle.
 */
export function gameOver(fen: string): GameOver | null {
	const pos = positionOf(fen)
	if (!pos) return null
	if (pos.isCheckmate()) return { reason: 'mate', winning: pos.turn === 'white' ? -1 : 1 }
	if (pos.isStalemate()) return { reason: 'stalemate', winning: 0 }
	if (pos.isInsufficientMaterial()) return { reason: 'material', winning: 0 }
	return null
}

/** "+0.35", "−1.20", "#3", "#−2" (desde el punto de vista de las blancas). */
export function formatScore(score: Score): string {
	if ('mate' in score) return score.mate < 0 ? `#−${-score.mate}` : `#${score.mate}`
	const pawns = score.cp / 100
	if (pawns === 0) return '0.00'
	return `${pawns > 0 ? '+' : '−'}${Math.abs(pawns).toFixed(2)}`
}

/** Evaluación anotada en el PGN (%eval, ver movetree.ts) como puntuación. */
export function annotatedScore(evaluation: { cp?: number; mate?: number }): Score {
	return evaluation.mate !== undefined ? { mate: evaluation.mate } : { cp: evaluation.cp ?? 0 }
}
