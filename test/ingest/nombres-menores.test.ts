import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import { Info64SyncWorkflow, type Info64SyncParams } from '../../src/ingest/info64/sync'
import { publicName, publicPgnNames } from '../../src/ingest/nombres'
import { replacePairings, replaceParticipations, saveGames, upsertTournament } from '../../src/ingest/repo'
import { renameStoredPairings, renameStoredParticipations, reprocessGames } from '../../src/ingest/reprocess'
import { parseGames } from '../../src/lib/chess/pgn'
import { madridYear } from '../../src/lib/dates'

// Nombres inventados. Los menores se calculan desde el año actual para que el
// test no caduque.
const db = env.DB
const year = madridYear(new Date())
const minor = year - 10
const otherMinor = year - 12
const adult = 1980

describe('publicName', () => {
	it('quita el año a los homónimos que pueden ser menores, con o sin letra detrás', () => {
		expect(publicName('Inventado Ficticio, Nombre 2011', 2026)).toBe('Inventado Ficticio, Nombre')
		expect(publicName('Inventado Ficticio, Nombre 2008 I', 2026)).toBe('Inventado Ficticio, Nombre')
		expect(publicName('Inventado Ficticio, 2010', 2026)).toBe('Inventado Ficticio')
	})

	it('lo conserva en los adultos, también en quien deja de ser menor', () => {
		expect(publicName('Inventado Ficticio, Nombre 1980', 2026)).toBe('Inventado Ficticio, Nombre 1980')
		expect(publicName('Inventado Ficticio, Nombre 2008', 2027)).toBe('Inventado Ficticio, Nombre 2008')
	})

	it('no toca los nombres sin año de homónimo', () => {
		for (const name of ['Inventado Ficticio, Nombre', 'Nombre Inventado', 'Club 2011, Equipo B', '']) {
			expect(publicName(name, 2026)).toBe(name)
		}
	})
})

describe('publicPgnNames', () => {
	it('sólo cambia las cabeceras White y Black de los menores, y deja el resto igual', () => {
		const pgn = [
			'[Event "Open 2011"]',
			'[White "Inventado Ficticio, Nombre 2011"]',
			'[Black "Supuesto \\"Alias\\", Otro 2012 II"]',
			'[WhiteElo "1500"]',
			'',
			'1. e4 { [%clk 1:30:00] Una nota de 2011 } e5 1-0',
			''
		].join('\n')
		const expected = pgn
			.replace('[White "Inventado Ficticio, Nombre 2011"]', '[White "Inventado Ficticio, Nombre"]')
			.replace('[Black "Supuesto \\"Alias\\", Otro 2012 II"]', '[Black "Supuesto \\"Alias\\", Otro"]')
		expect(publicPgnNames(pgn, 2026)).toBe(expected)
		expect(publicPgnNames(expected, 2026)).toBe(expected)
		const adults = pgn.replaceAll('2011"]', '1971"]').replace('2012 II', '1972 II')
		expect(publicPgnNames(adults, 2026)).toBe(adults)
	})
})

const tournament = {
	source: 'info64',
	key: 'torneo-inventado',
	type: 'individual' as const,
	name: 'Torneo inventado',
	city: 'Ninguna',
	startDate: '2026-09-01',
	endDate: '2026-09-02',
	timeControl: '90+30',
	url: 'https://info64.org/torneo-inventado',
	syncedAt: '2026-10-01T00:00:00.000Z'
}

const player = (startRank: number, name: string, fideId: number): TournamentPlayer => ({
	startRank,
	team: null,
	title: null,
	name,
	fed: 'ESP',
	rating: 1500 + startRank,
	fideId
})

// Dos homónimos menores, a los que sólo distingue el año, un adulto homónimo
// y un rival sin año.
const players = [
	player(1, `Inventado Ficticio, Nombre ${minor}`, 900001),
	player(2, `Inventado Ficticio, Nombre ${otherMinor}`, 900002),
	player(3, `Supuesto Irreal, Otro ${adult}`, 900003),
	player(4, 'Rival Cualquiera, Alguien', 900004)
]

/** Partida como la publica info64: los nombres del ranking, sin FIDE ID. */
const game = (board: number, white: string, black: string) =>
	`[Event "Torneo inventado"]\n[Round "1.${board}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0\n`

const pgn = [game(1, players[0].name, players[3].name), game(2, players[2].name, players[1].name)].join('\n')

const names = async (sql: string) => (await db.prepare(sql).all<Record<string, unknown>>()).results

