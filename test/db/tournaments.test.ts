import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import { refreshTotals, replaceParticipations, upsertTournament } from '../../src/ingest/repo'
import { getTournamentParticipants, searchTournaments, type TournamentFilters } from '../../src/lib/db/tournaments'

const db = env.DB

const player = (startRank: number, name: string, fideId: number | null): TournamentPlayer => ({
	startRank,
	team: null,
	title: null,
	name,
	fed: 'ESP',
	rating: null,
	fideId
})

const tournament = (
	key: string,
	startDate = '2026-10-17',
	endDate = '2026-10-18',
	type: 'individual' | 'team' = 'individual'
) =>
	upsertTournament(db, {
		source: 'info64',
		key,
		type,
		name: key,
		city: null,
		startDate,
		endDate,
		timeControl: null,
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-18T00:00:00.000Z'
	})

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM site_totals')
	])
})

describe('participantes', () => {

	it('marca quién tiene partidas, con cualquier color y de cualquier torneo', async () => {
		const id = await tournament('open-de-prueba')
		const other = await tournament('otro-torneo')
		await replaceParticipations(db, id, [
			player(1, 'Blancas, Ana', 9000001),
			player(2, 'Negras, Berta', 9000002),
			player(3, 'Sin Partidas, Carla', 9000003),
			player(4, 'Sin Fide, Diana', null)
		])
		// Una partida en otro torneo, entre la 1 (blancas) y la 2 (negras).
		await db
			.prepare(
				`INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_fide_id, black_fide_id,
					result, ply_count, pgn, seen_at)
				VALUES (?1, 1, 1, '2026-09-25', 'Blancas, Ana', 'Negras, Berta', 9000001, 9000002, '1-0', 40, '', '2026-09-25')`
			)
			.bind(other)
			.run()

		const participants = await getTournamentParticipants(db, id)
		expect(participants.map((p) => [p.name, p.hasGames])).toEqual([
			['Blancas, Ana', 1],
			['Negras, Berta', 1],
			['Sin Partidas, Carla', 0],
			['Sin Fide, Diana', 0]
		])
	})
})

describe('searchTournaments', () => {
	const TODAY = '2026-10-20'
	const search = async (filters: Partial<TournamentFilters>) => {
		const result = await searchTournaments(
			db,
			{ q: '', upcoming: false, withGames: false, from: '', to: '', type: null, page: 1, ...filters },
			TODAY
		)
		return { names: result.rows.map((t) => t.name), total: result.total, upcoming: result.upcoming }
	}

	beforeEach(async () => {
		const past = await tournament('Open Pasado', '2026-09-01', '2026-09-03')
		await tournament('Liga Hoy', TODAY, '2026-11-30', 'team')
		await tournament('Open Lejano', '2027-03-01', '2027-03-02')
		await tournament('Open Futuro', '2026-11-01', '2026-11-03')
		await db.prepare('UPDATE tournaments SET games_count = 5 WHERE id = ?1').bind(past).run()
		await refreshTotals(db)
	})

	it('por defecto, los que empiezan hoy o antes, del más reciente al más antiguo', async () => {
		// Sin filtros, el total son los totales guardados menos los próximos.
		expect(await search({})).toEqual({ names: ['Liga Hoy', 'Open Pasado'], total: 2, upcoming: 2 })
	})

	it('los próximos, del más cercano al más lejano', async () => {
		expect(await search({ upcoming: true })).toEqual({ names: ['Open Futuro', 'Open Lejano'], total: 2, upcoming: 2 })
	})

	it('los filtros cuentan en las dos pestañas', async () => {
		expect(await search({ q: 'open' })).toEqual({ names: ['Open Pasado'], total: 1, upcoming: 2 })
		expect(await search({ q: 'lejano', upcoming: true })).toEqual({ names: ['Open Lejano'], total: 1, upcoming: 1 })
		expect(await search({ to: '2026-11-15' })).toEqual({ names: ['Liga Hoy', 'Open Pasado'], total: 2, upcoming: 1 })
	})

	it('«Sólo con partidas» no cambia la cuenta de los próximos', async () => {
		expect(await search({ withGames: true })).toEqual({ names: ['Open Pasado'], total: 1, upcoming: 2 })
	})

	it('la modalidad filtra las dos pestañas', async () => {
		expect(await search({ type: 'team' })).toEqual({ names: ['Liga Hoy'], total: 1, upcoming: 0 })
		expect(await search({ type: 'individual' })).toEqual({ names: ['Open Pasado'], total: 1, upcoming: 2 })
		expect(await search({ type: 'individual', upcoming: true })).toEqual({
			names: ['Open Futuro', 'Open Lejano'],
			total: 2,
			upcoming: 2
		})
		expect(await search({ type: 'team', upcoming: true })).toEqual({ names: [], total: 0, upcoming: 0 })
	})
})
