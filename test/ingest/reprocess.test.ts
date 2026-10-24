import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import { parseGamesPage, parseTournamentPage } from '../../src/ingest/info64/parse'
import { reprocessGames } from '../../src/ingest/reprocess'
import { loadParticipants, replaceParticipations, saveGames, saveLichessGames, upsertTournament } from '../../src/ingest/repo'
import { parseGames, setPgnTags } from '../../src/lib/chess/pgn'
import { explore, parseLine } from '../../src/lib/chess/repertoire'
import { getGamesByIds } from '../../src/lib/db/games'
import { getPlayerGames, repertoireGames } from '../../src/lib/db/repertoire'
import gamesHtml from '../fixtures/info64/games.html?raw'
import tournamentHtml from '../fixtures/info64/tournament.html?raw'

const db = env.DB
// Zucahu Ladoro, Ogimo: juega las 9 rondas del torneo del fixture.
const PLAYER = 9228291

async function loadTournament() {
	const page = await parseTournamentPage(tournamentHtml)
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
	const id = await upsertTournament(db, tournament)
	await replaceParticipations(db, id, page.players)
	const rows = buildGameRows(parseGames((await parseGamesPage(gamesHtml))!), await loadParticipants(db, id), tournament)
	await saveGames(db, id, rows, '2026-10-17T00:00:00.000Z', { name: 'info64', url: null })
	return rows
}

async function openingMoves(): Promise<(string | null)[]> {
	const { results } = await db.prepare('SELECT opening_moves FROM games ORDER BY id').all<{ opening_moves: string | null }>()
	return results.map((r) => r.opening_moves)
}

async function storedClocks(): Promise<(string | null)[]> {
	const { results } = await db.prepare('SELECT clocks FROM games ORDER BY id').all<{ clocks: string | null }>()
	return results.map((r) => r.clocks)
}

async function timeClasses(): Promise<(string | null)[]> {
	const { results } = await db.prepare('SELECT time_class FROM games ORDER BY id').all<{ time_class: string | null }>()
	return results.map((r) => r.time_class)
}

