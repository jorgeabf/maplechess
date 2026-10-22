import { describe, expect, it } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import { findLichessBroadcasts, parseTournamentPage } from '../../src/ingest/info64/parse'
import { gamesOfTournament, parseBroadcastUrl } from '../../src/ingest/lichess/api'
import { parseGames } from '../../src/lib/chess/pgn'
import broadcastHtml from '../fixtures/info64/tournament-broadcast.html?raw'
import broadcastRoundHtml from '../fixtures/info64/tournament-broadcast-round.html?raw'
import tournamentHtml from '../fixtures/info64/tournament.html?raw'
import broadcastPgn from '../fixtures/lichess/broadcast.pgn?raw'

describe('enlaces a retransmisiones en info64', () => {
	it('los encuentra en el enlace "Live games"', async () => {
		const page = await parseTournamentPage(broadcastHtml)
		expect(page.broadcasts).toEqual([
			'https://lichess.org/broadcast/xii-open-internacional-de-ajedrez-ciudad-de-albacete-sub2400/n2ZStM1c'
		])
	})

	it('los encuentra escritos como texto en la información extra', async () => {
		const page = await parseTournamentPage(broadcastRoundHtml)
		expect(page.broadcasts).toEqual(['https://lichess.org/broadcast/campeonato-de-espana-2026-sub-18/round-1/Owmjw8DK'])
	})

	it('no repite el mismo enlace aunque aparezca dos veces', async () => {
		const page = await parseTournamentPage(tournamentHtml)
		expect(page.broadcasts).toEqual(['https://lichess.org/broadcast/i-blitz-odiseo-chess-masters/Xm66lOap'])
	})

	it('quita la puntuación pegada al final', () => {
		expect(findLichessBroadcasts('Retransmisión: https://lichess.org/broadcast/x/AbCdEf12.')).toEqual([
			'https://lichess.org/broadcast/x/AbCdEf12'
		])
	})
})

describe('parseBroadcastUrl', () => {
	it('distingue torneo y ronda', () => {
		expect(parseBroadcastUrl('https://lichess.org/broadcast/open-x/n2ZStM1c')).toEqual({ kind: 'tour', id: 'n2ZStM1c' })
		expect(parseBroadcastUrl('https://lichess.org/broadcast/open-x/round-1/Owmjw8DK')).toEqual({
			kind: 'round',
			id: 'Owmjw8DK'
		})
		expect(parseBroadcastUrl('https://lichess.org/broadcast/open-x/round-1/Owmjw8DK/on9Pgkba')).toEqual({
			kind: 'round',
			id: 'Owmjw8DK'
		})
	})

	it('rechaza lo que no es una retransmisión', () => {
		expect(parseBroadcastUrl('https://lichess.org/study/abcdefgh')).toBeNull()
		expect(parseBroadcastUrl('https://lichess.org/broadcast')).toBeNull()
		expect(parseBroadcastUrl('no es una url')).toBeNull()
	})
})

describe('gamesOfTournament', () => {
	const games = parseGames(broadcastPgn)

	it('acepta las partidas en las que juegan participantes del torneo', async () => {
		const { players } = await parseTournamentPage(broadcastHtml)
		expect(gamesOfTournament(games, players)).toHaveLength(games.length)
	})

	it('descarta las de otro torneo (enlace a otro grupo del festival)', async () => {
		const { players } = await parseTournamentPage(tournamentHtml)
		const fideIds = new Set(players.map((p) => p.fideId))
		const shared = games.filter(
			(g) => fideIds.has(Number(g.game.headers.get('WhiteFideId'))) || fideIds.has(Number(g.game.headers.get('BlackFideId')))
		)
		expect(gamesOfTournament(games, players)).toEqual(shared)
		expect(shared.length).toBeLessThan(games.length)
	})

	it('sin participantes acepta todas las que tienen jugadas', () => {
		const empty = parseGames('[White "A"]\n[Black "B"]\n[Result "*"]\n\n*')
		expect(gamesOfTournament([...games, ...empty], [])).toHaveLength(games.length)
	})
})

describe('partidas de lichess en la base', () => {
	it('toman FIDE ID, ELO, ronda y tablero de las cabeceras', async () => {
		const { players } = await parseTournamentPage(broadcastHtml)
		const rows = buildGameRows(gamesOfTournament(parseGames(broadcastPgn), players), players, {
			name: 'XII Open Internacional de Ajedrez Ciudad de Albacete Sub2400',
			city: 'Albacete',
			startDate: '2026-09-24',
			// Sin ritmo del torneo: sale de la cabecera TimeControl.
			timeControl: null
		})
		expect(rows[0]).toMatchObject({
			round: 1,
			board: 1,
			whiteFideId: 97648458,
			blackFideId: 99161832,
			whiteElo: 2034,
			blackElo: 2357,
			eco: 'B47',
			timeClass: 'standard'
		})
		expect(rows.every((r) => r.whiteFideId !== null && r.blackFideId !== null)).toBe(true)
		expect(rows[0].pgn).toContain('[GameURL "https://lichess.org/broadcast/')
		expect(rows[0].pgn).toContain('[Event "XII Open Internacional de Ajedrez Ciudad de Albacete Sub2400"]')
	})
})
