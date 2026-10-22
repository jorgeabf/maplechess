import { describe, expect, it } from 'vitest'
import { buildTree, mainline } from '../../src/lib/chess/movetree'
import { enterVariation, exitVariation } from '../../src/lib/chess/variations'

// Tras 2.f4 hay otra variante dentro: 2…d5 en vez de 2…exf4.
const tree = buildTree('1. e4 e5 2. Nf3 (2. f4 exf4 (2... d5) 3. Nf3) 2... Nc6 *')
const { nodes } = tree
const [, e5, nf3, nc6] = mainline(tree)
const f4 = nodes[e5.children[1]]
const exf4 = nodes[f4.children[0]]
const d5 = nodes[f4.children[1]]
const nf3InVariation = nodes[exf4.children[0]]

describe('enterVariation', () => {
	it('entra en la primera variante que sale de la posición', () => {
		expect(f4.san).toBe('f4')
		expect(enterVariation(nodes, e5.id)).toBe(f4.id)
		expect(d5.san).toBe('d5')
		expect(enterVariation(nodes, f4.id)).toBe(d5.id)
	})

	it('no hace nada donde no sale ninguna', () => {
		expect(enterVariation(nodes, nf3.id)).toBeNull()
		expect(enterVariation(nodes, exf4.id)).toBeNull()
	})
})

describe('exitVariation', () => {
	it('vuelve a la posición de la que nace la variante, de nivel en nivel', () => {
		expect(exitVariation(nodes, d5.id)).toBe(f4.id)
		expect(exitVariation(nodes, f4.id)).toBe(e5.id)
	})

	it('sale desde cualquier jugada de la variante', () => {
		expect(nf3InVariation.san).toBe('Nf3')
		expect(exitVariation(nodes, nf3InVariation.id)).toBe(e5.id)
	})

	it('no hace nada en la línea principal', () => {
		expect(exitVariation(nodes, nc6.id)).toBeNull()
		expect(exitVariation(nodes, 0)).toBeNull()
	})
})
