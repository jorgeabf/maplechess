import type { APIContext, RewritePayload } from 'astro'
import { describe, expect, it } from 'vitest'
import { pgnResponse } from '../src/lib/pgn-response'
import { DEFAULT_CACHE_CONTROL, isExpensive, onRequest, RATE_LIMIT_PERIOD, SECURITY_HEADERS } from '../src/middleware'

// El middleware sólo lee la URL y la cabecera con la IP. `next` apunta a qué
// página se reescribe la petición, si se reescribe.
async function run(path: string, { ip = '192.0.2.1', response = () => new Response('<!doctype html>') } = {}) {
	const url = new URL(path, 'https://maplechess.test')
	const context = { url, request: new Request(url, { headers: { 'cf-connecting-ip': ip } }) } as APIContext
	let rewrite: RewritePayload | undefined
	const res = await onRequest(context, async (payload) => {
		rewrite = payload
		return payload ? new Response('Demasiadas peticiones', { status: 429 }) : response()
	})
	return { res, rewrite }
}

describe('onRequest', () => {
	it('pone la caché por defecto a las páginas que no fijan la suya', async () => {
		const { res } = await run('/')
		expect(res.headers.get('Cache-Control')).toBe(DEFAULT_CACHE_CONTROL)
	})

	it('respeta la caché que fija la ruta', async () => {
		const { res } = await run('/partidas/1.pgn', { response: () => pgnResponse(['1. e4 e5 *'], 'Partida') })
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
	})

	it('las páginas no se guardan en cachés compartidas: cambian con la cookie yo', () => {
		expect(DEFAULT_CACHE_CONTROL).toBe('private, max-age=0, must-revalidate')
	})

	it('nosniff y SAMEORIGIN en todas las respuestas, también las PGN y los errores', async () => {
		const responses = [
			(await run('/')).res,
			(await run('/partidas/1.pgn', { response: () => pgnResponse(['1. e4 e5 *'], 'Partida') })).res,
			(await run('/api/admin/sync', { response: () => new Response('No autorizado', { status: 401 }) })).res
		]
		for (const res of responses) {
			expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
			expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
		}
		expect(SECURITY_HEADERS).not.toHaveProperty('Referrer-Policy')
	})
})

describe('isExpensive', () => {
	const expensive = (path: string) => isExpensive(new URL(path, 'https://maplechess.test'))

	it('las búsquedas, las descargas, el dossier y el repertorio', () => {
		for (const path of [
			'/partidas?jugador=garcia',
			'/partidas?desde=1000-01-01',
			'/jugadores?q=garcia',
			'/jugadores?titulo=GM',
			'/partidas.pgn?eco=B',
			'/jugadores/32060777.pgn',
			'/torneos/12.pgn',
			'/jugadores/32060777/preparar?yo=garcia',
			'/jugadores/32060777/repertorio'
		])
			expect(expensive(path), path).toBe(true)
	})

	it('ni las portadas de las secciones, ni las fichas, partidas o torneos, ni /api', () => {
		for (const path of [
			'/',
			'/partidas',
			'/partidas?color=white',
			'/partidas?jugador=a',
			'/jugadores',
			'/jugadores?categoria=sub18',
			'/jugadores/32060777',
			'/jugadores/32060777?eco=B&color=black',
			'/partidas/53051',
			'/torneos',
			'/torneos?q=open',
			'/torneos/12',
			'/api/admin/sync',
			'/acerca'
		])
			expect(expensive(path), path).toBe(false)
	})
})

describe('límite de ritmo', () => {
	it('pasadas 30 peticiones caras en un minuto, la página 429 con Retry-After', async () => {
		const ip = '198.51.100.7'
		for (let i = 0; i < 30; i++) expect((await run('/partidas?jugador=garcia', { ip })).rewrite).toBeUndefined()
		const { res, rewrite } = await run('/partidas.pgn?jugador=garcia', { ip })
		expect(rewrite).toBe('/429')
		expect(res.status).toBe(429)
		expect(res.headers.get('Retry-After')).toBe(String(RATE_LIMIT_PERIOD))
		expect(res.headers.get('Cache-Control')).toBe(DEFAULT_CACHE_CONTROL)
		expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')

		// Lo barato sigue, y otra IP no se ve afectada.
		expect((await run('/jugadores/32060777', { ip })).rewrite).toBeUndefined()
		expect((await run('/partidas/53051', { ip })).rewrite).toBeUndefined()
		expect((await run('/partidas?jugador=garcia', { ip: '198.51.100.8' })).rewrite).toBeUndefined()
	})

	it('sin IP (fuera de Cloudflare) no limita', async () => {
		const url = new URL('/partidas?jugador=garcia', 'https://maplechess.test')
		const context = { url, request: new Request(url) } as APIContext
		for (let i = 0; i < 35; i++) {
			const res = await onRequest(context, async (payload) => new Response(payload ? '429' : 'ok'))
			expect(await res.text()).toBe('ok')
		}
	})
})