describe('nombres de los menores en la ingesta', () => {
	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM pairings'),
			db.prepare('DELETE FROM games'),
			db.prepare('DELETE FROM participations'),
			db.prepare('DELETE FROM tournaments')
		])
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('la pasada de info64 cruza las partidas con el ranking de la fuente, no con lo guardado', async () => {
		// Las páginas de info64, con lo justo para sus parsers.
		const cell = (cls: string, text: string | number) => `<td class="${cls}">${text}</td>`
		const ranking = players
			.map(
				(p) =>
					`<tr>${cell('playerstartrank', p.startRank)}${cell('playertitle', '')}${cell('playername', p.name)}` +
					`${cell('playerfederation', 'ESP')}${cell('playerfiderat', p.rating!)}${cell('playerfideratid', p.fideId!)}</tr>`
			)
			.join('')
		const pages: Record<string, string> = {
			'https://info64.org/torneo-inventado': `<h1>Torneo inventado</h1><table id="initial-ranking-table"><tbody>${ranking}</tbody></table>`,
			'https://info64.org/torneo-inventado/games': `<textarea id="pgnText">${pgn}</textarea>`
		}
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const page = pages[String(input instanceof Request ? input.url : input)]
			return page ? new Response(page) : new Response('no encontrado', { status: 404 })
		})
		// Pasos de verdad, sin Workflow: cada uno se ejecuta y su salida pasa por
		// JSON, como la guarda Workflows.
		const step = {
			do: async (_name: string, ...rest: unknown[]) =>
				JSON.parse(JSON.stringify((await (rest.at(-1) as () => Promise<unknown>)()) ?? null)),
			sleep: async () => {}
		} as unknown as WorkflowStep
		const event = { payload: { from: '', to: '', keys: ['torneo-inventado'] } } as WorkflowEvent<Info64SyncParams>
		const workflow: Info64SyncWorkflow = Object.assign(Object.create(Info64SyncWorkflow.prototype), { env })

		await workflow.run(event, step)

		expect(await names('SELECT white_name AS w, black_name AS b, white_fide_id AS wid, black_fide_id AS bid FROM games ORDER BY board')).toEqual([
			{ w: 'Inventado Ficticio, Nombre', b: 'Rival Cualquiera, Alguien', wid: 900001, bid: 900004 },
			{ w: `Supuesto Irreal, Otro ${adult}`, b: 'Inventado Ficticio, Nombre', wid: 900003, bid: 900002 }
		])
		expect(await names('SELECT name FROM participations ORDER BY start_rank')).toEqual([
			{ name: 'Inventado Ficticio, Nombre' },
			{ name: 'Inventado Ficticio, Nombre' },
			{ name: `Supuesto Irreal, Otro ${adult}` },
			{ name: 'Rival Cualquiera, Alguien' }
		])
	})

	it('cruza con el nombre completo y guarda sin el año de los menores', async () => {
		const id = await upsertTournament(db, tournament)
		await replaceParticipations(db, id, players)
		// Las partidas se cruzan con los participantes de la fuente, sin sanear
		// (como hace info64/sync.ts), no con los guardados.
		const rows = buildGameRows(parseGames(pgn), players, tournament)
		await saveGames(db, id, rows, '2026-10-01T00:00:00.000Z', { name: 'info64', url: null })

		expect(await names('SELECT name, name_norm AS norm FROM participations ORDER BY start_rank')).toEqual([
			{ name: 'Inventado Ficticio, Nombre', norm: 'inventado ficticio, nombre' },
			{ name: 'Inventado Ficticio, Nombre', norm: 'inventado ficticio, nombre' },
			{ name: `Supuesto Irreal, Otro ${adult}`, norm: `supuesto irreal, otro ${adult}` },
			{ name: 'Rival Cualquiera, Alguien', norm: 'rival cualquiera, alguien' }
		])
		const games = await names(
			'SELECT white_name AS w, black_name AS b, white_fide_id AS wid, black_fide_id AS bid, pgn FROM games ORDER BY board'
		)
		// Cada homónimo menor, con su FIDE ID.
		expect(games.map(({ w, b, wid, bid }) => ({ w, b, wid, bid }))).toEqual([
			{ w: 'Inventado Ficticio, Nombre', b: 'Rival Cualquiera, Alguien', wid: 900001, bid: 900004 },
			{ w: `Supuesto Irreal, Otro ${adult}`, b: 'Inventado Ficticio, Nombre', wid: 900003, bid: 900002 }
		])
		expect(games[0].pgn).toContain('[White "Inventado Ficticio, Nombre"]')
		expect(games[1].pgn).toContain(`[White "Supuesto Irreal, Otro ${adult}"]`)
		expect(games.some((g) => String(g.pgn).includes(String(minor)) || String(g.pgn).includes(String(otherMinor)))).toBe(false)
	})

	it('los emparejamientos tampoco guardan el año, ni el del participante ni el de la página', async () => {
		const id = await upsertTournament(db, tournament)
		await replaceParticipations(db, id, players)
		const side = (startRank: number, name: string) => ({ startRank, name, rating: null })
		await replacePairings(db, id, 2, '2026-09-02 10:00', [
			{ board: 1, white: side(2, 'ignorado'), black: side(1, 'ignorado') },
			// Un número que no está en el ranking: se queda el nombre de la página.
			{ board: 2, white: side(9, `Desconocido Total, Uno ${minor}`), black: side(3, 'ignorado') }
		])
		expect(await names('SELECT white_name AS w, black_name AS b FROM pairings ORDER BY board')).toEqual([
			{ w: 'Inventado Ficticio, Nombre', b: 'Inventado Ficticio, Nombre' },
			{ w: 'Desconocido Total, Uno', b: `Supuesto Irreal, Otro ${adult}` }
		])
	})

	it('el reprocesado limpia lo guardado antes: columnas, cabeceras, participantes y emparejamientos', async () => {
		const id = await upsertTournament(db, tournament)
		const rows = buildGameRows(parseGames(pgn), players, tournament)
		await saveGames(db, id, rows, '2026-10-01T00:00:00.000Z', { name: 'info64', url: null })
		const clean = await names('SELECT id, white_name, black_name, pgn FROM games ORDER BY id')
		// Lo que había antes de la regla: los nombres con el año en todas partes.
		await db.batch([
			db.prepare(`UPDATE games SET white_name = ?1, pgn = replace(pgn, '[White "Inventado Ficticio, Nombre"]', ?2) WHERE board = 1`)
				.bind(players[0].name, `[White "${players[0].name}"]`),
			db.prepare(`UPDATE games SET black_name = ?1, pgn = replace(pgn, '[Black "Inventado Ficticio, Nombre"]', ?2) WHERE board = 2`)
				.bind(players[1].name, `[Black "${players[1].name}"]`),
			db.prepare(
				`INSERT INTO participations (tournament_id, team, start_rank, name, name_norm, fide_id) VALUES
					(?1, '', 1, ?2, ?3, 900001), (?1, '', 3, ?4, ?5, 900003)`
			).bind(id, players[0].name, players[0].name.toLowerCase(), players[2].name, players[2].name.toLowerCase()),
			db.prepare(
				`INSERT INTO pairings (tournament_id, round, board, starts_at, white_rank, white_name, black_rank, black_name)
					VALUES (?1, 2, 1, '2026-09-02 10:00', 2, ?2, 3, ?3)`
			).bind(id, players[1].name, players[2].name)
		])
		expect((await names('SELECT pgn FROM games')).some((g) => String(g.pgn).includes(String(minor)))).toBe(true)

		expect(await reprocessGames(db, 0)).toMatchObject({ games: 2, renamed: 2 })
		expect(await names('SELECT id, white_name, black_name, pgn FROM games ORDER BY id')).toEqual(clean)
		expect(await renameStoredParticipations(db)).toBe(1)
		expect(await names('SELECT name, name_norm AS norm FROM participations ORDER BY start_rank')).toEqual([
			{ name: 'Inventado Ficticio, Nombre', norm: 'inventado ficticio, nombre' },
			{ name: players[2].name, norm: players[2].name.toLowerCase() }
		])
		expect(await renameStoredPairings(db)).toBe(1)
		expect(await names('SELECT white_name AS w, black_name AS b FROM pairings')).toEqual([
			{ w: 'Inventado Ficticio, Nombre', b: players[2].name }
		])

		// El índice FTS sigue a las columnas: ya no se encuentra por el año.
		const byYear = await db
			.prepare(`SELECT count(*) AS n FROM games_fts WHERE games_fts MATCH ?1`)
			.bind(`"${minor}"*`)
			.first<{ n: number }>()
		expect(byYear?.n).toBe(0)

		// Repetirlo no reescribe nada.
		expect(await reprocessGames(db, 0)).toMatchObject({ games: 2, renamed: 0 })
		expect(await renameStoredParticipations(db)).toBe(0)
		expect(await renameStoredPairings(db)).toBe(0)
	})
})
