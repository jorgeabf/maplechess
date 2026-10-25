import type { APIContext, APIRoute } from 'astro'
import { parsePgn } from 'chessops/pgn'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildGameRows } from '../src/ingest/games'
import { parseGamesPage, parseTournamentPage } from '../src/ingest/info64/parse'
import { loadParticipants, replaceParticipations, saveGames, upsertTournament } from '../src/ingest/repo'
import { parseGames } from '../src/lib/chess/pgn'
import { LICHESS_NOTICE } from '../src/lib/licenses'
import { GET as playerPgn } from '../src/pages/jugadores/[fideId].pgn'
import { GET as repertoirePgn } from '../src/pages/jugadores/[fideId]/repertorio.pgn'
import { GET as searchPgn } from '../src/pages/partidas.pgn'
import { GET as gamePgn } from '../src/pages/partidas/[id].pgn'
import { GET as tournamentPgn } from '../src/pages/torneos/[id].pgn'
import gamesHtml from './fixtures/info64/games.html?raw'
import tournamentHtml from './fixtures/info64/tournament.html?raw'
import broadcastPgn from './fixtures/lichess/broadcast.pgn?raw'

// Las cinco descargas PGN, con tres torneos: uno propio de lichess, uno de
// info64 con las partidas de su retransmisión de lichess y uno de info64 con
// las suyas. El aviso de licencia va en las de los dos primeros, y sólo en
// ellas.
const db = env.DB
const NOW = '2026-10-24T00:00:00.000Z'

const LICHESS = {
	source: 'lichess',
	key: 'zK5CoVvF',
	type: 'individual' as const,
	name: 'Open Inventado de Albacete',
	city: 'Albacete',
	startDate: '2026-09-24',
	endDate: '2026-09-25',
	timeControl: '60+30',
	url: 'https://lichess.org/broadcast/open-inventado/zK5CoVvF',
	syncedAt: NOW
}
const LINKED = { ...LICHESS, source: 'info64', key: 'open-inventado', name: 'Open Inventado (info64)', url: 'https://info64.org/open-inventado' }
const INFO64 = {
	source: 'info64',
	key: 'odiseo-chess-masters',
	type: 'individual' as const,
	name: 'I Blitz Odiseo Chess Masters',
	city: 'Murcia',
	startDate: '2026-08-28',
	endDate: '2026-08-28',
	timeControl: '3+2',
	url: 'https://info64.org/odiseo-chess-masters',
	syncedAt: NOW
}
/** Juega con blancas la primera partida de la retransmisión. */
const LICHESS_PLAYER = 97648458

const FROM_LICHESS = new Set([LICHESS.name, LINKED.name])
const ids = { lichess: 0, linked: 0, info64: 0, info64Player: 0 }

beforeAll(async () => {
	await db.batch([
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM players')
	])
	for (const [key, tournament] of [
		['lichess', LICHESS],
		['linked', LINKED]
	] as const) {
		ids[key] = await upsertTournament(db, tournament)
		const rows = buildGameRows(parseGames(broadcastPgn), [], tournament)
		await saveGames(db, ids[key], rows, NOW, { name: 'lichess', url: LICHESS.url })
	}

	ids.info64 = await upsertTournament(db, INFO64)
	await replaceParticipations(db, ids.info64, (await parseTournamentPage(tournamentHtml)).players)
	const rows = buildGameRows(parseGames((await parseGamesPage(gamesHtml))!), await loadParticipants(db, ids.info64), INFO64)
	await saveGames(db, ids.info64, rows, NOW, { name: 'info64', url: null })

	ids.info64Player = (await db
		.prepare('SELECT white_fide_id AS id FROM games WHERE tournament_id = ?1 AND white_fide_id IS NOT NULL LIMIT 1')
		.bind(ids.info64)
		.first<{ id: number }>())!.id
	await db.batch(
		[LICHESS_PLAYER, ids.info64Player].map((fideId) =>
			db.prepare("INSERT INTO players (fide_id, name, seen_at) VALUES (?1, 'Supuesto Irreal, Otro', ?2)").bind(fideId, NOW)
		)
	)
})

