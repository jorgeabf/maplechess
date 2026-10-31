// Middleware de Astro: se ejecuta en todas las rutas dinámicas (los ficheros
// estáticos los sirve Cloudflare sin pasar por aquí).
import type { APIContext, MiddlewareHandler, MiddlewareNext } from 'astro'
import { env } from 'cloudflare:workers'
import { gameFilters, gameSearchKind, isPlayerSearch, playerFilters } from './lib/params'

/**
 * Caché por defecto: el navegador revalida en cada visita. Cloudflare no cachea
 * las respuestas del Worker, así que cachear aquí apenas ahorra lecturas de D1,
 * y un HTML viejo en el navegador apuntaría, tras un despliegue, a CSS y JS con
 * hash que ya no existen. `private`, porque la portada, la ficha, el dossier, el
 * torneo y la partida cambian con la cookie yo: ninguna caché compartida debe
 * guardarlas, si un día se activa una en el dominio. Las rutas que admiten caché
 * (las descargas PGN y /api/emparejamientos) ponen su propia cabecera.
 */
export const DEFAULT_CACHE_CONTROL = 'private, max-age=0, must-revalidate'

/**
 * Cabeceras de seguridad de todas las respuestas dinámicas, también las PGN.
 * La Content-Security-Policy la pone Astro (astro.config.mjs). SAMEORIGIN y no
 * DENY: las medidas con iframes del mismo origen siguen funcionando. Sin
 * Referrer-Policy: el valor por defecto de los navegadores
 * (strict-origin-when-cross-origin) basta, y «← Volver» depende de él. HSTS
 * de un año: en workers.dev ya obligaba a HTTPS la lista de precarga del .dev,
 * pero el .es no está en ella.
 */
export const SECURITY_HEADERS = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'SAMEORIGIN',
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
}

/** La URL de antes del dominio, que enlaza lo ya publicado (el aviso a la FEDA). */
export const WORKERS_DEV_HOST = 'buscador-partidas-ajedrez.aportuvas.workers.dev'

/**
 * La misma dirección en el dominio (`site` en astro.config.mjs) si la petición
 * llega por la URL de workers.dev o por www; si no, undefined. Por host exacto:
 * las URL de vista previa de cada versión y el entorno local se sirven tal
 * cual. Sólo GET y HEAD: tras una 301, un POST (/api/admin/sync) llegaría
 * como GET.
 */
export function canonicalUrl(url: URL, method: string, site: URL | undefined): URL | undefined {
	if (!site || (method !== 'GET' && method !== 'HEAD')) return undefined
	if (url.host !== WORKERS_DEV_HOST && url.host !== `www.${site.host}`) return undefined
	return new URL(url.pathname + url.search, site)
}

/** Periodo del límite de ritmo en segundos, el de `ratelimits` en wrangler.jsonc: el Retry-After del 429. */
export const RATE_LIMIT_PERIOD = 60

/**
 * Rutas que leen de cientos a decenas de miles de filas de D1 en cada
 * petición: las búsquedas de /partidas y /jugadores (no sus portadas), las
 * descargas PGN, el dossier, el repertorio y los trozos del sitemap que salen
 * de D1 (no su índice). Las fichas, las partidas, los torneos y /api/* no se
 * limitan.
 */
export function isExpensive(url: URL): boolean {
	const path = url.pathname
	if (path.endsWith('.pgn') || /^\/jugadores\/\d+\/(preparar|repertorio)$/.test(path)) return true
	if (/^\/sitemap\/(jugadores|torneos|partidas)-\d+\.xml$/.test(path)) return true
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

/** La respuesta de la ruta o, pasado el límite de ritmo, la página 429, que no consulta D1. */
async function render(context: APIContext, next: MiddlewareNext): Promise<Response> {
	if (!isExpensive(context.url) || (await withinRateLimit(context.request))) return next()
	const response = await next('/429')
	response.headers.set('Retry-After', String(RATE_LIMIT_PERIOD))
	return response
}

export const onRequest = (async (context, next) => {
	const canonical = canonicalUrl(context.url, context.request.method, context.site)
	// La redirección también lleva la caché por defecto: si hubiera que volver a
	// workers.dev, los navegadores no se quedarían con ella.
	const response = canonical
		? new Response(null, { status: 301, headers: { Location: canonical.href } })
		: await render(context, next)
	if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', DEFAULT_CACHE_CONTROL)
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value)
	return response
}) satisfies MiddlewareHandler
