import type { APIContext } from 'astro'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { upsertTournament } from '../src/ingest/repo'
import { GET, MAX_RESULTS } from '../src/pages/api/torneos'

const db = env.DB

interface Body {
	torneos: { info64: string; nombre: string; ciudad: string | null; inicio: string | null; fin: string | null; equipos: boolean }[]
	mas: boolean
	error?: string
}

const torneos = async (query: string) => {
	const response = await GET({ url: new URL(`https://maplechess.es/api/torneos?${query}`) } as APIContext)
	return { status: response.status, cache: response.headers.get('Cache-Control'), body: (await response.json()) as Body }
}
const keys = async (query: string) => (await torneos(query)).body.torneos.map((t) => t.info64)

const tournament = (
	key: string,
	name: string,
	startDate: string,
	more: { city?: string | null; type?: 'individual' | 'team'; source?: 'info64' | 'lichess' } = {}
) =>
	upsertTournament(db, {
		source: more.source ?? 'info64',
		key,
		type: more.type ?? 'individual',
		name,
		city: more.city ?? null,
		startDate,
		endDate: startDate,
		timeControl: null,
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-18T00:00:00.000Z'
	})

beforeEach(async () => {
	await db.batch([db.prepare('DELETE FROM participations'), db.prepare('DELETE FROM tournaments')])
	await tournament('cto-alava-absoluto-2025', 'Campeonato de Álava Absoluto 2025', '2025-10-04')
	await tournament('cto-alava-absoluto-2026', 'Campeonato de Álava Absoluto 2026', '2026-10-03', { city: 'Vitoria-Gasteiz' })
	await tournament('team/liga-alavesa-2026', 'Liga Alavesa por Equipos 2026', '2026-11-14', { type: 'team' })
	await tournament('open-inventado-2026', 'Open Inventado 2026', '2026-09-12', { city: 'Vitoria-Gasteiz' })
	await tournament('open-de-lugo-2026', 'Open de Lugo 2026', '2026-08-01', { city: 'Lugo' })
	await tournament('zK5CoVvF', 'Campeonato Absoluto de lichess 2026', '2026-10-03', { source: 'lichess' })
})

describe('GET /api/torneos', () => {
	it('da los torneos de info64 que encuentra /torneos, los más recientes primero, con caché pública de una hora', async () => {
		const { status, cache, body } = await torneos('q=absoluto')
		expect(status).toBe(200)
		expect(cache).toBe('public, max-age=3600')
		expect(body).toEqual({
			torneos: [
				{
					info64: 'cto-alava-absoluto-2026',
					nombre: 'Campeonato de Álava Absoluto 2026',
					ciudad: 'Vitoria-Gasteiz',
					inicio: '2026-10-03',
					fin: '2026-10-03',
					equipos: false
				},
				{
					info64: 'cto-alava-absoluto-2025',
					nombre: 'Campeonato de Álava Absoluto 2025',
					ciudad: null,
					inicio: '2025-10-04',
					fin: '2025-10-04',
					equipos: false
				}
			],
			mas: false
		})
	})

	it('busca el sitio como /torneos: por la ciudad o por el nombre, y primero los que lo nombran', async () => {
		expect(await keys('q=alava')).toEqual([
			'team/liga-alavesa-2026',
			'cto-alava-absoluto-2026',
			'cto-alava-absoluto-2025',
			'open-inventado-2026'
		])
	})

	it('filtra por fechas y por modalidad, como /torneos', async () => {
		expect(await keys('q=alava&desde=2026-01-01&hasta=2026-10-31')).toEqual(['cto-alava-absoluto-2026', 'open-inventado-2026'])
		expect(await keys('q=alava&modalidad=equipos')).toEqual(['team/liga-alavesa-2026'])
		expect((await torneos('q=alava&modalidad=equipos')).body.torneos[0].equipos).toBe(true)
	})

	it(`como mucho ${MAX_RESULTS}, con «mas» si hay más`, async () => {
		for (let i = 1; i <= MAX_RESULTS; i++) await tournament(`memorial-inventado-${i}`, `Memorial Inventado ${i}`, `2025-01-${String(i).padStart(2, '0')}`)
		const { body } = await torneos('q=memorial')
		expect(body.torneos).toHaveLength(MAX_RESULTS)
		expect(body.mas).toBe(false)
		await tournament('memorial-inventado-extra', 'Memorial Inventado Extra', '2024-12-31')
		const more = await torneos('q=memorial')
		expect(more.body.torneos).toHaveLength(MAX_RESULTS)
		expect(more.body.mas).toBe(true)
		expect(more.body.torneos.map((t) => t.info64)).not.toContain('memorial-inventado-extra')
	})

	it('400 sin palabras o con una fecha o una modalidad mal escritas', async () => {
		for (const query of ['', 'q=', 'q=a', 'q=alava&desde=2026-1-1', 'q=alava&hasta=ayer', 'q=alava&modalidad=rapidas']) {
			const { status, cache, body } = await torneos(query)
			expect(status).toBe(400)
			expect(cache).toBeNull()
			expect(body.error).toBeTruthy()
		}
	})
})
