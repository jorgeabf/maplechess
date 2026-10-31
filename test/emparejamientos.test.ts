import type { APIContext } from 'astro'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { upsertTournament } from '../src/ingest/repo'
import { HEALTH_RUNS, saveHealth } from '../src/lib/salud'
import { GET } from '../src/pages/api/emparejamientos'

const db = env.DB
const HOUR_MS = 3_600_000
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS)

// El endpoint no lee el contexto.
const emparejamientos = async () => {
	const response = await GET({} as APIContext)
	return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() }
}

/** Un torneo de info64 con la ronda 4 emparejada, de dos mesas, que empieza en 2099. */
async function loadRound(): Promise<void> {
	const id = await upsertTournament(db, {
		source: 'info64',
		key: 'cto-individual-inventado-2099',
		type: 'individual',
		name: 'Campeonato Individual Inventado 2099',
		city: null,
		startDate: '2099-10-17',
		endDate: '2099-11-28',
		timeControl: null,
		url: 'https://info64.org/cto-individual-inventado-2099',
		syncedAt: '2099-10-18T00:00:00.000Z'
	})
	await db.batch(
		[1, 2].map((board) =>
			db
				.prepare(
					`INSERT INTO pairings (tournament_id, round, board, starts_at, white_rank, white_name, white_fide_id, white_rating,
						black_rank, black_name, black_fide_id, black_rating)
					VALUES (?1, 4, ?2, '2099-11-07 16:00', ?2, 'Supuesto Irreal, Uno', 9000001, 2100, ?2 + 10, 'Supuesto Irreal, Otro', 9000002, 2000)`
				)
				.bind(id, board)
		)
	)
}

beforeEach(async () => {
	await db.batch([
		db.prepare("DELETE FROM sync_state WHERE key GLOB 'salud.*'"),
		db.prepare('DELETE FROM pairings'),
		db.prepare('DELETE FROM tournaments')
	])
	await loadRound()
})

describe('GET /api/emparejamientos', () => {
	it('con la pasada de emparejamientos al día, 200 con cada ronda y sin los jugadores, con caché pública corta', async () => {
		for (const run of HEALTH_RUNS) await saveHealth(db, run, { ok: 10, fallos: 0, avisos: 0 }, hoursAgo(1))
		const { status, cache, body } = await emparejamientos()
		expect(status).toBe(200)
		expect(cache).toBe('public, max-age=300')
		expect(body).toEqual({
			rondas: [{ info64: 'cto-individual-inventado-2099', ronda: 4, empieza: '2099-11-07 16:00', mesas: 2 }]
		})
	})

	it('sólo mira la pasada de emparejamientos: las demás no cuentan', async () => {
		for (const run of HEALTH_RUNS) await saveHealth(db, run, { ok: 0, fallos: 1, avisos: 0 }, hoursAgo(30))
		await saveHealth(db, 'emparejamientos', { ok: 10, fallos: 0, avisos: 0 }, hoursAgo(1))
		expect(await emparejamientos()).toMatchObject({ status: 200, body: { rondas: [{ ronda: 4 }] } })
	})

	it('sin la clave (antes de que la ingesta la escriba), 200, como /api/estado', async () => {
		expect(await emparejamientos()).toMatchObject({ status: 200, body: { rondas: [{ ronda: 4 }] } })
	})

	it('con la pasada de hace 30 h, 503 sin caché', async () => {
		await saveHealth(db, 'emparejamientos', { ok: 10, fallos: 0, avisos: 0 }, hoursAgo(30))
		expect(await emparejamientos()).toEqual({ status: 503, cache: 'no-store', body: { emparejamientos: 'caducada' } })
	})

	it('con más del 20 % de torneos fallidos, 503', async () => {
		await saveHealth(db, 'emparejamientos', { ok: 3, fallos: 1, avisos: 0 }, hoursAgo(1))
		expect(await emparejamientos()).toEqual({ status: 503, cache: 'no-store', body: { emparejamientos: 'con fallos' } })
	})
})
