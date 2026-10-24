import { describe, expect, it } from 'vitest'
import { moveList, type MoveItem } from '../../src/lib/chess/movelist'
import { buildTree, mainline, toViewerNodes } from '../../src/lib/chess/movetree'

const PGN = `[Event "Prueba"]
[White "A"]
[Black "B"]
[Result "*"]

{Partida de prueba} 1. e4 {[%clk 0:03:00] Abre} e5 {[%clk 0:02:58] [%eval 0.25]} 2. Nf3 (2. f4 exf4 {Gambito}) 2... Nc6 $1 3. Bc4 Nf6 4. O-O {[%cal Ga2a4]} *`

/** Texto plano de la lista, para comparar de un vistazo. */
function flat(items: MoveItem[]): string {
	return items
		.map((i) => {
			if (i.kind === 'number') return i.text
			if (i.kind === 'move') return i.san + i.glyphs
			if (i.kind === 'comment') return `{${i.text}}`
			return `(${flat(i.items)})`
		})
		.join(' ')
}

describe('buildTree', () => {
	const tree = buildTree(PGN)

	it('separa línea principal y variantes', () => {
		expect(mainline(tree).map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O'])
		const afterE5 = tree.nodes.find((n) => n.san === 'e5')!
		expect(afterE5.children.map((id) => tree.nodes[id].san)).toEqual(['Nf3', 'f4'])
	})

	it('numera la línea principal antes que las variantes: id = media jugada (#j{ply} en el visor)', () => {
		const line = mainline(tree)
		expect(line.map((n) => n.id)).toEqual(line.map((n) => n.ply))
	})

	it('lee reloj, evaluación, flechas y comentarios', () => {
		const [e4, e5] = mainline(tree)
		expect(e4.clock).toBe(180)
		expect(e5).toMatchObject({ clock: 178, eval: { cp: 25 } })
		expect(tree.comments).toEqual(['Partida de prueba'])
		const castle = mainline(tree).at(-1)!
		expect(castle.shapes).toHaveLength(1)
		expect(castle.shapes[0].color).toBe('green')
	})

	it('da el enroque en UCI estándar (e1g1) y marca los jaques', () => {
		expect(mainline(tree).at(-1)!.uci).toBe('e1g1')
		const check = buildTree('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# *')
		expect(mainline(check).at(-1)).toMatchObject({ san: 'Qxf7#', check: true })
	})

	it('corta en la primera jugada ilegal de la línea principal', () => {
		const bad = buildTree('1. e4 e5 2. Ke3 Nc6 *')
		expect(mainline(bad)).toHaveLength(2)
		expect(bad.illegalPly).toBe(3)
	})
})

describe('anotaciones de lichess', () => {
	// Como las trae una retransmisión de lichess: la evaluación, el juicio y el
	// reloj, cada uno en su comentario.
	const tree = buildTree(`[Event "Retransmisión"]
[Result "*"]

1. e4 { [%eval 0.18] [%clk 1:30:00] } e5 { [%eval 0.2] [%clk 1:30:00] } 2. Nf3 $6 { [%eval -0.5] } { Inaccuracy. d4 was best. } { [%clk 1:29:30] } 2... Nc6 $2 { [%eval 1.4] } { Mistake. Nf6 was best. } { [%clk 1:29:00] } 3. Bc4 $4 { [%eval -2.1] } { Blunder. Bb5 was best. } { [%clk 1:28:00] } 3... Nf6 $2 { [%eval #-5] } { Checkmate is now unavoidable. Bc5 was best. } { [%clk 1:27:00] } 4. Ng5 $4 { [%eval 0.3] } { Lost forced checkmate sequence. Bxf7+ was best. } { [%clk 1:26:00] } 4... d5 { Lo de siempre [%cal Gd5e4] [%csl Rf7] } *`)
	const line = mainline(tree)

	it('traduce las cinco frases del análisis automático a su forma corta', () => {
		expect(line.slice(2, 7).map((n) => n.comments)).toEqual([
			['Mejor d4.'],
			['Mejor Nf6.'],
			['Mejor Bb5.'],
			['Mate inevitable; mejor Bc5.'],
			['Deja escapar el mate; mejor Bxf7+.']
		])
	})

	it('deja igual cualquier otro comentario', () => {
		expect(line.at(-1)!.comments).toEqual(['Lo de siempre'])
	})

	it('sigue leyendo evaluación, reloj y flechas', () => {
		const [, , nf3, , , nf6, , d5] = line
		expect(nf3).toMatchObject({ eval: { cp: -50 }, clock: 5370 })
		expect(nf6).toMatchObject({ eval: { mate: -5 }, clock: 5220 })
		expect(d5.shapes.map((s) => s.color)).toEqual(['green', 'red'])
	})

	it('la gravedad la dice el signo de la jugada', () => {
		expect(flat(moveList(tree))).toBe(
			'1. e4 e5 2. Nf3?! {Mejor d4.} 2… Nc6? {Mejor Nf6.} 3. Bc4?? {Mejor Bb5.} ' +
				'3… Nf6? {Mate inevitable; mejor Bc5.} 4. Ng5?? {Deja escapar el mate; mejor Bxf7+.} 4… d5 {Lo de siempre}'
		)
	})
})

describe('toViewerNodes', () => {
	it('da a cada jugada sus comentarios en un texto, y a la raíz los de la partida', () => {
		const nodes = toViewerNodes(buildTree('{Partida} 1. e4 {Abre} {[%clk 0:03:00]} e5 ({Otra} 1... c5 {Siciliana}) 2. Nf3 *'))
		expect(nodes.map((n) => n.comment)).toEqual(['Partida', 'Abre', undefined, undefined, 'Otra Siciliana'])
		expect(nodes[2]).not.toHaveProperty('comment')
	})
})

describe('moveList', () => {
	it('numera como en los libros, con "…" tras comentarios y variantes', () => {
		expect(flat(moveList(buildTree(PGN)))).toBe(
			'1. e4 {Abre} 1… e5 2. Nf3 (2. f4 exf4 {Gambito}) 2… Nc6! 3. Bc4 Nf6 4. O-O'
		)
	})
})
