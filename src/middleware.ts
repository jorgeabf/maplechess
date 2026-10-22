// Middleware de Astro: se ejecuta en todas las rutas dinámicas (los ficheros
// estáticos los sirve Cloudflare sin pasar por aquí).
import type { MiddlewareHandler } from 'astro'
import { env } from 'cloudflare:workers'
import { gameFilters, gameSearchKind, isPlayerSearch, playerFilters } from './lib/params'

/**
 * Caché por defecto: el navegador revalida en cada visita. Cloudflare no cachea
 * las respuestas del Worker, así que cachear aquí apenas ahorra lecturas de D1,
 * y un HTML viejo en el navegador apuntaría, tras un despliegue, a CSS y JS con
 * hash que ya no existen. `private`, porque la portada, la ficha, el dossier, el
 * torneo y la partida cambian con la cookie yo: ninguna caché compartida debe
 * guardarlas, si un día se activa una en el dominio. Las rutas que admiten caché
 * (las descargas PGN) ponen su propia cabecera.
 */
export const DEFAULT_CACHE_CONTROL = 'private, max-age=0, must-revalidate'

/**
 * Cabeceras de seguridad de todas las respuestas dinámicas, también las PGN.
 * La Content-Security-Policy la pone Astro (astro.config.mjs). SAMEORIGIN y no
 * DENY: las medidas con iframes del mismo origen siguen funcionando. Sin
 * Referrer-Policy: el valor por defecto de los navegadores
 * (strict-origin-when-cross-origin) basta, y «← Volver» depende de él.
 */
export const SECURITY_HEADERS = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'SAMEORIGIN'
}

/** Periodo del límite de ritmo en segundos, el de `ratelimits` en wrangler.jsonc: el Retry-After del 429. */
export const RATE_LIMIT_PERIOD = 60

/**
 * Rutas que leen de cientos a decenas de miles de filas de D1 en cada
 * petición: las búsquedas de /partidas y /jugadores (no sus portadas), las
 * descargas PGN, el dossier y el repertorio. Las fichas, las partidas, los
 * torneos y /api/* no se limitan.
 */
export function isExpensive(url: URL): boolean {
	const path = url.pathname
	if (path.endsWith('.pgn') || /^\/jugadores\/\d+\/(preparar|repertorio)$/.test(path)) return true
	if (path === '/partidas') {
		const { page: _page, ...filters } = gameFilters(url.searchParams)
		return gameSearchKind(filters) === 'search'
	}
	return path === '/jugadores' && isPlayerSearch(playerFilters(url.searchParams))
}

/** RATE_LIMIT de wrangler.jsonc (o de .dev.vars): "on" o "off". */
const isOn = (flag: string) => flag === 'on'

/**
 * ¿Le quedan peticiones caras a quien hace esta? Por IP, con el binding de
 * Rate Limiting de Workers (30 por minuto). Con el límite apagado, o sin IP
 * (fuera de Cloudflare), siempre.
 */
async function withinRateLimit(request: Request): Promise<boolean> {
	const ip = request.headers.get('cf-connecting-ip')
	if (!isOn(env.RATE_LIMIT) || !ip) return true
	return (await env.RATE_LIMITER.limit({ key: ip })).success
}

export const onRequest = (async (context, next) => {
	const limited = isExpensive(context.url) && !(await withinRateLimit(context.request))
	// Pasado el límite, la página 429, que no consulta D1.
	const response = limited ? await next('/429') : await next()
	if (limited) response.headers.set('Retry-After', String(RATE_LIMIT_PERIOD))
	if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', DEFAULT_CACHE_CONTROL)
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value)
	return response
}) satisfies MiddlewareHandler
