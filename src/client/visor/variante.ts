// Jugadas fuera de la partida: las que se hacen en el tablero del visor (la
// variante propia, que no se guarda).
import { normalizeMove } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { makeSan } from 'chessops/san'
import { parseSquare, parseUci } from 'chessops/util'
import { positionOf, standardUci } from '../../lib/chess/uci'

/** Una jugada y la posición que deja, con lo que necesitan la lista y el tablero. */
export interface LineMove {
	/** Media jugada (1 = primera de las blancas), según el FEN de partida. */
	ply: number
	san: string
	/** UCI estándar (el enroque como e1g1). */
	uci: string
	/** Posición tras la jugada. */
	fen: string
	check: boolean
}

/**
 * Juega una línea UCI desde `fen` y devuelve sus jugadas, hasta la primera
 * que no sea legal. Acepta el enroque de las dos formas (e1g1 y e1h1).
 */
export function playLine(fen: string, ucis: string[]): LineMove[] {
	const pos = positionOf(fen)
	if (!pos) return []
	let ply = (pos.fullmoves - 1) * 2 + (pos.turn === 'white' ? 1 : 2)
	const moves: LineMove[] = []
	for (const uci of ucis) {
		const parsed = parseUci(uci)
		if (!parsed) break
		const move = normalizeMove(pos, parsed)
		if (!pos.isLegal(move)) break
		const standard = standardUci(pos, move)
		const san = makeSan(pos, move)
		pos.play(move)
		moves.push({ ply: ply++, san, uci: standard, fen: makeFen(pos.toSetup()), check: pos.isCheck() })
	}
	return moves
}

/**
 * La jugada hecha en el tablero, de la casilla `orig` a `dest`, o null si no es
 * legal. Un peón que llega a la última fila corona dama: para probar una idea
 * basta, como en el explorador del repertorio.
 */
export function boardMove(fen: string, orig: string, dest: string): LineMove | null {
	const from = parseSquare(orig)
	const promotes = from !== undefined && positionOf(fen)?.board.getRole(from) === 'pawn' && /[18]$/.test(dest)
	return playLine(fen, [`${orig}${dest}${promotes ? 'q' : ''}`])[0] ?? null
}

/**
 * La variante tras jugar `moves` en su posición `step` (0 es la de la partida
 * de la que sale). Una sola jugada que ya es la siguiente no cambia nada: se
 * avanza por ella. Si no, las jugadas sustituyen a lo que seguía. Se va
 * siempre a la primera de ellas, la `step + 1`.
 */
export function extendVariant(variant: LineMove[], step: number, moves: LineMove[]): LineMove[] {
	if (moves.length === 1 && variant[step]?.uci === moves[0].uci) return variant
	return [...variant.slice(0, step), ...moves]
}
