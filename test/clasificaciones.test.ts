import type { APIContext } from 'astro'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TournamentPlayer } from '../src/ingest/info64/parse'
import { replaceParticipations, replaceStandings, upsertTournament } from '../src/ingest/repo'
import { GET, MAX_TOURNAMENTS } from '../src/pages/api/clasificaciones'

const db = env.DB

const clasificaciones = async (query: string) => {
	const response = await GET({ url: new URL(`https://maplechess.es/api/clasificaciones?${query}`) } as APIContext)
	const body = (await response.json()) as { torneos: { info64: string; primero: unknown }[] }
	return { status: response.status, cache: response.headers.get('Cache-Control'), body }
}

const tournament = (key: string, type: 'individual' | 'team', endDate = '2026-08-09') =>
	upsertTournament(db, {
		source: 'info64',
		key,
		type,
		name: `Campeonato Inventado ${key}`,
		city: null,
		startDate: '2026-08-01',
		endDate,
		timeControl: null,
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z'
	})

const player = (startRank: number, name: string, fideId: number | null, title: string | null = null): TournamentPlayer => ({
	startRank,
	team: null,
	title,
	name,
	fed: 'ESP',
	rating: 2000 - startRank,
	fideId
})

/** Clasificación individual: [puesto, número inicial], tras la ronda `round` de 9. */
const standings = (id: number, rows: [pos: number, startRank: number][], round = 9) =>
	replaceStandings(db, id, 'individual', {
		round,
		rounds: 9,
		tiebreaks: ['BH'],
		rows: rows.map(([pos, startRank]) => ({ pos, startRank, name: `Fuente ${startRank}`, points: 9 - pos, tiebreaks: [30], rating: null }))
	})

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM standings'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM players')
	])
})

describe('GET /api/clasificaciones', () => {
	it('da el primero de cada torneo, en el orden pedido, con caché pública de una hora', async () => {
		const final = await tournament('cto-inventado-2025', 'individual')
		await replaceParticipations(db, final, [player(1, 'Primero Inventado, Uno', 9500001, 'FM'), player(2, 'Segundo Inventado, Dos', 9500002)])
		await standings(final, [
			[1, 1],
			[2, 2]
		])
		const playing = await tournament('cto-en-juego-2026', 'individual', '2099-12-31')
		await replaceParticipations(db, playing, [player(1, 'Líder Inventado, Uno', null)])
		await standings(playing, [[1, 1]], 5)

		const { status, cache, body } = await clasificaciones('info64=cto-en-juego-2026,cto-inventado-2025')
		expect(status).toBe(200)
		expect(cache).toBe('public, max-age=3600')
		expect(body).toEqual({
			torneos: [
				{
					info64: 'cto-en-juego-2026',
					final: false,
					ronda: 5,
					rondas: 9,
					primero: { titulo: null, nombre: 'Líder Inventado, Uno', fide: null }
				},
				{
					info64: 'cto-inventado-2025',
					final: true,
					ronda: 9,
					rondas: 9,
					primero: { titulo: 'FM', nombre: 'Primero Inventado, Uno', fide: 9500001 }
				}
			]
		})
	})

	it('con su nombre de la lista FIDE, y sin nombre ni FIDE ID si puede ser menor', async () => {
		const adult = await tournament('abierto-inventado', 'individual')
		await replaceParticipations(db, adult, [player(1, 'Lista Inventado, Jose Antonio', 9500001)])
		await standings(adult, [[1, 1]])
		const young = await tournament('abierto-joven', 'individual')
		await replaceParticipations(db, young, [player(1, 'Joven Inventada, Una', 9500002, 'WFM')])
		await standings(young, [[1, 1]])
		await db.batch([
			db.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (9500001, 'Lista Inventado, Josep Anton', 1970, '')"),
			db
				.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (9500002, 'Joven Inventada, Una', ?1, '')")
				.bind(new Date().getFullYear() - 10)
		])

		const { body } = await clasificaciones('info64=abierto-inventado,abierto-joven')
		expect(body.torneos.map((t) => t.primero)).toEqual([
			{ titulo: null, nombre: 'Lista Inventado, Josep Anton', fide: 9500001 },
			{ titulo: null, nombre: null, fide: null }
		])
	})

	it('sin el nombre de quien se ha retirado', async () => {
		const id = await tournament('abierto-retirado', 'individual')
		await db.prepare("INSERT INTO retiradas (fide_id, nombre, creada) VALUES (9500001, 'Retirado Inventado, Uno', '2026-10-22')").run()
		await replaceParticipations(db, id, [player(1, 'Retirado Inventado, Uno', 9500001)])
		await standings(id, [[1, 1]])
		await db.prepare('DELETE FROM retiradas').run()

		const { body } = await clasificaciones('info64=abierto-retirado')
		expect(body.torneos[0].primero).toEqual({ titulo: null, nombre: null, fide: null })
	})

	it('en un torneo por equipos, el equipo, con «team/» en el slug', async () => {
		const id = await tournament('team/liga-inventada', 'team')
		await replaceStandings(db, id, 'team', {
			round: null,
			rounds: 7,
			tiebreaks: ['GamPnt'],
			rows: [
				{ pos: 1, startRank: 3, name: 'Club Inventado', points: 12, tiebreaks: [28], rating: 2100 },
				{ pos: 2, startRank: 1, name: 'Otro Club Inventado', points: 11, tiebreaks: [29], rating: 2150 }
			]
		})

		const { body } = await clasificaciones('info64=team/liga-inventada')
		expect(body).toEqual({
			torneos: [{ info64: 'team/liga-inventada', final: true, ronda: null, rondas: 7, primero: { equipo: 'Club Inventado' } }]
		})
	})

	it('no da los torneos que no tiene o sin clasificación', async () => {
		await tournament('sin-clasificacion', 'individual')
		expect((await clasificaciones('info64=sin-clasificacion,no-guardado')).body).toEqual({ torneos: [] })
	})

	it('400 sin lista, con demasiados o con un slug que no lo es', async () => {
		const many = Array.from({ length: MAX_TOURNAMENTS + 1 }, (_, i) => `t-${i}`).join(',')
		for (const query of ['', 'info64=', `info64=${many}`, 'info64=../admin', 'info64=a%20b']) {
			const { status, cache } = await clasificaciones(query)
			expect(status).toBe(400)
			expect(cache).toBeNull()
		}
	})
})
