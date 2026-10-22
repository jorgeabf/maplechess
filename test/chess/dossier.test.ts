import { describe, expect, it } from 'vitest'
import {
	crossReference,
	mainLines,
	openingFamily,
	recentChanges,
	resultsByEloGap,
	type DossierGame
} from '../../src/lib/chess/dossier'
import { parseGames } from '../../src/lib/chess/pgn'
import { positionKey } from '../../src/lib/chess/eco'
import { explore, indexPositions, parseLine, type RepertoireGame } from '../../src/lib/chess/repertoire'
import broadcastPgn from '../fixtures/lichess/broadcast.pgn?raw'

/** Partida del repertorio a partir de su movetext en SAN. */
function game(id: number, movetext: string, result = '1-0', date = '2026-01-01'): RepertoireGame {
	const [parsed] = parseGames(`${movetext} *`)
	return { id, date, result, openingMoves: parsed.openingMoves! }
}

const sanLine = (moves: string[]) => parseLine(moves.join(' ')).moves.map((m) => m.san).join(' ')

describe('indexPositions', () => {
	const games = parseGames(broadcastPgn)
		.filter((g) => g.openingMoves)
		.map((g, i): RepertoireGame => ({ id: i + 1, date: g.date, result: g.result, openingMoves: g.openingMoves! }))

	it('da en cada posición lo mismo que explore', () => {
		const index = indexPositions(games, 'white', 40)
		for (const uci of ['', 'e2e4', 'e2e4 c7c5', 'd2d4 g8f6 c2c4', 'e2e4 c7c5 g1f3 d7d6']) {
			const target = parseLine(uci).position
			const explored = explore(games, target, 'white')
			const node = index.get(positionKey(target))
			expect(node?.stats ?? null).toEqual(explored.total.games ? explored.total : null)
			for (const move of explored.moves) {
				const { uci, san: _san, ...stats } = move
				expect(node?.moves.get(uci)?.stats).toEqual(stats)
			}
		}
	})

	it('junta las transposiciones', () => {
		const index = indexPositions(
			[game(1, '1. d4 Nf6 2. c4 e6'), game(2, '1. c4 e6 2. d4 Nf6'), game(3, '1. Nf3 d5')],
			'white'
		)
		expect(index.get(positionKey(parseLine('d2d4 g8f6 c2c4 e7e6').position))?.stats.games).toBe(2)
	})

	it('cuenta una partida una sola vez aunque repita la posición', () => {
		const index = indexPositions([game(1, '1. Nf3 Nf6 2. Ng1 Ng8 3. e4')], 'white')
		expect(index.get(positionKey(parseLine('').position))?.stats.games).toBe(1)
	})
})

describe('mainLines', () => {
	it('sigue las jugadas con partidas suficientes y corta donde se dispersan', () => {
		const games = [
			game(1, '1. e4 c5 2. Nf3 d6 3. d4', '1-0', '2026-03-01'),
			game(2, '1. e4 c5 2. Nf3 d6 3. d4', '0-1', '2026-02-01'),
			game(3, '1. e4 c5 2. Nf3 Nc6 3. Bb5', '1/2-1/2'),
			game(4, '1. e4 e5 2. Nf3 Nc6 3. Bc4'),
			game(5, '1. e4 e5 2. Nf3 Nc6 3. Bb5'),
			game(6, '1. d4 d5 2. c4')
		]
		const lines = mainLines(indexPositions(games, 'white'))
		expect(lines.map((l) => [sanLine(l.moves), l.stats.games])).toEqual([
			['e4 c5 Nf3 d6 d4', 2],
			['e4 e5 Nf3 Nc6', 2]
		])
		expect(lines[0].stats).toMatchObject({ wins: 1, losses: 1, lastDate: '2026-03-01' })
	})

	it('no repite una línea a la que se llega por otro orden de jugadas', () => {
		const games = [
			game(1, '1. d4 Nf6 2. c4 e6 3. Nf3 b6'),
			game(2, '1. d4 Nf6 2. c4 e6 3. Nf3 b6'),
			game(3, '1. d4 Nf6 2. c4 e6 3. Nf3 b6'),
			game(4, '1. c4 e6 2. d4 Nf6 3. Nf3 b6'),
			game(5, '1. c4 e6 2. d4 Nf6 3. Nf3 b6')
		]
		const lines = mainLines(indexPositions(games, 'white'))
		expect(lines.map((l) => [sanLine(l.moves), l.stats.games])).toEqual([['d4 Nf6 c4 e6 Nf3 b6', 5]])
	})

	it('sin ninguna jugada repetida no hay líneas', () => {
		expect(mainLines(indexPositions([game(1, '1. e4'), game(2, '1. d4')], 'white'))).toEqual([])
	})
})

