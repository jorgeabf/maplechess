import { describe, expect, it } from 'vitest'
import {
	decodeEntities,
	parseEvents,
	parseGamesPage,
	parseRoundPage,
	parseTeamListing,
	parseTournamentPage,
	parseUpcomingRounds
} from '../../src/ingest/info64/parse'
import { matchName } from '../../src/lib/chess/names'
import { parseGames } from '../../src/lib/chess/pgn'
import gamesHtml from '../fixtures/info64/games.html?raw'
import noGamesHtml from '../fixtures/info64/no-games.html?raw'
import roundUnpairedHtml from '../fixtures/info64/round-unpaired.html?raw'
import roundHtml from '../fixtures/info64/round.html?raw'
import teamGamesHtml from '../fixtures/info64/team-games.html?raw'
import teamListingHtml from '../fixtures/info64/team-listing.html?raw'
import teamTournamentHtml from '../fixtures/info64/team-tournament.html?raw'
import tournamentHtml from '../fixtures/info64/tournament.html?raw'

describe('parseEvents', () => {
	it('agrupa las rondas por torneo y limpia el título', () => {
		const events = [
			{ id: 'open-a', title: 'R.2 - Open A (Benidorm)', start: '2025-12-02T16:30:00', url: '/open-a', className: 'individual' },
			{ id: 'open-a', title: 'R.1 - Open A (Benidorm)', start: '2025-12-01T16:30:00', url: '/open-a', className: 'individual' },
			{ id: 'liga', title: 'R.1 - Liga (Linares)', start: '2022-09-17T16:00:00', url: '/team/liga', className: 'team' }
		]
		expect(parseEvents(events)).toEqual([
			{ key: 'open-a', type: 'individual', name: 'Open A', firstRound: '2025-12-01', lastRound: '2025-12-02' },
			{ key: 'team/liga', type: 'team', name: 'Liga', firstRound: '2022-09-17', lastRound: '2022-09-17' }
		])
	})
})

describe('parseUpcomingRounds', () => {
	it('da la primera ronda futura de cada torneo individual', () => {
		const events = [
			{ id: 'a', title: 'R.1 - Open A (Bilbao)', start: '2026-10-17T16:00:00', url: '/open-a', className: 'individual' },
			{ id: 'a', title: 'R.3 - Open A (Bilbao)', start: '2026-10-31T16:00:00', url: '/open-a', className: 'individual' },
			{ id: 'a', title: 'R.2 - Open A (Bilbao)', start: '2026-10-24T16:00:00', url: '/open-a', className: 'individual' },
			{ id: 'b', title: 'R.5 - Liga (Linares)', start: '2026-10-24T16:00:00', url: '/team/liga', className: 'team' },
			{ id: 'c', title: 'R.9 - Ya jugado (Murcia)', start: '2026-10-18T10:00:00', url: '/jugado', className: 'individual' }
		]
		expect(parseUpcomingRounds(events, '2026-10-18 21:00')).toEqual([
			{ key: 'open-a', name: 'Open A', round: 2, startsAt: '2026-10-24 16:00' }
		])
	})
})

describe('parseRoundPage', () => {
	it('lee la hora de la ronda y sus emparejamientos sin los descansos', async () => {
		const page = await parseRoundPage(roundHtml)
		expect(page).toMatchObject({ round: 2, startsAt: '2026-10-24 16:00' })
		// Nueve filas: siete partidas y dos jugadores que descansan.
		expect(page!.pairings.map((p) => p.board)).toEqual([1, 2, 3, 4, 5, 6, 7])
		expect(page!.pairings[0]).toEqual({
			board: 1,
			white: { startRank: 1, name: 'Vusuta Inevabume, Azene', rating: 2249 },
			black: { startRank: 7, name: 'Barejezi Vobozu, Lura', rating: 2063 }
		})
		expect(page!.pairings[1].white.name).toBe('Lamamohof Barejezi, Mahi')
	})

	it('una ronda aún sin emparejar no tiene emparejamientos', async () => {
		expect(await parseRoundPage(roundUnpairedHtml)).toEqual({ round: 3, startsAt: '2026-10-31 16:00', pairings: [] })
	})

	it('devuelve null si la página no es la de una ronda', async () => {
		expect(await parseRoundPage(tournamentHtml)).toBeNull()
	})
})

describe('decodeEntities', () => {
	it('decodifica entidades con nombre y numéricas', () => {
		expect(decodeEntities('[White &quot;A &amp; B&quot;] &#233; &#xE9; &lt;x&gt;')).toBe('[White "A & B"] é é <x>')
	})
})

