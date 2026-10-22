import { describe, expect, it } from 'vitest'
import { THEME_COLOR } from '../src/lib/theme-color'
import css from '../src/styles/global.css?raw'

describe('THEME_COLOR', () => {
	it('es el --surface de global.css, en claro y en oscuro', () => {
		const [, light, dark] = /--surface:\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i.exec(css) ?? []
		expect(THEME_COLOR).toEqual({ light, dark })
	})
})
