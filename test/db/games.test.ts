import { env } from 'cloudflare:workers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import { parseGamesPage, parseTournamentPage } from '../../src/ingest/info64/parse'
import { loadParticipants, replaceParticipations, saveGames, upsertTournament } from '../../src/ingest/repo'
import { parseGames } from '../../src/lib/chess/pgn'
import {
	countGamesByName,
	exportGameIds,
	gameRoundPage,
	gamesPgn,
	gamesWhere,
	getGame,
	getHeadToHead,
	getTopRecentGames,
	getTournamentGames,
	RECENT_GAMES_SQL,
	ROUND_POSITION_SQL,
	searchGames,
	topPerTournament
} from '../../src/lib/db/games'
import gamesHtml from '../fixtures/info64/games.html?raw'
import tournamentHtml from '../fixtures/info64/tournament.html?raw'

const db = env.DB

beforeAll(async () => {
	await db.batch([db.prepare('DELETE FROM games'), db.prepare('DELETE FROM participations'), db.prepare('DELETE FROM tournaments')])
	const tournament = {
		source: 'info64',
		key: 'odiseo-chess-masters',
		type: 'individual' as const,
		name: 'I Blitz Odiseo Chess Masters',
		city: 'Murcia',
		startDate: '2026-08-28',
		endDate: '2026-08-28',
		timeControl: '3+2',
		url: 'https://info64.org/odiseo-chess-masters',
		syncedAt: '2026-10-17T00:00:00.000Z'
	}
	const page = await parseTournamentPage(tournamentHtml)
	const id = await upsertTournament(db, tournament)
	await replaceParticipations(db, id, page.players)
	const rows = buildGameRows(parseGames((await parseGamesPage(gamesHtml))!), await loadParticipants(db, id), tournament)
	await saveGames(db, id, rows, '2026-10-17T00:00:00.000Z', { name: 'info64', url: null })
})

describe('getHeadToHead', () => {
	it('da las partidas entre dos jugadores con cualquier color', async () => {
		const first = await db
			.prepare('SELECT white_fide_id AS a, black_fide_id AS b FROM games WHERE white_fide_id IS NOT NULL AND black_fide_id IS NOT NULL LIMIT 1')
			.first<{ a: number; b: number }>()
		const games = await getHeadToHead(db, first!.a, first!.b)
		expect(games.length).toBeGreaterThan(0)
		expect(games.every((g) => [g.whiteFideId, g.blackFideId].sort().join() === [first!.a, first!.b].sort().join())).toBe(true)
		expect((await getHeadToHead(db, first!.b, first!.a)).map((g) => g.id)).toEqual(games.map((g) => g.id))
	})
})

describe('getGame', () => {
	it('da las medias jugadas guardadas, que deciden si la partida se indexa', async () => {
		const stored = await db.prepare('SELECT id, ply_count AS plies FROM games WHERE ply_count > 0 LIMIT 1').first<{ id: number; plies: number }>()
		expect((await getGame(db, stored!.id))?.plyCount).toBe(stored!.plies)
	})
})

