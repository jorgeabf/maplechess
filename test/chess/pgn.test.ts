import { describe, expect, it } from 'vitest'
import { OPENING_MOVES_PLIES, parseGames, parsePgnDate, parseRound, writeGame } from '../../src/lib/chess/pgn'

const NAJDORF = `[Event "Prueba"]
[Site "?"]
[Date "2026.08.28"]
[Round "3.12"]
[White "Blancas, Uno"]
[Black "Negras, Dos"]
[Result "1/2-1/2"]

1. e4 {[%clk 0:03:00]} c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 $1 6. Be3 1/2-1/2
`

describe('parseRound', () => {
	it('lee "ronda.tablero"', () => {
		expect(parseRound('3.12')).toEqual({ round: 3, board: 12 })
	})

	it('usa la cabecera Board si existe', () => {
		expect(parseRound('5', '7')).toEqual({ round: 5, board: 7 })
	})

	it('ronda sin tablero', () => {
		expect(parseRound('5')).toEqual({ round: 5, board: null })
	})

	it('ronda desconocida', () => {
		expect(parseRound('?')).toEqual({ round: 0, board: null })
		expect(parseRound(undefined)).toEqual({ round: 0, board: null })
	})
})

describe('parsePgnDate', () => {
	it('convierte a ISO', () => {
		expect(parsePgnDate('2026.08.28')).toBe('2026-08-28')
	})

	it('descarta fechas incompletas', () => {
		expect(parsePgnDate('2026.??.??')).toBeNull()
		expect(parsePgnDate('2026.00.00')).toBeNull()
		expect(parsePgnDate(undefined)).toBeNull()
	})
})

describe('parseGames', () => {
	it('lee cabeceras, cuenta jugadas de la línea principal y nombra la apertura', () => {
		const [game] = parseGames(NAJDORF)
		expect(game).toMatchObject({
			round: 3,
			board: 12,
			date: '2026-08-28',
			white: 'Blancas, Uno',
			black: 'Negras, Dos',
			result: '1/2-1/2',
			plyCount: 11,
			opening: { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation, English Attack' }
		})
		expect(game.illegalAt).toBeUndefined()
	})

	it('nombra la apertura por posición aunque se llegue por transposición', () => {
		const [direct] = parseGames('1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 *')
		const [transposed] = parseGames('1. c4 e6 2. Nc3 Nf6 3. d4 Bb4 *')
		expect(transposed.opening).toEqual(direct.opening)
		expect(direct.opening?.eco).toBe('E20')
	})

	it('marca la primera jugada ilegal', () => {
		const [game] = parseGames('1. e4 e5 2. Ke3 *')
		expect(game.plyCount).toBe(2)
		expect(game.illegalAt).toBe(2)
	})

	it('guarda las primeras jugadas de la línea principal en UCI para el repertorio', () => {
		const [game] = parseGames(NAJDORF)
		expect(game.openingMoves).toBe('e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3')
		const [castle] = parseGames('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O *')
		expect(castle.openingMoves?.split(' ').at(-1)).toBe('e1g1')
	})

	it(`corta las jugadas guardadas en ${OPENING_MOVES_PLIES} medias jugadas y en la primera ilegal`, () => {
		const shuffle = Array.from({ length: 15 }, () => 'Nf3 Nf6 Ng1 Ng8').join(' ')
		const [long] = parseGames(`${shuffle} *`)
		expect(long.plyCount).toBe(60)
		expect(long.openingMoves?.split(' ')).toHaveLength(OPENING_MOVES_PLIES)
		expect(parseGames('1. e4 e5 2. Ke3 *')[0].openingMoves).toBe('e2e4 e7e5')
	})

	it('deja fuera del repertorio las partidas sin jugadas o desde un FEN', () => {
		expect(parseGames('[Event "Sin jugadas"]\n[Result "*"]\n\n*')[0].openingMoves).toBeNull()
		const fromFen = '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd7 *'
		expect(parseGames(fromFen)[0]).toMatchObject({ plyCount: 2, openingMoves: null })
	})

	it('trata como normal una partida con la cabecera FEN de la posición inicial', () => {
		const initial = '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 c5 *'
		expect(parseGames(initial)[0]).toMatchObject({ openingMoves: 'e2e4 c7c5', opening: { eco: 'B20' } })
	})

	it('guarda los relojes de cada media jugada, con un guion donde falta', () => {
		const pgn = '1. e4 { [%clk 1:30:57] } e5 { [%clk 1:30:53] } 2. Nf3 { comentario } Nc6 {[%clk 0:00:59]} *'
		expect(parseGames(pgn)[0].clocks).toBe('5457 5453 - 59')
		expect(parseGames('1. e4 e5 *')[0].clocks).toBeNull()
		// Como las jugadas, se cortan en la primera ilegal.
		expect(parseGames('1. e4 { [%clk 0:03:00] } e5 { [%clk 0:03:00] } 2. Ke3 { [%clk 0:02:59] } *')[0].clocks).toBe('180 180')
	})

	it('lee varias partidas', () => {
		expect(parseGames(`${NAJDORF}\n${NAJDORF}`)).toHaveLength(2)
	})
})

describe('writeGame', () => {
	it('añade cabeceras y conserva variantes, comentarios y NAG', () => {
		const [game] = parseGames(NAJDORF)
		const pgn = writeGame(game.game, { WhiteElo: 2500, BlackElo: undefined, ECO: 'B90', Opening: '' })
		expect(pgn).toContain('[WhiteElo "2500"]')
		expect(pgn).toContain('[ECO "B90"]')
		expect(pgn).not.toContain('BlackElo')
		expect(pgn).not.toContain('Opening')
		expect(pgn).toContain('( 2... Nc6 3. d4 )')
		expect(pgn).toContain('[%clk 0:03:00]')
		expect(pgn).toContain('$1')
		// Vuelve a leerse igual.
		expect(parseGames(pgn)[0].plyCount).toBe(11)
	})
})
