import { describe, expect, it } from 'vitest'
import css from '../src/styles/global.css?raw'

// Las SVG que escribe scripts/piezas.mjs: las del tablero y las de la fuente de figuras.
const tablero = import.meta.glob<string>('../src/assets/pieces/maple/*.svg', { query: '?raw', import: 'default', eager: true })
const figuras = import.meta.glob<string>('../scripts/piezas/figuras/*.svg', { query: '?raw', import: 'default', eager: true })

/** Valor hexadecimal de un token de global.css, siguiendo un var(). */
function token(name: string): string {
	const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1].trim() ?? ''
	const alias = /^var\(--([\w-]+)\)$/.exec(value)?.[1]
	return alias ? token(alias) : value
}

/** Contraste WCAG 2 entre dos colores #rrggbb. */
function contrast(a: string, b: string): number {
	const luminance = (hex: string) => {
		const [r, g, bl] = [1, 3, 5].map((i) => {
			const s = Number.parseInt(hex.slice(i, i + 2), 16) / 255
			return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
		})
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl
	}
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return (hi + 0.05) / (lo + 0.05)
}

const light = token('board-piece-light')
const ink = token('board-piece-ink')

describe('piezas del tablero', () => {
	it('están las doce, con el nombre de chessground: color y letra', () => {
		expect(Object.keys(tablero)).toHaveLength(12)
		for (const path of Object.keys(tablero)) expect(path).toMatch(/\/[wb][KQRBNP]\.svg$/)
	})

	it('miden menos de 4 KB, para que Vite las incruste en el CSS, y no llevan comentarios', () => {
		for (const [path, svg] of Object.entries(tablero)) {
			expect(new TextEncoder().encode(svg).length, path).toBeLessThan(4096)
			expect(svg, path).not.toContain('<!--')
		}
	})

	it('sólo usan el tono claro y la tinta de las piezas de global.css', () => {
		for (const [path, svg] of Object.entries(tablero)) {
			const colors = new Set(svg.match(/#[0-9a-f]{6}/gi)?.map((c) => c.toLowerCase()))
			expect([...colors].sort(), path).toEqual([light, ink].map((c) => c.toLowerCase()).sort())
		}
	})

	it('cada tono destaca sobre una casilla: la tinta sobre el arce y el claro sobre el nogal', () => {
		expect(contrast(ink, token('board-light'))).toBeGreaterThanOrEqual(7)
		expect(contrast(light, token('board-dark'))).toBeGreaterThanOrEqual(4.5)
		// Los detalles interiores, uno sobre el otro.
		expect(contrast(light, ink)).toBeGreaterThanOrEqual(7)
	})
})

describe('figuras de la notación', () => {
	it('hay una por pieza con letra en SAN, sin el peón', () => {
		expect(Object.keys(figuras)).toHaveLength(5)
		for (const path of Object.keys(figuras)) expect(path).toMatch(/\/[KQRBN]\.svg$/)
	})

	it('son un solo trazado, sin colores: el color lo pone el texto', () => {
		for (const [path, svg] of Object.entries(figuras)) {
			expect(svg.match(/<path /g), path).toHaveLength(1)
			expect(svg, path).not.toMatch(/#[0-9a-f]{3,6}|stroke/i)
		}
	})
})