describe('parseTournamentPage', () => {
	it('lee nombre, ciudad, fechas, ritmo y ranking inicial', async () => {
		const page = await parseTournamentPage(tournamentHtml)
		expect(page).toMatchObject({
			name: 'I Blitz Odiseo Chess Masters',
			city: 'Murcia',
			startDate: '2026-08-28',
			endDate: '2026-08-28',
			timeControl: '3 minutos + 2 segundos de incremento por jugada'
		})
		expect(page.players.length).toBeGreaterThan(50)
		expect(page.players[0]).toMatchObject({ startRank: 1, title: 'GM', name: 'Zucahu Ladoro, Ogimo', fideId: 9228291 })
		expect(page.players.every((p, i) => p.startRank === i + 1)).toBe(true)
	})

	it('descarta los ELO inverosímiles de la columna FIDE', async () => {
		// En el V Memorial Alfonso Pizarroso info64 publica un 118 en esa celda.
		const html = tournamentHtml.replace(/(class="playerfiderat">\s*)2638/, '$1118')
		const page = await parseTournamentPage(html)
		expect(page.players[0]).toMatchObject({ name: 'Zucahu Ladoro, Ogimo', rating: null })
		expect(page.players[1].rating).toBe(2620)
	})

	it('en torneos por equipos no devuelve jugadores', async () => {
		const page = await parseTournamentPage(teamTournamentHtml)
		expect(page).toMatchObject({
			name: 'Campeonato de Espana Equipos Division Honor 2022 295537',
			city: 'Linares',
			startDate: '2022-09-17',
			endDate: '2022-09-23',
			players: []
		})
	})
})

describe('parseGamesPage', () => {
	it('extrae el PGN completo del torneo', async () => {
		const pgn = await parseGamesPage(gamesHtml)
		expect(pgn).not.toBeNull()
		expect(pgn).not.toContain('&quot;')
		const games = parseGames(pgn!)
		expect(games).toHaveLength(90)
		expect(games[0]).toMatchObject({ round: 1, board: 1, white: 'Zucahu Ladoro, Ogimo' })
		// Dos partidas blitz traen en la fuente una jugada ilegal (transcripción
		// de tablero DGT: en la 4.8, 28... Nd4+ no responde al jaque de 28. Nxf6+).
		// Se conservan y se marca dónde se corta la línea principal.
		const illegal = games.filter((g) => g.illegalAt !== undefined).map((g) => `${g.round}.${g.board}@${g.illegalAt}`)
		expect(illegal).toEqual(['4.8@55', '6.10@89'])
	})

	it('tableros absolutos en torneos por equipos', async () => {
		const games = parseGames((await parseGamesPage(teamGamesHtml))!)
		expect(games).toHaveLength(96)
		const keys = new Set(games.map((g) => `${g.round}.${g.board}`))
		expect(keys.size).toBe(96)
	})

	it('devuelve null si el torneo no tiene partidas', async () => {
		expect(await parseGamesPage(noGamesHtml)).toBeNull()
	})

	it('lanza si la página no es la esperada', async () => {
		await expect(parseGamesPage('<html><body>Error 502</body></html>')).rejects.toThrow()
	})
})

describe('parseTeamListing', () => {
	it('lee la plantilla de cada equipo con su tablero', async () => {
		const players = await parseTeamListing(teamListingHtml)
		expect(players).toHaveLength(91)
		expect(new Set(players.map((p) => p.team)).size).toBe(8)
		expect(players[0]).toMatchObject({
			team: 'Sestao Hotel Naval',
			startRank: 1,
			title: 'GM',
			name: 'Sibun, A.R. Mesak',
			fed: 'UAE',
			rating: 2677,
			fideId: 9576809
		})
		expect(players.every((p) => p.fideId !== null)).toBe(true)
		// El tablero se repite entre equipos: cada equipo empieza en 1.
		expect(players.filter((p) => p.startRank === 1)).toHaveLength(8)
	})

	it('no encuentra plantillas en una página que no es /listing', async () => {
		expect(await parseTeamListing(teamTournamentHtml)).toEqual([])
	})
})

describe('cruce de nombres PGN ↔ plantillas de equipos', () => {
	it('asigna FIDE ID a casi todos los jugadores de las partidas por equipos', async () => {
		const players = await parseTeamListing(teamListingHtml)
		const candidates = players.map((p) => ({ name: p.name, value: p.fideId }))
		const games = parseGames((await parseGamesPage(teamGamesHtml))!)
		const names = games.flatMap((g) => [g.white, g.black])
		const matched = names.filter((n) => matchName(n, candidates) !== undefined)
		expect(matched.length / names.length).toBeGreaterThan(0.95)
	})
})

describe('cruce de nombres PGN ↔ ranking inicial', () => {
	it('asigna FIDE ID a casi todos los jugadores de las partidas', async () => {
		const { players } = await parseTournamentPage(tournamentHtml)
		const candidates = players.map((p) => ({ name: p.name, value: p.fideId }))
		const games = parseGames((await parseGamesPage(gamesHtml))!)
		const names = games.flatMap((g) => [g.white, g.black])
		const matched = names.filter((n) => matchName(n, candidates) !== undefined)
		expect(matched.length / names.length).toBeGreaterThan(0.95)
	})
})
