import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import { parseGamesPage, parseTournamentPage } from '../../src/ingest/info64/parse'
import {
	chunkByJsonSize,
	loadCheckedTournaments,
	loadParticipants,
	markGamesChecked,
	refreshTotals,
	replaceParticipations,
	saveGames,
	upsertFidePlayers,
	upsertTournament,
	type TournamentInput
} from '../../src/ingest/repo'
import type { FidePlayer } from '../../src/ingest/fide/parse'
import { parseGames, setPgnTags } from '../../src/lib/chess/pgn'
import { getTotals, TOURNAMENT_ORDER } from '../../src/lib/db/tournaments'
import gamesHtml from '../fixtures/info64/games.html?raw'
import tournamentHtml from '../fixtures/info64/tournament.html?raw'

const db = env.DB
const INFO64 = { name: 'info64', url: null }

const tournament: TournamentInput = {
	source: 'info64',
	key: 'odiseo-chess-masters',
	type: 'individual',
	name: 'I Blitz Odiseo Chess Masters',
	city: 'Murcia',
	startDate: '2026-08-28',
	endDate: '2026-08-28',
	timeControl: '3+2',
	url: 'https://info64.org/odiseo-chess-masters',
	syncedAt: '2026-10-17T00:00:00.000Z'
}

async function loadFixture() {
	const page = await parseTournamentPage(tournamentHtml)
	const id = await upsertTournament(db, tournament)
	await replaceParticipations(db, id, page.players)
	const parsed = parseGames((await parseGamesPage(gamesHtml))!)
	const rows = buildGameRows(parsed, await loadParticipants(db, id), tournament)
	return { id, page, rows }
}

describe('chunkByJsonSize', () => {
	it('corta los lotes por tamaño sin partir filas', () => {
		const rows = Array.from({ length: 10 }, (_, i) => ({ i, text: 'x'.repeat(100) }))
		const chunks = chunkByJsonSize(rows, 400)
		expect(chunks.length).toBeGreaterThan(1)
		expect(chunks.flatMap((c) => JSON.parse(c))).toEqual(rows)
		expect(chunks.every((c) => new TextEncoder().encode(c).length <= 400)).toBe(true)
	})
})

describe('upsertFidePlayers', () => {
	const player = (fideId: number, ratingStd: number): FidePlayer => ({
		fideId,
		name: `Jugador ${fideId}`,
		fed: 'ESP',
		sex: 'M',
		title: null,
		birthYear: 1990,
		ratingStd,
		ratingRapid: null,
		ratingBlitz: null,
		inactive: false
	})
	const ratings = async () =>
		(
			await db
				.prepare('SELECT fide_id AS fideId, rating_std AS ratingStd, rating_std_prev AS prev FROM players ORDER BY fide_id')
				.all<{ fideId: number; ratingStd: number; prev: number | null }>()
		).results

	beforeEach(async () => {
		await db.prepare('DELETE FROM players').run()
		await upsertFidePlayers(db, [player(1, 1800)], '2026-09', '2026-09-03T06:00:00.000Z')
	})

	// Los demás tests del fichero cuentan los jugadores (totales de la portada).
	afterEach(async () => {
		await db.prepare('DELETE FROM players').run()
	})

	it('en el alta no hay ELO anterior', async () => {
		expect(await ratings()).toEqual([{ fideId: 1, ratingStd: 1800, prev: null }])
	})

	it('con la lista de otro mes, el ELO que tenía pasa a ser el anterior', async () => {
		await upsertFidePlayers(db, [player(1, 1850), player(2, 1500)], '2026-10', '2026-10-03T06:00:00.000Z')
		expect(await ratings()).toEqual([
			{ fideId: 1, ratingStd: 1850, prev: 1800 },
			{ fideId: 2, ratingStd: 1500, prev: null }
		])
	})

	it('en el mismo mes (un reintento o un force a mitad de mes), el anterior no cambia', async () => {
		await upsertFidePlayers(db, [player(1, 1850)], '2026-10', '2026-10-03T06:00:00.000Z')
		await upsertFidePlayers(db, [player(1, 1850)], '2026-10', '2026-10-16T21:00:00.000Z')
		expect(await ratings()).toEqual([{ fideId: 1, ratingStd: 1850, prev: 1800 }])
	})

	it('quita el año del nombre a los homónimos que pueden ser menores, y lo devuelve cuando dejan de serlo', async () => {
		const homonym = (fideId: number, name: string, birthYear: number) => ({ ...player(fideId, 1500), name, birthYear })
		const list = [homonym(2, 'Inventado Ficticio, Nombre 2008', 2008), homonym(3, 'Supuesto Irreal, Otro 2007 I', 2007)]
		const names = async () =>
			(await db.prepare('SELECT name FROM players WHERE fide_id > 1 ORDER BY fide_id').all<{ name: string }>()).results
		await upsertFidePlayers(db, list, '2026-10', '2026-10-03T06:00:00.000Z')
		expect(await names()).toEqual([{ name: 'Inventado Ficticio, Nombre' }, { name: 'Supuesto Irreal, Otro 2007 I' }])
		await upsertFidePlayers(db, list, '2027-01', '2027-01-03T06:00:00.000Z')
		expect(await names()).toEqual([{ name: 'Inventado Ficticio, Nombre 2008' }, { name: 'Supuesto Irreal, Otro 2007 I' }])
	})
})