describe('getTournamentGames', () => {
	const tournamentId = async () => (await db.prepare('SELECT id FROM tournaments').first<{ id: number }>())!.id

	it('da las rondas con sus partidas, y el total es la suma', async () => {
		const id = await tournamentId()
		const { rounds, games } = await getTournamentGames(db, id, null, 1)
		expect(rounds.map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
		const stored = await db.prepare('SELECT count(*) AS n FROM games WHERE tournament_id = ?1').bind(id).first<{ n: number }>()
		expect(games.total).toBe(stored!.n)
		expect(rounds.reduce((sum, r) => sum + r.games, 0)).toBe(stored!.n)
		expect(games.rows).toHaveLength(50)
		expect(games.rows[0].round).toBe(1)
	})

	it('con una ronda, sólo las suyas por tablero, y cuenta las de esa ronda', async () => {
		const id = await tournamentId()
		const { rounds, games } = await getTournamentGames(db, id, 3, 1)
		expect(games.rows.length).toBeGreaterThan(0)
		expect(games.rows.every((g) => g.round === 3)).toBe(true)
		expect(games.rows.map((g) => g.board)).toEqual(games.rows.map((g) => g.board).sort((a, b) => a - b))
		expect(games.total).toBe(rounds.find((r) => r.round === 3)!.games)
		expect(games.total).toBe(games.rows.length)
	})

	it('una ronda sin partidas no da ninguna, pero sí las rondas', async () => {
		const { rounds, games } = await getTournamentGames(db, await tournamentId(), 42, 1)
		expect(games.rows).toEqual([])
		expect(games.total).toBe(0)
		expect(rounds).toHaveLength(9)
	})
})

describe('countGamesByName', () => {
	it('cuenta lo mismo que /partidas con ese jugador; null sin palabras que buscar', async () => {
		const { name } = (await db.prepare('SELECT white_name AS name FROM games LIMIT 1').first<{ name: string }>())!
		const { total } = await searchGames(db, { player: name }, 1)
		expect(total).toBeGreaterThan(0)
		expect(await countGamesByName(db, name)).toEqual({ total, capped: false })
		expect(await countGamesByName(db, 'Inexistente')).toEqual({ total: 0, capped: false })
		expect(await countGamesByName(db, '-')).toBeNull()
	})
})

describe('filtro ECO', () => {
	it('da las partidas cuyo ECO empieza por el código, de 1, 2 o 3 caracteres', async () => {
		const { results } = await db.prepare('SELECT DISTINCT eco FROM games WHERE eco IS NOT NULL').all<{ eco: string }>()
		const prefixes = new Set(results.flatMap(({ eco }) => [eco.slice(0, 1), eco.slice(0, 2), eco]))
		expect(prefixes.size).toBeGreaterThan(3)
		for (const prefix of prefixes) {
			const expected = await db
				.prepare('SELECT count(*) AS n FROM games WHERE substr(eco, 1, ?1) = ?2')
				.bind(prefix.length, prefix)
				.first<{ n: number }>()
			const { rows, total } = await searchGames(db, { eco: prefix }, 1)
			expect(total, prefix).toBe(expected!.n)
			expect(rows.every((g) => g.eco!.startsWith(prefix))).toBe(true)
		}
		const [eco] = prefixes
		expect((await searchGames(db, { eco: eco.toLowerCase() }, 1)).total).toBe((await searchGames(db, { eco }, 1)).total)
	})

	it('acaba el rango en el carácter siguiente al último del código', () => {
		expect(gamesWhere({ eco: 'B90' }).params).toEqual(['B90', 'B91'])
		expect(gamesWhere({ eco: 'b9' }).params).toEqual(['B9', 'B:'])
		expect(gamesWhere({ eco: 'E' }).params).toEqual(['E', 'F'])
	})

	it('usa el índice games_eco', async () => {
		const { sql, params } = gamesWhere({ eco: 'B90' })
		const { results } = await db
			.prepare(`EXPLAIN QUERY PLAN SELECT count(*) FROM games g ${sql}`)
			.bind(...params)
			.all<{ detail: string }>()
		expect(results.map((r) => r.detail).join('\n')).toContain('games_eco (eco>? AND eco<?)')
	})
})

describe('exportGameIds', () => {
	it('filtra por ids, y una lista vacía no da ninguna', async () => {
		const { results } = await db.prepare('SELECT id FROM games ORDER BY id LIMIT 3').all<{ id: number }>()
		const ids = await exportGameIds(db, { ids: results.map((r) => r.id) })
		expect(ids.toSorted((a, b) => a - b)).toEqual(results.map((r) => r.id))
		expect(await exportGameIds(db, { ids: [] })).toEqual([])
	})

	it('las de un torneo, por ronda y tablero; sus PGN, en ese orden', async () => {
		const tournamentId = (await db.prepare('SELECT id FROM tournaments').first<{ id: number }>())!.id
		const ids = await exportGameIds(db, { tournamentId }, 'round')
		const { games } = await getTournamentGames(db, tournamentId, null, 1)
		expect(ids.slice(0, games.rows.length)).toEqual(games.rows.map((g) => g.id))
		const pgns: string[] = []
		for await (const pgn of gamesPgn(db, ids.slice(0, 3))) pgns.push(pgn)
		const stored = await Promise.all(ids.slice(0, 3).map((id) => db.prepare('SELECT pgn FROM games WHERE id = ?1').bind(id).first<{ pgn: string }>()))
		expect(pgns).toEqual(stored.map((g) => g!.pgn))
	})
})

describe('topPerTournament', () => {
	const row = (id: number, tournamentId: number, elo: number | null) => ({ id, tournamentId, elo })
	const rows = [row(1, 1, 4000), row(2, 1, 5000), row(3, 2, null), row(4, 1, 4800), row(5, 2, 4500), row(6, 3, 4500)]
	const ids = (top: { id: number }[]) => top.map((r) => r.id)

	it('de más a menos ELO, como mucho dos por torneo y sin las que no tienen ELO', () => {
		expect(ids(topPerTournament(rows, 10))).toEqual([2, 4, 5, 6])
		expect(ids(topPerTournament(rows, 10, 1))).toEqual([2, 5, 6])
	})

	it('para en el límite; si empatan, queda el orden de entrada', () => {
		expect(ids(topPerTournament(rows, 3))).toEqual([2, 4, 5])
		expect(ids(topPerTournament([], 3))).toEqual([])
	})
})

describe('getTopRecentGames', () => {
	const FROM = '2026-10-15'

	// Después de los demás: añade torneos y partidas a los del fixture, que son de agosto.
	beforeAll(async () => {
		const tournament = (name: string) =>
			upsertTournament(db, {
				source: 'info64',
				key: name.toLowerCase(),
				type: 'individual',
				name,
				city: null,
				startDate: '2026-10-14',
				endDate: '2026-10-18',
				timeControl: '90+30',
				url: `https://info64.org/${name.toLowerCase()}`,
				syncedAt: '2026-10-19T00:00:00.000Z'
			})
		const [strong, middle, other] = [await tournament('Fuerte'), await tournament('Medio'), await tournament('Otro')]
		// torneo, mesa, fecha, ELO de blancas y de negras
		const games: [number, number, string, number | null, number | null][] = [
			[strong, 1, '2026-10-18', 2600, 2600],
			[strong, 2, '2026-10-18', 2550, 2550],
			[strong, 3, '2026-10-18', 2500, 2500],
			[middle, 1, '2026-10-15', 2400, 2400],
			[middle, 2, '2026-10-16', 2700, null],
			[middle, 3, '2026-10-14', 2700, 2700],
			[other, 1, '2026-10-17', 2450, 2450]
		]
		await db.batch(
			games.map(([tournamentId, board, date, whiteElo, blackElo]) =>
				db
					.prepare(
						`INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_elo, black_elo,
							result, ply_count, pgn, seen_at)
						VALUES (?1, 1, ?2, ?3, 'Blancas, Una', 'Negras, Otra', ?4, ?5, '1-0', 40, '', '2026-10-19')`
					)
					.bind(tournamentId, board, date, whiteElo, blackElo)
			)
		)
	})

	const names = (games: { tournamentName: string; board: number }[]) => games.map((g) => `${g.tournamentName} ${g.board}`)

	it('de más a menos ELO medio, como mucho dos por torneo, desde la fecha', async () => {
		const { games } = await getTopRecentGames(db, FROM)
		expect(names(games)).toEqual(['Fuerte 1', 'Fuerte 2', 'Otro 1', 'Medio 1'])
		expect(games[0]).toMatchObject({ whiteElo: 2600, blackElo: 2600, date: '2026-10-18', round: 1 })
	})

	it('para en el límite, y el total cuenta también las que no tienen ELO', async () => {
		const { total, games } = await getTopRecentGames(db, FROM, 3)
		expect(names(games)).toEqual(['Fuerte 1', 'Fuerte 2', 'Otro 1'])
		expect(total).toBe(6)
	})

	it('sin partidas desde la fecha, ninguna', async () => {
		expect(await getTopRecentGames(db, '2026-10-19')).toEqual({ total: 0, games: [] })
	})

	it('lee las candidatas por el índice games_date, sin ordenarlas', async () => {
		const { results } = await db.prepare(`EXPLAIN QUERY PLAN ${RECENT_GAMES_SQL}`).bind(FROM).all<{ detail: string }>()
		const plan = results.map((r) => r.detail).join(' | ')
		expect(plan).toContain('games_date (date>?)')
		expect(plan).not.toContain('TEMP B-TREE')
	})
})

describe('gameRoundPage', () => {
	// Una ronda de 120 mesas; en la 60, dos partidas (seq 0 y 1). Al final de
	// todo, y se borra: los demás no la cuentan.
	let tournamentId: number
	const idOf = async (board: number, seq = 0) =>
		(await db
			.prepare('SELECT id FROM games WHERE tournament_id = ?1 AND round = 3 AND board = ?2 AND seq = ?3')
			.bind(tournamentId, board, seq)
			.first<number>('id'))!

	beforeAll(async () => {
		tournamentId = await upsertTournament(db, {
			source: 'info64',
			key: 'open-ronda-larga',
			type: 'individual',
			name: 'Open ronda larga',
			city: null,
			startDate: null,
			endDate: null,
			timeControl: null,
			url: 'https://info64.org/open-ronda-larga',
			syncedAt: '2026-10-19T00:00:00.000Z'
		})
		await db
			.prepare(
				`WITH RECURSIVE b(j) AS (SELECT 1 UNION ALL SELECT j + 1 FROM b WHERE j < 120)
				INSERT INTO games (tournament_id, round, board, seq, white_name, black_name, result, ply_count, pgn, seen_at)
				SELECT ?1, 3, j, 0, 'Irreal, Otro', 'Inventado, Nombre', '1-0', 0, '', '' FROM b
				UNION ALL SELECT ?1, 3, 60, 1, 'Irreal, Otro', 'Inventado, Nombre', '0-1', 0, '', ''`
			)
			.bind(tournamentId)
			.run()
	})

	afterAll(async () => {
		await db.batch([
			db.prepare('DELETE FROM games WHERE tournament_id = ?1').bind(tournamentId),
			db.prepare('DELETE FROM tournaments WHERE id = ?1').bind(tournamentId)
		])
	})

	it('da la página de la lista del torneo, por ronda, en la que sale la partida', async () => {
		// mesa, seq y página: 50 por página, por mesa y seq.
		for (const [board, seq, page] of [
			[1, 0, 1],
			[50, 0, 1],
			[51, 0, 2],
			[60, 1, 2],
			[99, 0, 2],
			[100, 0, 3],
			[120, 0, 3]
		]) {
			const id = await idOf(board, seq)
			expect(await gameRoundPage(db, { id, tournamentId, round: 3, board })).toBe(page)
			const listed = await getTournamentGames(db, tournamentId, 3, page)
			expect(listed.games.rows.map((g) => g.id)).toContain(id)
		}
	})

	it('cuenta por el índice único, sin recorrer la ronda', async () => {
		const id = await idOf(10)
		const { results } = await db
			.prepare(`EXPLAIN QUERY PLAN ${ROUND_POSITION_SQL}`)
			.bind(tournamentId, 3, 10, id)
			.all<{ detail: string }>()
		expect(results.map((r) => r.detail).join(' | ')).toContain('(tournament_id=? AND round=? AND board<?)')
	})
})
