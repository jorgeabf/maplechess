// Entrar en las variantes y salir de ellas con el teclado (Mayús+→ y
// Mayús+←, como en lichess). Sólo con id, padre e hijos: lo usa el visor en
// el navegador sin arrastrar chessops.
import type { TreeNode } from './movetree'

type Node = Pick<TreeNode, 'id' | 'parent' | 'children'>

/** Primera variante que sale de esta posición (el segundo hijo), o null. */
export function enterVariation(nodes: Node[], id: number): number | null {
	return nodes[id]?.children[1] ?? null
}

/**
 * Posición de la que nace la variante en la que se está: la de antes de su
 * primera jugada. Con variantes anidadas sale de la más interna. En la línea
 * principal, null.
 */
export function exitVariation(nodes: Node[], id: number): number | null {
	for (let node = nodes[id]; node && node.parent >= 0; node = nodes[node.parent]) {
		if (nodes[node.parent].children[0] !== node.id) return node.parent
	}
	return null
}
