// Manifest de la app web (/manifest.webmanifest, Base.astro lo enlaza): con él
// se puede instalar MapleChess en el móvil y abrirla como una app, sin la
// interfaz del navegador. Chrome la ofrece con nombre, start_url, display e
// iconos de 192 y 512 px; no hace falta service worker, y no lo hay: sin datos
// no tiene sentido funcionar sin conexión, y un HTML guardado apuntaría, tras
// un despliegue, a CSS y JS con hash que ya no existen.

/**
 * El --walnut de global.css, la losa del logo. Un manifest no lee variables
 * CSS: test/manifest.test.ts comprueba que sigue siendo el del token.
 */
export const WALNUT = '#806a52'

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
	// En la app instalada, background_color es el fondo de la pantalla de
	// arranque y el que asoma bajo la barra de gestos. Un manifest no distingue
	// claro y oscuro (Chrome no lee colores oscuros del manifest), y sin él
	// Chrome pone #F8F9FA en los dos: con el --bg claro, en modo oscuro quedaba
	// una franja crema. El nogal de la marca no se funde con la página en
	// ningún modo, pero tampoco desentona en ninguno.
	// Sin theme_color: Chrome puede pintar con él la barra de abajo
	// (WebappIntentDataProvider.getNavigationBarColor), con el mismo problema
	// de un solo color. La barra de arriba la da la meta theme-color de cada
	// tema, que en una app instalada Chrome usa también en oscuro.
	background_color: WALNUT,
	// Los genera scripts/iconos.mjs a partir de public/favicon.svg.
	icons: [
		{ src: '/icono-192.png', sizes: '192x192', type: 'image/png' },
		{ src: '/icono-512.png', sizes: '512x512', type: 'image/png' },
		{ src: '/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
	]
}

/**
 * Respuesta del manifest, con la caché por defecto del middleware: el
 * navegador revalida siempre. Son unos 600 bytes sin D1, y con una hora de
 * caché, al reinstalar la app tras un cambio Chrome aún usaba el manifest viejo.
 */
export function manifestResponse(): Response {
	return new Response(JSON.stringify(MANIFEST), {
		headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' }
	})
}
