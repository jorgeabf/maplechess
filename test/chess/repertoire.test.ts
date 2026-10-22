import { describe, expect, it } from 'vitest'
import { OPENING_MOVES_PLIES, parseGames } from '../../src/lib/chess/pgn'
import { explore, parseLine, score, type RepertoireGame } from '../../src/lib/chess/repertoire'
import broadcastPgn from '../fixtures/lichess/broadcast.pgn?raw'

/** Partida del repertorio a partir de su movetext en SAN. */
function game(id: number, movetext: string, result: string, date: string): RepertoireGame {
	const [parsed] = parseGames(`${movetext} *`)
	return { id, date, result, openingMoves: parsed.openingMoves! }
}

const start = () => parseLine('').position

describe('parseLine', () => {
	it('lee la secuencia de la URL con SAN, posición y apertura', () => {
		const line = parseLine('e2e4 c7c5 g1f3')
		expect(line.moves).toEqual([
			{ uci: 'e2e4', san: 'e4', ply: 1 },
			{ uci: 'c7c5', san: 'c5', ply: 2 },
			{ uci: 'g1f3', san: 'Nf3', ply: 3 }
		])
		expect(line.fen).toBe('rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2')
		expect(line.opening?.name).toMatch(/^Sicilian Defense/)
	})

	it('se queda con la parte legal', () => {
		expect(parseLine('e2e4 e7e5 e1e3 b8c6').moves).toHaveLength(2)
		expect(parseLine('basura').moves).toEqual([])
		expect(parseLine(null).moves).toEqual([])
	})

	it('acepta también comas, como las URLs de lichess', () => {
		expect(parseLine(' e2e4,c7c5  g1f3 ').moves.map((m) => m.san)).toEqual(['e4', 'c5', 'Nf3'])
	})

	it('acepta el enroque como rey→torre y lo devuelve en UCI estándar', () => {
		const italian = 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6'
		expect(parseLine(`${italian} e1h1`).moves.at(-1)).toEqual({ uci: 'e1g1', san: 'O-O', ply: 7 })
		expect(parseLine(`${italian} e1g1`).moves.at(-1)).toEqual({ uci: 'e1g1', san: 'O-O', ply: 7 })
	})

	it(`no pasa de ${OPENING_MOVES_PLIES} medias jugadas`, () => {
		const shuffle = Array.from({ length: 20 }, () => 'g1f3 g8f6 f3g1 f6g8').join(' ')
		expect(parseLine(shuffle).moves).toHaveLength(OPENING_MOVES_PLIES)
	})
})

describe('explore', () => {
	const games = [
		game(1, '1. e4 c5 2. Nf3 d6', '1-0', '2026-03-01'),
		game(2, '1. e4 c5 2. Nc3', '1/2-1/2', '2025-05-01'),
		game(3, '1. e4 e5 2. Nf3', '0-1', '2024-01-01'),
		game(4, '1. d4 Nf6 2. c4 e6 3. Nc3', '1-0', '2023-01-01'),
		game(5, '1. c4 e6 2. d4 Nf6 3. Nf3', '*', '2026-06-01')
	]

	it('cuenta las jugadas de la posición con el resultado del jugador', () => {
		const result = explore(games, start(), 'white')
		expect(result.total).toEqual({ games: 5, wins: 2, draws: 1, losses: 1, lastDate: '2026-06-01' })
		// Igualadas a partidas, primero la jugada más reciente.
		expect(result.moves.map((m) => [m.san, m.games])).toEqual([
			['e4', 3],
			['c4', 1],
			['d4', 1]
		])
		expect(result.moves[0]).toMatchObject({ uci: 'e2e4', wins: 1, draws: 1, losses: 1, lastDate: '2026-03-01' })
		expect(score(result.moves[0])).toBe(0.5)
		// La partida sin terminar cuenta como partida, pero no suma resultado.
		expect(result.moves[1]).toMatchObject({ san: 'c4', games: 1, wins: 0, draws: 0, losses: 0 })
		expect(score(result.moves[1])).toBeNull()
	})

	it('con negras, el resultado es el de las negras', () => {
		expect(explore(games, start(), 'black').total).toMatchObject({ wins: 1, draws: 1, losses: 2 })
	})

	it('da las partidas de la posición, de la más reciente a la más antigua, con la jugada en que llegan', () => {
		const result = explore(games, parseLine('e2e4 c7c5').position, 'white')
		expect(result.games).toEqual([
			{ id: 1, date: '2026-03-01', ply: 2 },
			{ id: 2, date: '2025-05-01', ply: 2 }
		])
		expect(result.moves.map((m) => m.san)).toEqual(['Nf3', 'Nc3'])
	})

	it('junta las transposiciones', () => {
		const result = explore(games, parseLine('d2d4 g8f6 c2c4 e7e6').position, 'white')
		expect(result.games.map((g) => [g.id, g.ply])).toEqual([
			[5, 4],
			[4, 4]
		])
		expect(result.moves.map((m) => [m.san, m.games])).toEqual([
			['Nf3', 1],
			['Nc3', 1]
		])
	})

	it('separa las partidas que acaban en la posición', () => {
		const result = explore(games, parseLine('e2e4 c7c5 b1c3').position, 'white')
		expect(result.moves).toEqual([])
		expect(result.ended).toMatchObject({ games: 1, draws: 1 })
	})

	it('no encuentra partidas en una posición a la que no llegan', () => {
		const result = explore(games, parseLine('a2a4').position, 'white')
		expect(result.total.games).toBe(0)
		expect(result.games).toEqual([])
	})

	it('encuentra posiciones con capturas y no da por acabada una partida que sigue tras el límite', () => {
		const long = parseGames(broadcastPgn).find((g) => g.plyCount > OPENING_MOVES_PLIES + 2)!
		const stored: RepertoireGame = { id: 9, date: '2026-01-01', result: '1-0', openingMoves: long.openingMoves! }
		const moves = stored.openingMoves.split(' ')
		expect(moves).toHaveLength(OPENING_MOVES_PLIES)

		const middle = explore([stored], parseLine(moves.slice(0, 30).join(' ')).position, 'white')
		expect(middle.games).toEqual([{ id: 9, date: '2026-01-01', ply: 30 }])
		expect(middle.moves.map((m) => m.uci)).toEqual([moves[30]])

		const atLimit = explore([stored], parseLine(moves.join(' ')).position, 'white')
		expect(atLimit.total.games).toBe(1)
		expect(atLimit.moves).toEqual([])
		expect(atLimit.ended).toBeNull()
	})
})