const dossierGame = (date: string, opening: string, result = '1-0', ownElo = 1800, opponentElo: number | null = 1800): DossierGame => ({
	date,
	opening,
	result,
	ownElo,
	opponentElo
})

describe('recentChanges', () => {
	const today = '2026-10-18'
	const repeat = (n: number, date: string, opening: string) => Array.from({ length: n }, () => dossierGame(date, opening))

	it('detecta aperturas nuevas y abandonadas', () => {
		const changes = recentChanges(
			[
				...repeat(4, '2026-05-01', 'Caro-Kann Defense: Exchange Variation'),
				...repeat(2, '2026-03-01', 'Sicilian Defense: Najdorf Variation'),
				...repeat(5, '2025-01-01', 'Sicilian Defense: Dragon Variation'),
				...repeat(4, '2024-06-01', 'French Defense: Winawer Variation'),
				dossierGame('2020-01-01', 'Pirc Defense')
			],
			today
		)
		expect(changes).toMatchObject({
			since: '2025-10-18',
			recentGames: 6,
			beforeGames: 9,
			adopted: [{ family: 'Caro-Kann Defense', recent: 4, before: 0 }],
			dropped: [{ family: 'French Defense', recent: 0, before: 4 }]
		})
	})

	it('con pocas partidas en algún periodo no compara', () => {
		expect(recentChanges(repeat(10, '2026-05-01', 'Caro-Kann Defense'), today)).toBeNull()
	})

	it('agrupa por familia', () => {
		expect(openingFamily('Sicilian Defense: Najdorf Variation, English Attack')).toBe('Sicilian Defense')
		expect(openingFamily("King's Gambit")).toBe("King's Gambit")
	})
})

describe('resultsByEloGap', () => {
	it('separa por la diferencia de ELO con el rival', () => {
		const groups = resultsByEloGap(
			[
				dossierGame('2026-01-01', 'X', '1-0', 1800, 1950),
				dossierGame('2026-01-01', 'X', '0-1', 1800, 1850),
				dossierGame('2026-01-01', 'X', '1/2-1/2', 1800, 1650),
				dossierGame('2026-01-01', 'X', '1-0', 1800, null)
			],
			'white'
		)
		expect(groups.stronger).toMatchObject({ games: 1, wins: 1 })
		expect(groups.similar).toMatchObject({ games: 1, losses: 1 })
		expect(groups.weaker).toMatchObject({ games: 1, draws: 1 })
		expect(groups.unknown).toMatchObject({ games: 1, wins: 1 })
	})
})

describe('crossReference', () => {
	// Rival con blancas: su línea principal es 1.e4 c5 2.Nf3 d6 3.d4.
	const rivalGames = [
		game(1, '1. e4 c5 2. Nf3 d6 3. d4'),
		game(2, '1. e4 c5 2. Nf3 d6 3. d4'),
		game(3, '1. e4 c5 2. Nf3 d6 3. d4'),
		game(4, '1. e4 e5 2. Nf3')
	]
	const rivalIndex = indexPositions(rivalGames, 'white')
	const [line] = mainLines(rivalIndex)
	const cross = (mine: RepertoireGame[]) => crossReference(line, indexPositions(mine, 'black'), rivalIndex, 'white')

	it('parte de su línea principal', () => {
		expect(sanLine(line.moves)).toBe('e4 c5 Nf3 d6 d4')
	})

	it('si la conoces entera, llega al final', () => {
		expect(cross([game(10, '1. e4 c5 2. Nf3 d6 3. d4 Nf6', '0-1')])).toMatchObject({
			kind: 'known',
			moves: line.moves,
			yours: { games: 1, wins: 1 }
		})
	})

	it('se para donde tú sueles jugar otra cosa y dice qué hace él contra eso', () => {
		const point = cross([game(10, '1. e4 e5'), game(11, '1. e4 e5'), game(12, '1. e4 c5 2. Nf3 Nc6')])
		expect(point).toMatchObject({ kind: 'you-deviate', moves: ['e2e4'], lineMove: 'c7c5' })
		expect(point?.yourMoves.map((m) => [m.uci, m.stats.games])).toEqual([
			['e7e5', 2],
			['c7c5', 1]
		])
		expect(point?.rivalAfter?.stats.games).toBe(1)
		expect(point?.rivalAfter?.replies.map((m) => m.uci)).toEqual(['g1f3'])
	})

	it('se para donde él juega algo que nunca te han jugado', () => {
		expect(cross([game(10, '1. d4 d5')])).toMatchObject({ kind: 'new-for-you', moves: [], lineMove: 'e2e4' })
		expect(cross([game(10, '1. e4 c5 2. Nc3')])).toMatchObject({
			kind: 'new-for-you',
			moves: ['e2e4', 'c7c5'],
			lineMove: 'g1f3'
		})
	})

	it('sin partidas tuyas con ese color no hay cruce', () => {
		expect(cross([])).toBeNull()
	})
})
