import type { APIContext } from 'astro'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { saveHealth } from '../src/lib/salud'
import { GET, MAX_PLAYERS } from '../src/pages/api/elo'

const db = env.DB
const HOUR_MS = 3_600_000

const elo = async (query: string) => {
	const response = await GET({ url: new URL(`https://maplechess.es/api/elo?${query}`) } as APIContext)
	return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() }
}

beforeEach(async () => {
	await db.batch([
		db.prepare("DELETE FROM sync_state WHERE key GLOB 'salud.*'"),
		db.prepare('DELETE FROM players'),
		db.prepare(
			`INSERT INTO players (fide_id, name, sex, title, birth_year, rating_std, rating_rapid, rating_blitz,
				inactive, rapid_inactive, blitz_inactive, seen_at, rating_list)
			VALUES (9600001, 'Inventado Ficticio, Uno', 'M', 'FM', 1980, 2286, 2263, NULL, 0, 1, NULL, '', '2026-11'),
				(9600002, 'Inventada Ficticia, Dos', 'F', NULL, 2015, 1500, 1450, 1400, 1, NULL, 0, '', '2026-11')`
		)
	])
})

describe('GET /api/elo', () => {
	it('da el título y el ELO de cada ritmo, en el orden pedido y sin nombre, año ni sexo', async () => {
		const { status, cache, body } = await elo('fide=9600002,9600001,9600002')
		expect(status).toBe(200)
		expect(cache).toBe('public, max-age=3600')
		expect(body).toEqual({
			lista: '2026-11',
			jugadores: [
				{
					fide: 9600002,
					titulo: null,
					estandar: { elo: 1500, inactivo: true },
					rapido: { elo: 1450, inactivo: null },
					relampago: { elo: 1400, inactivo: false }
				},
				{
					fide: 9600001,
					titulo: 'FM',
					estandar: { elo: 2286, inactivo: false },
					rapido: { elo: 2263, inactivo: true },
					relampago: null
				}
			]
		})
	})

	it('no da los que no están en la lista', async () => {
		expect((await elo('fide=1234567')).body).toEqual({ lista: null, jugadores: [] })
	})

	it('503 sin caché si la importación FIDE está caducada', async () => {
		await saveHealth(db, 'fide', { ok: 1, fallos: 0, avisos: 0 }, new Date(Date.now() - 40 * 24 * HOUR_MS))
		expect(await elo('fide=9600001')).toEqual({ status: 503, cache: 'no-store', body: { fide: 'caducada' } })
	})

	it('400 sin lista, con demasiados o con algo que no es un FIDE ID', async () => {
		const many = Array.from({ length: MAX_PLAYERS + 1 }, (_, i) => String(9600000 + i)).join(',')
		for (const query of ['', 'fide=', `fide=${many}`, 'fide=0', 'fide=12a', 'fide=12345678901']) {
			expect((await elo(query)).status).toBe(400)
		}
	})
})
