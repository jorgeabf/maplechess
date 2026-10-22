import { describe, expect, it } from 'vitest'
import { THEME_COLOR } from '../src/lib/theme-color'
import css from '../src/styles/global.css?raw'

/**
 * Luminosidad HSL como la calcula Chrome Android (getLightnessForColor en
 * ui/android/.../util/ColorUtils.java): la media entera del canal más alto y el
 * más bajo, entre 255. Con más de 0,94 (MAX_LUMINANCE_FOR_VALID_THEME_COLOR),
 * isThemeColorTooBright descarta el color y la barra se queda blanca.
 */
function chromeLightness(hex: string): number {
	const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
	return Math.trunc((Math.max(...channels) + Math.min(...channels)) / 2) / 255
}

/** Los dos valores de un token `light-dark()` de global.css. */
function token(name: string) {
	const [, light, dark] = new RegExp(`--${name}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`, 'i').exec(css) ?? []
	return { light, dark }
}

describe('THEME_COLOR', () => {
	it('es el --bg de global.css, en claro y en oscuro', () => {
		expect(THEME_COLOR).toEqual(token('bg'))
	})

	it('Chrome Android no lo descarta por demasiado claro', () => {
		for (const color of Object.values(THEME_COLOR)) expect(chromeLightness(color), color).toBeLessThanOrEqual(0.94)
		// El de la cabecera sí lo descartaría: por eso no es --surface.
		expect(chromeLightness(token('surface').light)).toBeGreaterThan(0.94)
	})
})
