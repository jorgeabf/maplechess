// Jugadas fuera de la partida: las de una línea del motor y las que se hacen
// en el tablero del visor (la variante propia, que no se guarda). Las comparten
// el panel del motor, que pinta sus líneas con ellas, y el visor, que las
// recorre en el tablero y las lleva en el enlace (#j12+g1f3+b8c6).
import { normalizeMove } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { makeSan } from 'chessops/san'
import { parseUci, roleToChar } from 'chessops/util'
import type { ViewerNode } from '../../lib/chess/movetree'
import { positionOf, standardUci } from '../../lib/chess/uci'
import type { PromotionRole } from './coronacion'

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
 * legal. Un peón que llega a la última fila corona a `promotion`, la pieza que
 * se ha elegido en el diálogo (coronacion.ts); sin ella, la jugada no es legal.
 */
export function boardMove(fen: string, orig: string, dest: string, promotion?: PromotionRole): LineMove | null {
	return playLine(fen, [`${orig}${dest}${promotion ? roleToChar(promotion) : ''}`])[0] ?? null
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

/** Lo que pide el enlace: un nodo de la partida y, desde él, las jugadas de la variante propia en UCI. */
export interface Link {
	node: number
	moves: string[]
}

/**
 * «#j12+g1f3+b8c6» → nodo 12 y las jugadas g1f3 y b8c6; null si el hash no es
 * de una jugada. Las jugadas no se comprueban aquí: lo que no vale lo
 * descarta followLink.
 */
export function parseLink(hash: string): Link | null {
	const match = /^#j(\d+)((?:\+[^+]*)*)$/.exec(hash)
	return match ? { node: Number(match[1]), moves: match[2].split('+').slice(1) } : null
}

/**
 * El hash de lo que se ve: el nodo y las jugadas de la variante hasta la que se
 * ve. La posición inicial sin variante, sin hash.
 */
export function makeLink(node: number, moves: Pick<LineMove, 'uci'>[]): string {
	if (node === 0 && moves.length === 0) return ''
	return `#j${node}${moves.map((move) => `+${move.uci}`).join('')}`
}

/**
 * Adónde lleva un enlace: sus jugadas se juegan desde el nodo y, mientras
 * coinciden con la partida (o con una variante del PGN), se siguen por ella;
 * el resto es la variante propia. Se para en la primera que no es legal, y lo
 * que sigue se descarta sin aviso. null si el nodo no existe.
 */
export function followLink(
	nodes: Pick<ViewerNode, 'fen' | 'uci' | 'children'>[],
	link: Link
): { node: number; variant: LineMove[] } | null {
	if (!nodes[link.node]) return null
	let node = link.node
	let variant = playLine(nodes[node].fen, link.moves)
	for (;;) {
		const next = variant[0]
		const child = next && nodes[node].children.find((id) => nodes[id].uci === next.uci)
		if (child === undefined) break
		node = child
		variant = variant.slice(1)
	}
	return { node, variant }
}
