import { describe, expect, it } from 'vitest'
import { MANIFEST, manifestResponse, WALNUT } from '../src/lib/manifest'
import css from '../src/styles/global.css?raw'

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

	it('el fondo es el nogal de la marca, el --walnut de global.css', () => {
		expect(WALNUT).toBe(/--walnut:\s*(#[0-9a-f]{6})/i.exec(css)?.[1])
		expect(MANIFEST.background_color).toBe(WALNUT)
	})

	it('sin theme_color: un solo color para la barra de abajo no vale en claro y oscuro', () => {
		expect(MANIFEST).not.toHaveProperty('theme_color')
	})

	it('se sirve como manifest, sin caché propia', async () => {
		const res = manifestResponse()
		expect(res.headers.get('Content-Type')).toBe('application/manifest+json; charset=utf-8')
		// La pone el middleware (revalidar siempre): con caché, al reinstalar
		// tras un cambio Chrome usaba el manifest viejo.
		expect(res.headers.get('Cache-Control')).toBeNull()
		expect(await res.json()).toEqual(MANIFEST)
	})
})
