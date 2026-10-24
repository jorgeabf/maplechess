import { describe, expect, it } from 'vitest'
import figuras from '../scripts/fuente-figuras.py?raw'
import titulares from '../scripts/fuente-titulares.py?raw'
import css from '../src/styles/global.css?raw'

/** El unicode-range del @font-face de `family` en global.css. */
function unicodeRange(family: string): string[] {
	const face = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
		.map((match) => match[1])
		.find((body) => body.includes(`font-family: '${family}';`))
	return /unicode-range:\s*([^;]+);/.exec(face ?? '')?.[1].split(',').map((range) => range.trim()) ?? []
}

/** La constante UNICODES del script de Python que genera la fuente. */
function unicodes(script: string): string[] {
	return /^UNICODES = "([^"]+)"/m.exec(script)?.[1].split(',') ?? []
}

describe('@font-face', () => {
	it('Figuras sólo se aplica a las letras que el script dibuja como figuras', () => {
		expect(unicodeRange('Figuras')).toEqual(['U+0042', 'U+004B', 'U+004E', 'U+0051', 'U+0052'])
		expect(unicodeRange('Figuras')).toEqual(unicodes(figuras))
	})

	it('Titulares cubre lo mismo que deja el recorte del script', () => {
		expect(unicodeRange('Titulares').length).toBeGreaterThan(0)
		expect(unicodeRange('Titulares')).toEqual(unicodes(titulares))
	})
})