describe('opening_moves', () => {
	beforeEach(async () => {
		await db.batch([db.prepare('DELETE FROM games'), db.prepare('DELETE FROM participations'), db.prepare('DELETE FROM tournaments')])
	})

	it('la ingesta guarda las primeras jugadas de cada partida', async () => {
		const rows = await loadTournament()
		const stored = await openingMoves()
		expect(stored).toHaveLength(rows.length)
		expect(stored.filter(Boolean).length).toBeGreaterThan(80)
		expect(stored.every((m) => m === null || /^([a-h][1-8]){2}[qrbn]?( ([a-h][1-8]){2}[qrbn]?)*$/.test(m))).toBe(true)
		// El torneo del fixture es a 3+2: blitz.
		expect(new Set(await timeClasses())).toEqual(new Set(['blitz']))
		// Sus PGN traen el reloj: unos 3 minutos al empezar.
		const clocks = await storedClocks()
		expect(clocks.filter(Boolean).length).toBeGreaterThan(80)
		expect(clocks.find(Boolean)?.split(' ')[0]).toBe('182')
	})

	it('el reprocesado las recalcula a partir del PGN guardado, por lotes', async () => {
		await loadTournament()
		const expected = await openingMoves()
		const expectedClocks = await storedClocks()
		await db.prepare('UPDATE games SET opening_moves = NULL, time_class = NULL, clocks = NULL').run()

		let after = 0
		let batches = 0
		let games = 0
		let updated = 0
		for (let batch = await reprocessGames(db, after, 25); batch; batch = await reprocessGames(db, after, 25)) {
			after = batch.lastId
			games += batch.games
			updated += batch.updated
			batches++
		}
		expect(batches).toBe(Math.ceil(expected.length / 25))
		expect(games).toBe(expected.length)
		// Todas cambian: el ritmo se recupera también en las que no tienen jugadas.
		expect(updated).toBe(expected.length)
		expect(await openingMoves()).toEqual(expected)
		expect(new Set(await timeClasses())).toEqual(new Set(['blitz']))
		expect(await storedClocks()).toEqual(expectedClocks)

		// Repetirlo no reescribe ninguna fila.
		expect(await reprocessGames(db, 0, 1000)).toMatchObject({ games: expected.length, updated: 0 })
	})

	it('el reprocesado cuenta por lotes las partidas de lichess de cada torneo y guarda el recuento', async () => {
		await loadTournament()
		const lichessGames = async () =>
			(await db.prepare('SELECT id, lichess_games AS n FROM tournaments ORDER BY id').all<{ id: number; n: number }>()).results
		const [{ id }] = await lichessGames()
		// Treinta, como si el organizador las hubiera subido tal como salen de
		// lichess, guardadas antes de que se contaran.
		const { results } = await db.prepare('SELECT id, pgn FROM games ORDER BY id LIMIT 30').all<{ id: number; pgn: string }>()
		await db.batch(
			results.map((g) =>
				db
					.prepare('UPDATE games SET pgn = ?2 WHERE id = ?1')
					.bind(g.id, setPgnTags(g.pgn, { Site: `https://lichess.org/broadcast/ce-inventado/round-1/AbCdEfGh/Partida${g.id}` }))
			)
		)
		// Y otro torneo con un recuento que ya no vale.
		const other = await upsertTournament(db, {
			source: 'info64',
			key: 'open-inventado',
			type: 'individual',
			name: 'Open Inventado',
			city: 'Albacete',
			startDate: '2026-09-24',
			endDate: '2026-09-27',
			timeControl: '60+30',
			url: 'https://info64.org/open-inventado',
			syncedAt: '2026-10-17T00:00:00.000Z'
		})
		await db.prepare('UPDATE tournaments SET lichess_games = 5 WHERE id = ?1').bind(other).run()

		// Las treinta caen en dos lotes.
		const counts = new Map<number, number>()
		let after = 0
		for (let batch = await reprocessGames(db, after, 25); batch; batch = await reprocessGames(db, after, 25)) {
			for (const [tournament, n] of batch.lichess) counts.set(tournament, (counts.get(tournament) ?? 0) + n)
			after = batch.lastId
		}
		expect([...counts]).toEqual([[id, 30]])

		expect(await saveLichessGames(db, [...counts])).toBe(2)
		expect(await lichessGames()).toEqual([
			{ id, n: 30 },
			{ id: other, n: 0 }
		])
		// Repetirlo no reescribe ninguno.
		expect(await saveLichessGames(db, [...counts])).toBe(0)
	})

	it('el repertorio lee las partidas del jugador por color, periodo, ritmo y ELO del rival', async () => {
		await loadTournament()
		const white = repertoireGames(await getPlayerGames(db, PLAYER, 'white'))
		const black = repertoireGames(await getPlayerGames(db, PLAYER, 'black'))
		expect(white.length + black.length).toBe(9)
		expect(await getPlayerGames(db, PLAYER, 'white', { from: '2026-09-01' })).toEqual([])
		expect(await getPlayerGames(db, PLAYER, 'white', { timeClass: 'rapid' })).toEqual([])
		expect(await getPlayerGames(db, PLAYER, 'white', { timeClass: 'blitz' })).toHaveLength(white.length)
		const strong = await getPlayerGames(db, PLAYER, 'white', { minOpponentElo: 2400 })
		expect(strong.length).toBeLessThan(white.length)
		expect(strong.every((g) => g.opponentElo! >= 2400 && g.ownElo !== null)).toBe(true)

		const root = explore(white, parseLine('').position, 'white')
		expect(root.total.games).toBe(white.length)
		expect(root.moves.reduce((n, m) => n + m.games, 0)).toBe(white.length)

		const details = await getGamesByIds(db, root.games.map((g) => g.id))
		expect(details.map((g) => g.whiteFideId)).toEqual(white.map(() => PLAYER))

		// Los relojes sólo se leen si se piden (el dossier).
		expect((await getPlayerGames(db, PLAYER, 'white')).every((g) => g.clocks === null)).toBe(true)
		const withClocks = await getPlayerGames(db, PLAYER, 'white', {}, { clocks: true })
		expect(withClocks.some((g) => g.clocks !== null)).toBe(true)
	})
})
