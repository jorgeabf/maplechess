import { describe, expect, it } from 'vitest'
import { buildGameRows, type Participant } from '../../src/ingest/games'
import { parseGames } from '../../src/lib/chess/pgn'

const tournament = { name: 'Open de prueba', city: 'Xàbia', startDate: '2026-03-14', timeControl: '30 minutes + 30 seconds per move' }

function pgn(round: string, white: string, black: string, moves: string, result = '1-0', extra = ''): string {
	return `[Event "?"]\n[Round "${round}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n${extra}\n${moves} ${result}\n\n`
}

const rows = (text: string, participants: Participant[] = []) => buildGameRows(parseGames(text), participants, tournament)

describe('buildGameRows: partidas repetidas', () => {
	it('quita las copias idénticas', () => {
		const game = pgn('1.1', 'Ficticio, Javier', 'Irrealenko, Andrii', '1. e4 c5 2. Nf3')
		const result = rows(game + pgn('1.2', 'Torrens, Albert', 'Delord, Tristan', '1. d4 d5') + game)
		expect(result.map((r) => [r.round, r.board, r.seq])).toEqual([
			[1, 1, 0],
			[1, 2, 0]
		])
	})

	it('conserva partidas distintas con la misma ronda.tablero', () => {
		// Encuentros por equipos: cada uno numera sus tableros desde 1.
		const result = rows(pgn('1.1', 'A, Uno', 'B, Uno', '1. e4 e5') + pgn('1.1', 'C, Dos', 'D, Dos', '1. d4 d5'))
		expect(result.map((r) => [r.board, r.seq, r.whiteName])).toEqual([
			[1, 0, 'A, Uno'],
			[1, 1, 'C, Dos']
		])
	})

	it('reconoce la misma partida con y sin tablero, y sin gastar número de tablero', () => {
		const result = rows(
			pgn('2', 'Supuesto, Julio', 'Ensayo, Mikel', '1. e4 c5', '1/2-1/2') +
				pgn('2.1', 'Supuesto, Julio', 'Ensayo, Mikel', '1. e4 c5', '1/2-1/2') +
				pgn('2', 'Pruébez, Ana', 'Ejémplez, Eva', '1. c4 e5', '0-1')
		)
		expect(result.map((r) => [r.board, r.seq, r.whiteName])).toEqual([
			[1, 0, 'Supuesto, Julio'],
			[2, 0, 'Pruébez, Ana']
		])
	})

	it('de dos copias se queda la que tiene resultado y, si no, la más anotada', () => {
		const bare = pgn('3.1', 'A, Uno', 'B, Uno', '1. e4 e5', '*')
		const decided = pgn('3.1', 'A, Uno', 'B, Uno', '1. e4 e5', '1-0')
		const clocks = pgn('3.1', 'A, Uno', 'B, Uno', '1. e4 { [%clk 1:30:00] } e5 { [%clk 1:30:00] }', '1-0')
		expect(rows(bare + decided)[0].result).toBe('1-0')
		expect(rows(decided + bare)[0].result).toBe('1-0')
		const best = rows(decided + clocks + decided)
		expect(best).toHaveLength(1)
		expect(best[0].pgn).toContain('%clk')
	})
})

