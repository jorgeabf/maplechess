// Lista de jugadas para pintar: la línea principal y, tras cada jugada que
// las tenga, sus variantes anidadas. Los números de jugada se repiten
// ("12…") cuando una jugada negra va detrás de un comentario o una variante,
// como en los libros. El número va con su jugada, para pintarlos juntos.
import { NAG_SYMBOLS, type GameTree } from './movetree'

export type MoveItem =
	| { kind: 'move'; id: number; san: string; glyphs: string; number?: string }
	| { kind: 'comment'; text: string; advice?: true }
	| { kind: 'variation'; items: MoveItem[] }

function glyphs(nags: number[]): string {
	return nags.map((n) => NAG_SYMBOLS[n] ?? `$${n}`).join('')
}

function line(tree: GameTree, firstId: number): MoveItem[] {
	const items: MoveItem[] = []
	let needNumber = true
	let node = tree.nodes[firstId]
	while (node) {
		for (const comment of node.startingComments) {
			items.push({ kind: 'comment', ...comment })
			needNumber = true
		}
		const moveNumber = Math.ceil(node.ply / 2)
		const number = node.ply % 2 === 1 ? `${moveNumber}.` : needNumber ? `${moveNumber}…` : undefined
		items.push({ kind: 'move', id: node.id, san: node.san, glyphs: glyphs(node.nags), number })
		needNumber = false

		for (const comment of node.comments) {
			items.push({ kind: 'comment', ...comment })
			needNumber = true
		}

		// Las alternativas a esta jugada son sus hermanos (sólo desde la principal).
		const parent = tree.nodes[node.parent]
		if (parent && parent.children[0] === node.id) {
			for (const alternative of parent.children.slice(1)) {
				items.push({ kind: 'variation', items: line(tree, alternative) })
				needNumber = true
			}
		}

		node = tree.nodes[node.children[0]]
	}
	return items
}

export function moveList(tree: GameTree): MoveItem[] {
	const first = tree.nodes[0].children[0]
	return first === undefined ? [] : line(tree, first)
}
