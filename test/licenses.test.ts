import { parsePgn } from 'chessops/pgn'
import { describe, expect, it } from 'vitest'
import { buildGameRows } from '../src/ingest/games'
import { parseGamesPage } from '../src/ingest/info64/parse'
import { parseGames } from '../src/lib/chess/pgn'
import { LICHESS_NOTICE, licensedPgn, lichessUrl } from '../src/lib/licenses'
import gamesHtml from './fixtures/info64/games.html?raw'
import broadcastPgn from './fixtures/lichess/broadcast.pgn?raw'

const CONTEXT = { name: 'Open Inventado', city: 'Albacete', startDate: '2026-09-24', timeControl: '60+30' }

/** Los PGN tal como los guarda la ingesta. */
const stored = (pgnText: string) => buildGameRows(parseGames(pgnText), [], CONTEXT).map((r) => r.pgn)

const read = (pgn: string) => parsePgn(pgn)[0]
const rootComments = (pgn: string) => (read(pgn).comments ?? []).map((c) => c.trim())
const mainline = (pgn: string) => [...read(pgn).moves.mainline()].map((n) => n.san)

const SITE_ONLY = `[Event "CE Inventado"]
[Site "https://lichess.org/broadcast/ce-inventado/round-1/AbCdEfGh/IjKlMnOp"]
[Round "1.1"]
[White "Supuesto Irreal, Otro"]
[Black "Inventado Falso, Uno"]
[Result "0-1"]

1. d4 { [%eval 0.17] [%clk 1:30:57] } Nf6 { [%eval 0.19] [%clk 1:30:44] } 0-1`

describe('lichessUrl', () => {
	it('da la dirección de la partida de las de lichess', () => {
		const [pgn] = stored(broadcastPgn)
		expect(lichessUrl(pgn)).toBe(read(pgn).headers.get('GameURL'))
		expect(lichessUrl(pgn)).toMatch(/^https:\/\/lichess\.org\/broadcast\//)
	})

	it('sin GameURL, la de Site y, si no, la de la ronda', () => {
		const [pgn] = stored(SITE_ONLY)
		expect(lichessUrl(pgn)).toBe('https://lichess.org/broadcast/ce-inventado/round-1/AbCdEfGh/IjKlMnOp')
		const [round] = stored(
			'[Site "Albacete"]\n[BroadcastURL "https://lichess.org/broadcast/ce-inventado/round-1/AbCdEfGh"]\n\n1. e4 *'
		)
		expect(lichessUrl(round)).toBe('https://lichess.org/broadcast/ce-inventado/round-1/AbCdEfGh')
	})

	it('null en las de info64', async () => {
		for (const pgn of stored((await parseGamesPage(gamesHtml))!)) expect(lichessUrl(pgn)).toBeNull()
	})

	it('no cuenta una dirección de otro sitio en esas cabeceras', () => {
		const [pgn] = stored('[Site "https://lichess.org.example.com/x"]\n[GameURL "https://example.com/lichess.org/"]\n\n1. e4 *')
		expect(lichessUrl(pgn)).toBeNull()
	})
})

describe('licensedPgn', () => {
	it('pone el aviso antes de la primera jugada de las partidas de lichess, sin tocar lo demás', () => {
		const pgns = stored(broadcastPgn)
		expect(pgns).toHaveLength(6)
		for (const pgn of pgns) {
			const licensed = licensedPgn(pgn)
			expect(rootComments(licensed)).toEqual([LICHESS_NOTICE])
			expect(read(licensed).headers).toEqual(read(pgn).headers)
			expect(mainline(licensed)).toEqual(mainline(pgn))
			expect(licensed.replace(`{ ${LICHESS_NOTICE} } `, '')).toBe(pgn)
		}
	})

	it('no lo pone en las de info64', async () => {
		const pgns = stored((await parseGamesPage(gamesHtml))!)
		expect(pgns.length).toBeGreaterThan(0)
		for (const pgn of pgns) expect(licensedPgn(pgn)).toBe(pgn)
	})

	it('lo pone en las que info64 publica tal como salen de lichess, que sólo traen su Site', () => {
		const [pgn] = stored(SITE_ONLY)
		expect(rootComments(licensedPgn(pgn))).toEqual([LICHESS_NOTICE])
	})

	it('mira sólo la dirección de la partida en las cabeceras, no los comentarios ni otras cabeceras', () => {
		const [pgn] = stored(`[Site "Albacete"]
[Annotator "https://lichess.org/@/inventado"]
[White "Supuesto Irreal, Otro"]
[Black "Inventado Falso, Uno"]
[Result "*"]

1. e4 { https://lichess.org/broadcast/ce-inventado/round-1/AbCdEfGh } e5 *`)
		expect(licensedPgn(pgn)).toBe(pgn)
	})

	it('también en una partida sin jugadas', () => {
		const [pgn] = stored(`[Site "https://lichess.org/broadcast/ce-inventado/round-1/AbCdEfGh/IjKlMnOp"]
[White "Supuesto Irreal, Otro"]
[Black "Inventado Falso, Uno"]
[Result "1-0"]

1-0`)
		const licensed = licensedPgn(pgn)
		expect(rootComments(licensed)).toEqual([LICHESS_NOTICE])
		expect(mainline(licensed)).toEqual([])
		expect(read(licensed).headers.get('Result')).toBe('1-0')
	})
})
