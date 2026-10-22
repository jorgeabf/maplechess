// Árbol de jugadas de una partida, listo para pintar y navegar.
//
// Se construye en el servidor a partir del PGN guardado: la página pinta la
// lista de jugadas sin JavaScript y el visor recibe los nodos ya calculados
// (FEN tras cada jugada, UCI, reloj, evaluación), así el cliente no tiene que
// volver a parsear el PGN.
import type { Position } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import {
	parseComment,
	parsePgn,
	startingPosition,
	type CommentShape,
	type Node as PgnNode,
	type PgnNodeData
} from 'chessops/pgn'
import { makeSanAndPlay, parseSan } from 'chessops/san'
import { separateGames } from './pgn'
import { standardUci } from './uci'

export interface TreeNode {
	id: number
	/** id del nodo padre; 0 es la posición inicial. */
	parent: number
	/** Hijos: el primero continúa la línea, el resto son variantes. */
	children: number[]
	/** Media jugada (1 = primera de las blancas). */
	ply: number
	san: string
	/** UCI estándar (el enroque como e1g1). */
	uci: string
	fen: string
	check: boolean
	comments: string[]
	startingComments: string[]
	nags: number[]
	/** Reloj restante en segundos (%clk). */
	clock?: number
	/** Evaluación anotada (%eval), desde el punto de vista de las blancas. */
	eval?: { cp?: number; mate?: number }
	shapes: CommentShape[]
}

export interface GameTree {
	headers: Record<string, string>
	/** Comentarios previos a la primera jugada. */
	comments: string[]
	/**
	 * nodes[0] es la raíz (posición inicial, sin jugada). La línea principal
	 * se numera antes que cualquier variante, así que su nodo en la media
	 * jugada k tiene id k: el repertorio enlaza a /partidas/{id}#j{k}.
	 */
	nodes: TreeNode[]
	/** Ply de la primera jugada ilegal de la línea principal: el árbol se corta ahí. */
	illegalPly?: number
}

// Comentarios automáticos del análisis de lichess en sus retransmisiones
// («Inaccuracy. Bc5 was best.»). Se traducen al pintarlos, nunca al
// guardarlos: el PGN guardado, la descarga y «Copiar PGN» siguen siendo los
// de lichess. La gravedad ya la dice el signo de la jugada (?!, ?, ??).
const LICHESS_ADVICE = /^([^.]+)\. (\S+) was best\.$/
const LICHESS_JUDGMENTS = new Map([
	['Inaccuracy', 'Mejor'],
	['Mistake', 'Mejor'],
	['Blunder', 'Mejor'],
	['Checkmate is now unavoidable', 'Mate inevitable; mejor'],
	['Lost forced checkmate sequence', 'Deja escapar el mate; mejor']
])

function translateAdvice(text: string): string {
	const match = LICHESS_ADVICE.exec(text)
	if (!match) return text
	const start = LICHESS_JUDGMENTS.get(match[1])
	return start ? `${start} ${match[2]}.` : text
}

function readComments(raw: string[] | undefined) {
	const texts: string[] = []
	const shapes: CommentShape[] = []
	let clock: number | undefined
	let evaluation: TreeNode['eval']
	for (const c of raw ?? []) {
		const parsed = parseComment(c)
		const text = parsed.text.trim()
		if (text) texts.push(translateAdvice(text))
		shapes.push(...parsed.shapes)
		if (parsed.clock !== undefined) clock = parsed.clock
		if (parsed.evaluation) {
			evaluation =
				'mate' in parsed.evaluation
					? { mate: parsed.evaluation.mate }
					: { cp: Math.round(parsed.evaluation.pawns * 100) }
		}
	}
	return { texts, shapes, clock, evaluation }
}

/** Construye el árbol de la primera partida del PGN. */
export function buildTree(pgn: string): GameTree {
	const [game] = parsePgn(separateGames(pgn))
	if (!game) throw new Error('PGN sin partidas')
	const start = startingPosition(game.headers)
	if (start.isErr) throw start.error
	const initial = start.value

	const root: TreeNode = {
		id: 0,
		parent: -1,
		children: [],
		ply: 0,
		san: '',
		uci: '',
		fen: makeFen(initial.toSetup()),
		check: false,
		comments: [],
		startingComments: [],
		nags: [],
		shapes: []
	}
	const nodes: TreeNode[] = [root]
	let illegalPly: number | undefined

	const visit = (pgnNode: PgnNode<PgnNodeData>, parent: TreeNode, pos: Position, mainline: boolean) => {
		pgnNode.children.forEach((child, index) => {
			const data = child.data
			const move = parseSan(pos, data.san)
			if (!move) {
				if (mainline && index === 0) illegalPly = parent.ply + 1
				return
			}
			const next = pos.clone()
			const uci = standardUci(next, move)
			const san = makeSanAndPlay(next, move)
			const comments = readComments(data.comments)
			const node: TreeNode = {
				id: nodes.length,
				parent: parent.id,
				children: [],
				ply: parent.ply + 1,
				san,
				uci,
				fen: makeFen(next.toSetup()),
				check: next.isCheck(),
				comments: comments.texts,
				startingComments: readComments(data.startingComments).texts,
				nags: data.nags ?? [],
				clock: comments.clock,
				eval: comments.evaluation,
				shapes: comments.shapes
			}
			nodes.push(node)
			parent.children.push(node.id)
			visit(child, node, next, mainline && index === 0)
		})
	}
	visit(game.moves, root, initial, true)

	return {
		headers: Object.fromEntries(game.headers),
		comments: readComments(game.comments).texts,
		nodes,
		illegalPly
	}
}

/** Lo que necesita el visor de cada nodo: los comentarios ya van pintados en la página. */
export type ViewerNode = Omit<TreeNode, 'comments' | 'startingComments' | 'nags'>

export function toViewerNodes(tree: GameTree): ViewerNode[] {
	return tree.nodes.map(({ comments: _c, startingComments: _s, nags: _n, ...node }) => node)
}

/** Nodos de la línea principal desde la raíz (sin incluirla). */
export function mainline(tree: GameTree): TreeNode[] {
	const line: TreeNode[] = []
	let node = tree.nodes[0]
	while (node.children.length > 0) {
		node = tree.nodes[node.children[0]]
		line.push(node)
	}
	return line
}

/** Símbolos de las NAG más comunes; el resto se muestran como $n. */
export const NAG_SYMBOLS: Record<number, string> = {
	1: '!',
	2: '?',
	3: '!!',
	4: '??',
	5: '!?',
	6: '?!',
	10: '=',
	13: '∞',
	14: '⩲',
	15: '⩱',
	16: '±',
	17: '∓',
	18: '+−',
	19: '−+',
	22: '⨀',
	32: '⟳',
	36: '→',
	40: '↑',
	132: '⇆',
	146: 'N'
}
