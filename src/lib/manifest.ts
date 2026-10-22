// Manifest de la app web (/manifest.webmanifest, Base.astro lo enlaza): con él
// se puede instalar MapleChess en el móvil y abrirla como una app, sin la
// interfaz del navegador. Chrome la ofrece con nombre, start_url, display e
// iconos de 192 y 512 px; no hace falta service worker, y no lo hay: sin datos
// no tiene sentido funcionar sin conexión, y un HTML guardado apuntaría, tras
// un despliegue, a CSS y JS con hash que ya no existen.
import { THEME_COLOR } from './theme-color'

export const MANIFEST = {
	id: '/',
	name: 'MapleChess',
	short_name: 'MapleChess',
	description: 'Prepara tu próxima partida de ajedrez: qué aperturas juega tu rival, cómo le van y si se apura con el reloj.',
	lang: 'es',
	dir: 'ltr',
	start_url: '/',
	scope: '/',
	// En Android, minimal-ui deja atrás y el menú (copiar o compartir el
	// enlace de una ficha). Quien no lo admite, como Safari, lee display.
	display: 'standalone',
	display_override: ['minimal-ui'],
	// Un manifest no admite claro y oscuro: el fondo de la pantalla de arranque
	// y el color por defecto son los de claro. Dentro, manda la meta
	// theme-color de cada tema, que en una app instalada Chrome usa también en
	// oscuro.
	background_color: THEME_COLOR.light,
	theme_color: THEME_COLOR.light,
	// Los genera scripts/iconos.mjs a partir de public/favicon.svg.
	icons: [
		{ src: '/icono-192.png', sizes: '192x192', type: 'image/png' },
		{ src: '/icono-512.png', sizes: '512x512', type: 'image/png' },
		{ src: '/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
	]
}

/** Respuesta del manifest. No depende de la cookie yo: se puede guardar una hora. */
export function manifestResponse(): Response {
	return new Response(JSON.stringify(MANIFEST), {
		headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
	})
}
