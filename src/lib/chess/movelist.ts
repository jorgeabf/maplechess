// Lista de jugadas para pintar: la línea principal y, tras cada jugada que
// las tenga, sus variantes anidadas. Los números de jugada se repiten
// ("12…") cuando una jugada negra va detrás de un comentario o una variante,
// como en los libros.
import { NAG_SYMBOLS, type GameTree } from './movetree'

export type MoveItem =
	| { kind: 'number'; text: string }
	| { kind: 'move'; id: number; san: string; glyphs: string }
	| { kind: 'comment'; text: string }
	| { kind: 'variation'; items: MoveItem[] }

function glyphs(nags: number[]): string {
	return nags.map((n) => NAG_SYMBOLS[n] ?? `$${n}`).join('')
}

function line(tree: GameTree, firstId: number): MoveItem[] {
	const items: MoveItem[] = []
	let needNumber = true
	let node = tree.nodes[firstId]
	while (node) {
		for (const text of node.startingComments) {
			items.push({ kind: 'comment', text })
			needNumber = true
		}
		const moveNumber = Math.ceil(node.ply / 2)
		if (node.ply % 2 === 1) items.push({ kind: 'number', text: `${moveNumber}.` })
		else if (needNumber) items.push({ kind: 'number', text: `${moveNumber}…` })
		items.push({ kind: 'move', id: node.id, san: node.san, glyphs: glyphs(node.nags) })
		needNumber = false

		for (const text of node.comments) {
			items.push({ kind: 'comment', text })
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
