import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import { parseGamesPage, parseTournamentPage } from '../../src/ingest/info64/parse'
import { reprocessGames } from '../../src/ingest/reprocess'
import { loadParticipants, replaceParticipations, saveGames, upsertTournament } from '../../src/ingest/repo'
import { parseGames } from '../../src/lib/chess/pgn'
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