describe('buildGameRows: copias a medias', () => {
	const full = '1. e4 e6 2. d4 d5 3. e5 c5'

	it('junta una copia cortada con la completa, en el sitio de la primera', () => {
		const result = rows(
			pgn('2.1', 'Supuesto, Julio', 'Ensayo, Mikel', '1. e4 e6', '0-1') +
				pgn('2.2', 'Pruébez, Ana', 'Ejémplez, Eva', '1. c4 e5') +
				pgn('2.1', 'Supuesto, Julio', 'Ensayo, Mikel', full, '0-1')
		)
		expect(result.map((r) => [r.board, r.whiteName, r.plyCount])).toEqual([
			[1, 'Supuesto, Julio', 6],
			[2, 'Pruébez, Ana', 2]
		])
	})

	it('junta una copia sin jugadas con la completa', () => {
		const result = rows(
			pgn('3', 'Supuesto, Julio', 'Ensayo, Mikel', '', '1-0') + pgn('3', 'Supuesto, Julio', 'Ensayo, Mikel', full, '1-0')
		)
		expect(result).toHaveLength(1)
		expect(result[0]).toMatchObject({ board: 1, seq: 0, plyCount: 6, result: '1-0' })
	})

	it('se queda las jugadas de la completa y el resultado de la que lo tiene', () => {
		const [row] = rows(
			pgn('4.1', 'Supuesto, Julio', 'Ensayo, Mikel', full, '*') +
				pgn('4.1', 'Supuesto, Julio', 'Ensayo, Mikel', '1. e4 e6 2. d4', '1/2-1/2')
		)
		expect(row).toMatchObject({ plyCount: 6, result: '1/2-1/2' })
		expect(row.pgn).toContain('[Result "1/2-1/2"]')
		expect(row.pgn.trimEnd().endsWith('1/2-1/2')).toBe(true)
	})

	it('conserva dos partidas distintas entre los mismos jugadores en la misma ronda', () => {
		// Encuentros a doble vuelta o desempates: las jugadas divergen.
		const result = rows(
			pgn('5.1', 'Supuesto, Julio', 'Ensayo, Mikel', '1. e4 e6 2. d4', '1-0') +
				pgn('5.1', 'Supuesto, Julio', 'Ensayo, Mikel', '1. e4 c5', '0-1')
		)
		expect(result.map((r) => [r.board, r.seq, r.result])).toEqual([
			[1, 0, '1-0'],
			[1, 1, '0-1']
		])
	})
})

describe('buildGameRows: grabaciones fallidas', () => {
	it('descarta una partida sin terminar con otras jugadas si los mismos jugadores tienen una terminada', () => {
		// Campeonato de España Sub-8 2025: el tablero DGT recogió «1.d4 d5» antes de la partida real.
		const result = rows(
			pgn('4', 'Supuesto, Julio', 'Ensayo, Mikel', '1. d4 d5', '*') +
				pgn('4', 'Pruébez, Ana', 'Ejémplez, Eva', '1. c4 e5', '*') +
				pgn('4', 'Supuesto, Julio', 'Ensayo, Mikel', '1. e4 e5 2. Nf3 Nc6', '1/2-1/2')
		)
		// La grabación fallida no gasta número de tablero; la partida sin terminar de otra pareja se queda.
		expect(result.map((r) => [r.board, r.whiteName, r.result])).toEqual([
			[1, 'Pruébez, Ana', '*'],
			[2, 'Supuesto, Julio', '1/2-1/2']
		])
	})

	it('conserva las partidas sin terminar si los mismos jugadores no tienen ninguna terminada', () => {
		const result = rows(
			pgn('5.1', 'Supuesto, Julio', 'Ensayo, Mikel', '1. d4 d5', '*') +
				pgn('5.1', 'Supuesto, Julio', 'Ensayo, Mikel', '1. e4 e5', '*')
		)
		expect(result).toHaveLength(2)
	})
})

describe('buildGameRows: ELO', () => {
	it('descarta un ELO inverosímil de la cabecera y lo quita del PGN', () => {
		const [row] = rows(pgn('1.1', 'A, Uno', 'B, Uno', '1. e4 e5', '1-0', '[WhiteElo "118"]\n[BlackElo "1536"]'))
		expect(row.whiteElo).toBeNull()
		expect(row.blackElo).toBe(1536)
		expect(row.pgn).not.toContain('WhiteElo')
		expect(row.pgn).toContain('[BlackElo "1536"]')
	})

	it('si la cabecera no vale, usa el ELO del participante', () => {
		const participants = [{ name: 'A, Uno', fideId: 1, rating: 1800, title: null }]
		const [row] = rows(pgn('1.1', 'A, Uno', 'B, Uno', '1. e4 e5', '1-0', '[WhiteElo "4296"]'), participants)
		expect(row.whiteElo).toBe(1800)
		expect(row.pgn).toContain('[WhiteElo "1800"]')
	})
})