describe('repositorio de ingesta', () => {
	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM games'),
			db.prepare('DELETE FROM participations'),
			db.prepare('DELETE FROM tournaments'),
			db.prepare('DELETE FROM site_totals')
		])
	})

	it('el upsert de torneo conserva el id', async () => {
		const a = await upsertTournament(db, tournament)
		const b = await upsertTournament(db, { ...tournament, name: 'Otro nombre' })
		expect(b).toBe(a)
		const row = await db.prepare('SELECT name FROM tournaments WHERE id = ?1').bind(a).first<{ name: string }>()
		expect(row?.name).toBe('Otro nombre')
	})

	it('guarda participantes y partidas con jugadores identificados y PGN enriquecido', async () => {
		const { id, page, rows } = await loadFixture()
		await saveGames(db, id, rows, '2026-10-17T00:00:00.000Z', INFO64)

		const participants = await loadParticipants(db, id)
		expect(participants).toHaveLength(page.players.length)

		const stats = await db
			.prepare(
				`SELECT count(*) AS games,
					sum(white_fide_id IS NOT NULL) + sum(black_fide_id IS NOT NULL) AS identified,
					sum(eco IS NOT NULL) AS withEco
				FROM games WHERE tournament_id = ?1`
			)
			.bind(id)
			.first<{ games: number; identified: number; withEco: number }>()
		expect(stats?.games).toBe(90)
		expect(stats!.identified / (2 * stats!.games)).toBeGreaterThan(0.95)
		expect(stats!.withEco).toBeGreaterThan(80)

		const first = await db
			.prepare('SELECT white_name, white_fide_id, white_elo, pgn FROM games WHERE tournament_id = ?1 AND round = 1 AND board = 1')
			.bind(id)
			.first<{ white_name: string; white_fide_id: number; white_elo: number; pgn: string }>()
		expect(first).toMatchObject({ white_name: 'Zucahu Ladoro, Ogimo', white_fide_id: 9228291 })
		expect(first?.pgn).toContain('[WhiteFideId "9228291"]')
		expect(first?.pgn).toContain('[Event "I Blitz Odiseo Chess Masters"]')
		expect(first?.pgn).toContain('[ECO "')

		const counter = await db.prepare('SELECT games_count FROM tournaments WHERE id = ?1').bind(id).first<{ games_count: number }>()
		expect(counter?.games_count).toBe(90)
	})

	it('resincronizar mantiene los id y borra lo que la fuente ya no publica', async () => {
		const { id, rows } = await loadFixture()
		await saveGames(db, id, rows, '2026-10-17T00:00:00.000Z', INFO64)
		const before = await db
			.prepare('SELECT id FROM games WHERE tournament_id = ?1 AND round = 2 AND board = 3')
			.bind(id)
			.first<{ id: number }>()

		// La fuente quita la ronda 9.
		await saveGames(db, id, rows.filter((r) => r.round !== 9), '2026-10-18T00:00:00.000Z', INFO64)
		const after = await db
			.prepare('SELECT id FROM games WHERE tournament_id = ?1 AND round = 2 AND board = 3')
			.bind(id)
			.first<{ id: number }>()
		expect(after?.id).toBe(before?.id)
		const round9 = await db.prepare('SELECT count(*) AS n FROM games WHERE tournament_id = ?1 AND round = 9').bind(id).first<{ n: number }>()
		expect(round9?.n).toBe(0)
	})

	it('resincronizar sin las copias repetidas conserva la partida y borra la copia', async () => {
		const { id, rows } = await loadFixture()
		// Así guardaba antes la ingesta una partida que la fuente publicaba dos veces.
		const copy = { ...rows[0], seq: 1 }
		await saveGames(db, id, [...rows, copy], '2026-10-17T00:00:00.000Z', INFO64)
		const sameBoard = db
			.prepare('SELECT id, seq FROM games WHERE tournament_id = ?1 AND round = ?2 AND board = ?3 ORDER BY seq')
			.bind(id, rows[0].round, rows[0].board)
		const before = await sameBoard.all<{ id: number; seq: number }>()
		expect(before.results).toHaveLength(2)

		await saveGames(db, id, rows, '2026-10-18T00:00:00.000Z', INFO64)
		const after = await sameBoard.all<{ id: number; seq: number }>()
		expect(after.results).toEqual([before.results[0]])
		const counter = await db.prepare('SELECT games_count FROM tournaments WHERE id = ?1').bind(id).first<{ games_count: number }>()
		expect(counter?.games_count).toBe(rows.length)
	})

	it('cuenta las partidas de lichess por sus cabeceras, también si las publica info64', async () => {
		const { id, rows } = await loadFixture()
		const lichessGames = async () =>
			(await db.prepare('SELECT lichess_games AS n FROM tournaments WHERE id = ?1').bind(id).first<{ n: number }>())?.n
		await saveGames(db, id, rows, '2026-10-17T00:00:00.000Z', INFO64)
		expect(await lichessGames()).toBe(0)

		// El organizador sube a info64 algunas tal como salen de lichess, con su Site.
		const exported = rows.map((row, i) =>
			i < 3 ? { ...row, pgn: setPgnTags(row.pgn, { Site: `https://lichess.org/broadcast/ce-inventado/round-1/AbCdEfGh/Partida${i}` }) } : row
		)
		await saveGames(db, id, exported, '2026-10-18T00:00:00.000Z', INFO64)
		expect(await lichessGames()).toBe(3)

		// Una lectura vacía no se guarda, y el recuento se queda como estaba.
		expect(await saveGames(db, id, [], '2026-10-19T00:00:00.000Z', INFO64)).toBe(false)
		expect(await lichessGames()).toBe(3)
	})

	it('marcar como revisado no toca las partidas', async () => {
		const { id, rows } = await loadFixture()
		await saveGames(db, id, rows, '2026-10-17T00:00:00.000Z', INFO64)
		await markGamesChecked(db, id, '2026-10-18T00:00:00.000Z')
		const state = await db
			.prepare('SELECT games_count, games_checked_at, games_source FROM tournaments WHERE id = ?1')
			.bind(id)
			.first()
		expect(state).toEqual({ games_count: rows.length, games_checked_at: '2026-10-18T00:00:00.000Z', games_source: 'info64' })
	})

	it('guarda plantillas de equipos aunque el tablero se repita entre equipos', async () => {
		const id = await upsertTournament(db, { ...tournament, key: 'team/liga', type: 'team' })
		const player = { startRank: 1, title: null, fed: 'ESP', rating: 2000, fideId: null }
		await replaceParticipations(db, id, [
			{ ...player, team: 'Equipo A', name: 'Uno, A' },
			{ ...player, team: 'Equipo B', name: 'Uno, B' }
		])
		const { results } = await db
			.prepare('SELECT team, start_rank, name FROM participations WHERE tournament_id = ?1 ORDER BY team')
			.bind(id)
			.all()
		expect(results).toEqual([
			{ team: 'Equipo A', start_rank: 1, name: 'Uno, A' },
			{ team: 'Equipo B', start_rank: 1, name: 'Uno, B' }
		])
	})

	it('guarda los totales de la portada al recalcularlos', async () => {
		const { id, rows } = await loadFixture()
		await saveGames(db, id, rows, '2026-10-17T00:00:00.000Z', INFO64)
		expect(await getTotals(db)).toEqual({ players: 0, games: 0, tournaments: 0 })
		await refreshTotals(db)
		expect(await getTotals(db)).toEqual({ players: 0, games: 90, tournaments: 1 })
	})

	it('el listado de torneos recorre el índice por fecha sin ordenar la tabla', async () => {
		const { results } = await db
			.prepare(`EXPLAIN QUERY PLAN SELECT t.id FROM tournaments t ${TOURNAMENT_ORDER} LIMIT 50`)
			.all<{ detail: string }>()
		const plan = results.map((r) => r.detail).join(' | ')
		expect(plan).toContain('tournaments_start_date')
		expect(plan).not.toContain('TEMP B-TREE')
	})

	it('la búsqueda de texto encuentra partidas por nombre sin tildes', async () => {
		const { id, rows } = await loadFixture()
		await saveGames(db, id, rows, '2026-10-17T00:00:00.000Z', INFO64)
		const { results } = await db
			.prepare(`SELECT g.id FROM games_fts JOIN games g ON g.id = games_fts.rowid WHERE games_fts MATCH ?1`)
			.bind('"zucahu"* "ladoro"*')
			.all()
		expect(results.length).toBeGreaterThan(5)
	})

	it('informa del estado de comprobación de los torneos pedidos', async () => {
		const { id, rows } = await loadFixture()
		await saveGames(db, id, rows, '2026-10-17T00:00:00.000Z', INFO64)
		const checked = await loadCheckedTournaments(db, 'info64', ['odiseo-chess-masters', 'no-existe'])
		expect(checked).toEqual([{ key: 'odiseo-chess-masters', endDate: '2026-08-28', gamesCheckedAt: '2026-10-17T00:00:00.000Z' }])
	})
})
