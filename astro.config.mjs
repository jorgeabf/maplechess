// @ts-check
import cloudflare from '@astrojs/cloudflare'
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: cloudflare({
		// No hay imágenes que transformar: no hace falta el binding de Cloudflare Images.
		imageService: 'passthrough'
	}),
	// Sin sesiones: así el adaptador no provisiona un KV que no usamos.
	session: false,
	devToolbar: {
		enabled: false
	},
	// No hay Markdown. Sin resaltado de código: Shiki pinta estilos en línea que
	// la CSP bloquearía, y Astro avisa en cada build.
	markdown: { syntaxHighlight: false },
	// Content-Security-Policy de cada página, con los hashes de los scripts y
	// estilos que emite Astro (el popover de búsqueda lleva uno en línea). Sólo
	// en el build: `pnpm dev` no la aplica, así que se prueba con wrangler dev.
	security: {
		csp: {
			// Dar `resources` quita el 'self' por defecto: hay que ponerlo.
			// 'wasm-unsafe-eval', por si el motor compila su wasm en la página.
			scriptDirective: { resources: ["'self'", "'wasm-unsafe-eval'"] },
			// Atributos style: los pintan GraficoElo y ScoreBar, y chessground los
			// pone con setAttribute. Van en style-src-attr, y Astro avisa de que
			// 'self' no vale ahí: es lo buscado, un atributo no carga nada.
			styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] },
			directives: [
				"default-src 'self'",
				// Las piezas van dentro del CSS como data:.
				"img-src 'self' data:",
				"object-src 'none'",
				"base-uri 'self'",
				"form-action 'self'",
				"frame-ancestors 'self'"
			]
		}
	}
})
