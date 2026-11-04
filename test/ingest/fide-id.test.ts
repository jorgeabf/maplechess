import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import { parseTournamentPage, type TournamentPlayer } from '../../src/ingest/info64/parse'
import { broadcastParticipants } from '../../src/ingest/lichess/sync'
import { replacePairings, replaceParticipations, saveGames, upsertTournament, type TournamentInput } from '../../src/ingest/repo'
import { applyFideIds } from '../../src/ingest/reprocess'
import { parseGames } from '../../src/lib/chess/pgn'
import { MIN_FIDE_ID, plausibleFideId } from '../../src/lib/chess/rating'
import { getPlayer } from '../../src/lib/db/players'
import tournamentHtml from '../fixtures/info64/tournament.html?raw'

// FIDE ID inverosímiles: el número de una federación territorial o un «1» de
// relleno en la columna o la cabecera del FIDE ID. Nombres inventados.
const db = env.DB

const tournament: TournamentInput = {
	source: 'info64',
	key: 'torneo-ids-de-relleno',
	type: 'individual',
	name: 'Torneo de los IDs de relleno',
	city: 'Ninguna',
	startDate: '2026-09-01',
	endDate: '2026-09-02',
	timeControl: '90+30',
	url: 'https://info64.org/torneo-ids-de-relleno',
	syncedAt: '2026-10-01T00:00:00.000Z'
}

const game = (board: number, white: string, black: string, extra = '') =>
	`[Event "Torneo"]\n[Round "1.${board}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "1-0"]\n${extra}\n1. e4 e5 1-0\n`

describe('plausibleFideId', () => {
	it('sólo desde el 100000: por debajo no hay ningún FIDE ID', () => {
		expect(MIN_FIDE_ID).toBe(100000)
		expect(plausibleFideId(100013)).toBe(100013)
		expect(plausibleFideId(2290979)).toBe(2290979)
		for (const value of [1, 1011, 22947, 99999, 0, -5, Number.NaN, 1.5, null, undefined]) {
			expect(plausibleFideId(value)).toBeNull()
		}
	})
})

describe('FIDE ID inverosímiles en la ingesta', () => {
	it('el ranking de info64 no los guarda', async () => {
		const page = await parseTournamentPage(tournamentHtml.replace('playerfideratid">9228291<', 'playerfideratid">1<'))
		expect(page.players[0]).toMatchObject({ name: 'Zucahu Ladoro, Ogimo', fideId: null })
		expect(page.players[1].fideId).not.toBeNull()
	})

	it('la cabecera del PGN no vale: el del participante o ninguno, y se quita del PGN', () => {
		const participants = [{ name: 'Supuesto, Uno', fideId: 930001, rating: null, title: null }]
		const text = game(1, 'Supuesto, Uno', 'Ensayo, Dos', '[WhiteFideId "1011"]\n[BlackFideId "22947"]')
		const [row] = buildGameRows(parseGames(text), participants, tournament)
		expect(row).toMatchObject({ whiteFideId: 930001, blackFideId: null })
		expect(row.pgn).toContain('[WhiteFideId "930001"]')
		expect(row.pgn).not.toContain('BlackFideId')
	})

	it('en lichess tampoco: el participante va sin FIDE ID', () => {
		const text = game(1, 'Supuesto, Uno', 'Ensayo, Dos', '[WhiteFideId "1"]\n[BlackFideId "930002"]')
		const players = broadcastParticipants(parseGames(text), null, new Set([930002]))
		expect(players.map((p) => [p.name, p.fideId, p.fed])).toEqual([
			['Ensayo, Dos', 930002, 'ESP'],
			['Supuesto, Uno', null, null]
		])
	})
})

describe('applyFideIds', () => {
	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM pairings'),
			db.prepare('DELETE FROM games'),
			db.prepare('DELETE FROM participations'),
			db.prepare('DELETE FROM tournaments'),
			db.prepare('DELETE FROM players')
		])
	})

	it('los quita de lo guardado antes, sin tocar los demás, y repetirlo no cambia nada', async () => {
		// Guardado como antes de la regla: el mismo «1» para dos personas.
		const player = (startRank: number, name: string, fideId: number): TournamentPlayer => ({
			startRank,
			team: null,
			title: null,
			name,
			fed: null,
			rating: 1800,
			fideId
		})
		const players = [player(1, 'Supuesto, Uno', 1), player(2, 'Ensayo, Dos', 1), player(3, 'Prueba, Tres', 930003)]
		const id = await upsertTournament(db, tournament)
		await replaceParticipations(db, id, players)
		// Las partidas toman el FIDE ID de los participantes, en la columna y en el PGN.
		const pgn = [game(1, 'Supuesto, Uno', 'Prueba, Tres'), game(2, 'Ensayo, Dos', 'Prueba, Tres')].join('\n')
		const rows = buildGameRows(parseGames(pgn), players, tournament)
		expect(rows.every((r) => r.whiteFideId === 1 && r.pgn.includes('[WhiteFideId "1"]'))).toBe(true)
		await saveGames(db, id, rows, '2026-10-01T00:00:00.000Z', { name: 'info64', url: null })
		const side = (startRank: number) => ({ startRank, name: 'ignorado', rating: null })
		await replacePairings(db, id, 2, '2026-09-02 10:00', [{ board: 1, white: side(1), black: side(3) }])
		expect(await getPlayer(db, 1)).not.toBeNull()

		expect(await applyFideIds(db)).toEqual({ participations: 2, games: 2, pairings: 1 })
		expect(await getPlayer(db, 1)).toBeNull()
		const participations = await db.prepare('SELECT fide_id AS fideId FROM participations ORDER BY start_rank').all()
		expect(participations.results).toEqual([{ fideId: null }, { fideId: null }, { fideId: 930003 }])
		const games = await db
			.prepare('SELECT white_fide_id AS w, black_fide_id AS b, pgn FROM games ORDER BY board')
			.all<{ w: number | null; b: number | null; pgn: string }>()
		expect(games.results.map(({ w, b }) => [w, b])).toEqual([
			[null, 930003],
			[null, 930003]
		])
		expect(games.results.every((g) => !g.pgn.includes('WhiteFideId') && g.pgn.includes('[BlackFideId "930003"]'))).toBe(true)
		expect(
			await db.prepare('SELECT white_fide_id AS w, black_fide_id AS b FROM pairings').first()
		).toEqual({ w: null, b: 930003 })

		expect(await applyFideIds(db)).toEqual({ participations: 0, games: 0, pairings: 0 })
	})
})
