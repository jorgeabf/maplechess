import type { APIContext } from 'astro'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { GET } from '../src/pages/api/estado'
import { HEALTH_RUNS, healthKey, loadHealth, runStatus, saveHealth } from '../src/lib/salud'

const HOUR_MS = 3_600_000
const now = new Date('2026-10-22T07:30:00Z')
const hoursAgo = (hours: number, from = now) => new Date(from.getTime() - hours * HOUR_MS)
const value = (fin: Date, ok = 10, fallos = 0, avisos = 0) => JSON.stringify({ fin: fin.toISOString(), ok, fallos, avisos })

// El endpoint no lee el contexto.
const estado = async () => {
	const response = await GET({} as APIContext)
	return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() }
}

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare("DELETE FROM sync_state WHERE key GLOB 'salud.*'"),
		env.DB.prepare('DELETE FROM torneos_sensibles')
	])
})

describe('runStatus', () => {
	it('sin la clave, «sin datos»', () => {
		expect(runStatus('info64', null, now)).toBe('sin datos')
	})

	it('caduca según el intervalo de cada pasada', () => {
		expect(runStatus('info64', value(hoursAgo(25)), now)).toBe('ok')
		expect(runStatus('info64', value(hoursAgo(27)), now)).toBe('caducada')
		expect(runStatus('lichess', value(hoursAgo(27)), now)).toBe('caducada')
		expect(runStatus('emparejamientos', value(hoursAgo(13)), now)).toBe('ok')
		expect(runStatus('emparejamientos', value(hoursAgo(15)), now)).toBe('caducada')
		expect(runStatus('fide', value(hoursAgo(34 * 24)), now)).toBe('ok')
		expect(runStatus('fide', value(hoursAgo(36 * 24)), now)).toBe('caducada')
	})

	it('da la alarma con más del 20 % de torneos fallidos; los avisos no cuentan', () => {
		expect(runStatus('info64', value(hoursAgo(1), 8, 2), now)).toBe('ok')
		expect(runStatus('info64', value(hoursAgo(1), 3, 1), now)).toBe('con fallos')
		expect(runStatus('info64', value(hoursAgo(1), 0, 1), now)).toBe('con fallos')
		expect(runStatus('info64', value(hoursAgo(1), 1, 0, 5), now)).toBe('ok')
		expect(runStatus('fide', value(hoursAgo(1), 0, 0), now)).toBe('ok')
	})

	it('un valor que no se entiende es un fallo, no «sin datos»', () => {
		expect(runStatus('info64', 'no es JSON', now)).toBe('con fallos')
		expect(runStatus('info64', JSON.stringify({ fin: 'ayer', ok: 1, fallos: 0, avisos: 0 }), now)).toBe('con fallos')
		expect(runStatus('info64', JSON.stringify({ fin: now.toISOString(), ok: 1 }), now)).toBe('con fallos')
	})
})

describe('saveHealth y loadHealth', () => {
	it('guarda el recuento con su fin y lo lee por pasada', async () => {
		await saveHealth(env.DB, 'info64', { ok: 40, fallos: 1, avisos: 2 }, hoursAgo(2))
		await saveHealth(env.DB, 'lichess', { ok: 3, fallos: 3, avisos: 0 }, hoursAgo(1))
		const row = await env.DB.prepare('SELECT value FROM sync_state WHERE key = ?1')
			.bind(healthKey('info64'))
			.first<{ value: string }>()
		expect(JSON.parse(row!.value)).toEqual({ fin: hoursAgo(2).toISOString(), ok: 40, fallos: 1, avisos: 2 })
		expect(await loadHealth(env.DB, now)).toEqual({
			info64: 'ok',
			emparejamientos: 'sin datos',
			lichess: 'con fallos',
			fide: 'sin datos'
		})
	})

	it('sobrescribe la pasada anterior', async () => {
		await saveHealth(env.DB, 'fide', { ok: 0, fallos: 1, avisos: 0 }, hoursAgo(2))
		await saveHealth(env.DB, 'fide', { ok: 1, fallos: 0, avisos: 0 }, hoursAgo(1))
		expect((await loadHealth(env.DB, now)).fide).toBe('ok')
	})
})

describe('GET /api/estado', () => {
	it('con todas las pasadas recientes, 200', async () => {
		for (const run of HEALTH_RUNS) await saveHealth(env.DB, run, { ok: 10, fallos: 0, avisos: 0 }, hoursAgo(1, new Date()))
		const { status, cache, body } = await estado()
		expect(status).toBe(200)
		expect(cache).toBe('no-store')
		expect(body).toEqual({
			estado: 'ok',
			pasadas: { info64: 'ok', emparejamientos: 'ok', lichess: 'ok', fide: 'ok' },
			sensibles: 'ok'
		})
	})

	it('con la diaria de info64 de hace 30 h, 503 y dice cuál, sin datos internos', async () => {
		for (const run of HEALTH_RUNS) await saveHealth(env.DB, run, { ok: 10, fallos: 1, avisos: 3 }, hoursAgo(1, new Date()))
		await saveHealth(env.DB, 'info64', { ok: 10, fallos: 1, avisos: 3 }, hoursAgo(30, new Date()))
		const { status, cache, body } = await estado()
		expect(status).toBe(503)
		expect(cache).toBe('no-store')
		expect(body).toEqual({
			estado: 'fallo',
			pasadas: { info64: 'caducada', emparejamientos: 'ok', lichess: 'ok', fide: 'ok' },
			sensibles: 'ok'
		})
	})

	it('sin claves (antes de que la ingesta las escriba), 200 con «sin datos»', async () => {
		const { status, body } = await estado()
		expect(status).toBe(200)
		expect(body).toEqual({
			estado: 'ok',
			pasadas: { info64: 'sin datos', emparejamientos: 'sin datos', lichess: 'sin datos', fide: 'sin datos' },
			sensibles: 'ok'
		})
	})

	it('con un torneo sensible por revisar, 503 aunque las pasadas vayan bien; revisado, 200', async () => {
		for (const run of HEALTH_RUNS) await saveHealth(env.DB, run, { ok: 10, fallos: 0, avisos: 0 }, hoursAgo(1, new Date()))
		const add = (key: string, excluido: number | null) =>
			env.DB.prepare(
				"INSERT INTO torneos_sensibles (source, source_key, nombre, excluido, creado) VALUES ('info64', ?1, 'Torneo inventado', ?2, '2026-10-23')"
			)
				.bind(key, excluido)
				.run()
		await add('excluido', 1)
		await add('conservado', 0)
		expect(await estado()).toMatchObject({ status: 200, body: { estado: 'ok', sensibles: 'ok' } })

		await add('por-revisar', null)
		const { status, body } = await estado()
		expect(status).toBe(503)
		expect(body).toEqual({
			estado: 'fallo',
			pasadas: { info64: 'ok', emparejamientos: 'ok', lichess: 'ok', fide: 'ok' },
			sensibles: 'por revisar'
		})
	})
})
