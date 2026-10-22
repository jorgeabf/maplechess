import { describe, expect, it } from 'vitest'
import { MANIFEST, manifestResponse } from '../src/lib/manifest'
import { THEME_COLOR } from '../src/lib/theme-color'

// Los PNG que hay en public/, sin cargarlos: sólo sus rutas.
const publicFiles = Object.keys(import.meta.glob('../public/*.png')).map((path) => path.replace('../public', ''))

describe('MANIFEST', () => {
	it('cumple lo que pide Chrome para ofrecer la instalación', () => {
		expect(MANIFEST.name || MANIFEST.short_name).toBeTruthy()
		expect(MANIFEST.start_url).toBe('/')
		expect(['fullscreen', 'standalone', 'minimal-ui']).toContain(MANIFEST.display)
		const sizes = MANIFEST.icons.filter((icon) => !('purpose' in icon)).map((icon) => icon.sizes)
		expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
		expect(MANIFEST).not.toHaveProperty('prefer_related_applications')
	})

	it('trae un icono maskable para el lanzador de Android', () => {
		expect(MANIFEST.icons.some((icon) => 'purpose' in icon && icon.purpose === 'maskable')).toBe(true)
	})

	it('cada icono existe en public/ (los genera scripts/iconos.mjs)', () => {
		for (const icon of MANIFEST.icons) expect(publicFiles, icon.src).toContain(icon.src)
	})

	it('los colores son los del theme-color', () => {
		expect(MANIFEST.theme_color).toBe(THEME_COLOR.light)
		expect(MANIFEST.background_color).toBe(THEME_COLOR.light)
	})

	it('se sirve como manifest y se puede guardar', async () => {
		const res = manifestResponse()
		expect(res.headers.get('Content-Type')).toBe('application/manifest+json; charset=utf-8')
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
		expect(await res.json()).toEqual(MANIFEST)
	})
})