async function download(route: APIRoute, path: string, params: Record<string, string> = {}): Promise<string> {
	const response = await route({ params, url: new URL(path, 'https://maplechess.test') } as unknown as APIContext)
	expect(response.status).toBe(200)
	// Con text(), workerd avisa de que el Content-Type no es de texto.
	return new TextDecoder().decode(await response.arrayBuffer())
}

/**
 * Cuántas partidas de la descarga son de lichess y cuántas no, comprobando
 * que el aviso va, una vez, en las de lichess (por su torneo, el Event) y en
 * ninguna otra.
 */
function notices(pgnText: string): { lichess: number; others: number } {
	const games = parsePgn(pgnText)
	const lichess = games.filter((g) => FROM_LICHESS.has(g.headers.get('Event') ?? '')).length
	for (const game of games) {
		const notice = (game.comments ?? []).map((c) => c.trim()).includes(LICHESS_NOTICE)
		expect(notice).toBe(FROM_LICHESS.has(game.headers.get('Event') ?? ''))
	}
	expect(pgnText.split(LICHESS_NOTICE).length - 1).toBe(lichess)
	return { lichess, others: games.length - lichess }
}

describe('aviso de licencia en las descargas PGN', () => {
	it('/partidas/{id}.pgn', async () => {
		for (const [tournamentId, expected] of [
			[ids.lichess, { lichess: 1, others: 0 }],
			[ids.linked, { lichess: 1, others: 0 }],
			[ids.info64, { lichess: 0, others: 1 }]
		] as const) {
			const game = await db.prepare('SELECT id FROM games WHERE tournament_id = ?1 LIMIT 1').bind(tournamentId).first<{ id: number }>()
			expect(notices(await download(gamePgn, `/partidas/${game!.id}.pgn`, { id: String(game!.id) }))).toEqual(expected)
		}
	})

	it('/torneos/{id}.pgn', async () => {
		const torneo = (id: number) => download(tournamentPgn, `/torneos/${id}.pgn`, { id: String(id) })
		expect(notices(await torneo(ids.lichess))).toEqual({ lichess: 6, others: 0 })
		expect(notices(await torneo(ids.linked))).toEqual({ lichess: 6, others: 0 })
		const info64 = notices(await torneo(ids.info64))
		expect(info64.lichess).toBe(0)
		expect(info64.others).toBeGreaterThan(0)
	})

	it('/jugadores/{id}.pgn', async () => {
		const jugador = (id: number) => download(playerPgn, `/jugadores/${id}.pgn`, { fideId: String(id) })
		expect(notices(await jugador(LICHESS_PLAYER))).toEqual({ lichess: 2, others: 0 })
		const info64 = notices(await jugador(ids.info64Player))
		expect(info64.lichess).toBe(0)
		expect(info64.others).toBeGreaterThan(0)
	})

	it('/jugadores/{id}.pgn?torneo=, sólo las suyas de ese torneo', async () => {
		const pgn = await download(playerPgn, `/jugadores/${LICHESS_PLAYER}.pgn?torneo=${ids.lichess}`, {
			fideId: String(LICHESS_PLAYER)
		})
		expect(notices(pgn)).toEqual({ lichess: 1, others: 0 })
		expect(parsePgn(pgn)[0].headers.get('Event')).toBe(LICHESS.name)
	})

	it('/partidas.pgn', async () => {
		const all = notices(await download(searchPgn, '/partidas.pgn?desde=2000-01-01'))
		expect(all.lichess).toBe(12)
		expect(all.others).toBeGreaterThan(0)
	})

	it('/jugadores/{id}/repertorio.pgn', async () => {
		const repertorio = (id: number) =>
			download(repertoirePgn, `/jugadores/${id}/repertorio.pgn?color=white`, { fideId: String(id) })
		expect(notices(await repertorio(LICHESS_PLAYER))).toEqual({ lichess: 2, others: 0 })
		const info64 = notices(await repertorio(ids.info64Player))
		expect(info64.lichess).toBe(0)
		expect(info64.others).toBeGreaterThan(0)
	})
})
