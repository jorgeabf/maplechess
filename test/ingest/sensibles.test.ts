import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import { Info64SyncWorkflow, type Info64SyncParams } from '../../src/ingest/info64/sync'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import {
	replacePairings,
	replaceParticipations,
	saveGames,
	saveLichessTour,
	upsertTournament,
	type TournamentInput
} from '../../src/ingest/repo'
import { applySensitive } from '../../src/ingest/reprocess'
import { looksSensitive } from '../../src/ingest/sensibles'
import { parseGames } from '../../src/lib/chess/pgn'
import { addDays, madridDateTime } from '../../src/lib/dates'
import { getPlayerTournaments } from '../../src/lib/db/players'

// Torneos que revelan un dato de salud (tabla torneos_sensibles): no se
// guardan. Torneos y jugadores inventados.
const db = env.DB

const count = async (sql: string, ...params: unknown[]) =>
	(await db
		.prepare(sql)
		.bind(...params)
		.first<{ n: number }>())!.n

const mark = (source: string, key: string, excluido: number | null) =>
	db
		.prepare(
			`INSERT INTO torneos_sensibles (source, source_key, nombre, excluido, creado) VALUES (?1, ?2, 'Torneo inventado', ?3, '2026-10-23')
			ON CONFLICT (source, source_key) DO UPDATE SET excluido = excluded.excluido`
		)
		.bind(source, key, excluido)
		.run()

const proposed = async () =>
	(
		await db
			.prepare('SELECT source, source_key AS key, nombre, excluido FROM torneos_sensibles ORDER BY source, source_key')
			.all()
	).results

const clean = () =>
	db.batch([
		db.prepare('DELETE FROM lichess_tours'),
		db.prepare('DELETE FROM standings'),
		db.prepare('DELETE FROM pairings'),
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM torneos_sensibles')
	])

describe('looksSensitive', () => {
	it('reconoce a los organizadores, a quienes juegan y los torneos inclusivos o adaptados', () => {
		for (const name of [
			'Campeonato de España FEDS Ajedrez Activo para Sordos 2030',
			'Clasificatorio Campeonato de España 2030 - ONCE MADRID',
			'XL Open FEDC',
			'Torneo para ciegos y deficientes visuales',
			'III Campeonato de España Individual de Ajedrez Inclusivo',
			'Jornadas por la Inclusión de Ninguna Parte',
			'25th ICCD World Individual Blitz Chess Championship - Women',
			'1st World Deaf Team Rapid Chess Championship',
			'9 IPCA Europe Individual Rapid Chess Championship',
			'Open for Disabled Players',
			'Torneig per a cecs',
			'Ajedrez adaptado en silla de ruedas',
			'Blitz Solidario Síndrome de Asperger',
			'Torneo en el Centro Penitenciario de Ninguna Parte',
			'Simultáneas a la ciega para ciegos'
		]) {
			expect(looksSensitive(name), name).toBe(true)
		}
	})

	it('no cuenta «a la ciega», que es jugar sin ver el tablero', () => {
		for (const name of [
			'II Desafío a la Ciega de Ninguna Parte',
			'I Desafiament a la Cega / I Desafío a la Ciega',
			'XXX Torneo a la ciega Inventado'
		]) {
			expect(looksSensitive(name), name).toBe(false)
		}
	})

	it('no confunde el número once ni los nombres de sitios o de colegios', () => {
		for (const name of [
			'Torneo de las once de la noche',
			'XI Open Internacional Ciudad de Inventada',
			'Open de L’Hospitalet Inventado',
			'Torneo Escolar CEIP Cristo de la Salud',
			'I Torneo Jaque al Alzheimer',
			'World Team Chess Championship'
		]) {
			expect(looksSensitive(name), name).toBe(false)
		}
	})
})

describe('torneos sensibles en la pasada de info64', () => {
	const SENSITIVE = 'campeonato-sordos-inventado'
	const OTHER = 'open-inventado'
	const tomorrow = addDays(madridDateTime(new Date()).slice(0, 10), 1)
	let requested: string[] = []

	const cell = (cls: string, text: string | number) => `<td class="${cls}">${text}</td>`
	const ranking = (prefix: string) =>
		[1, 2]
			.map(
				(rank) =>
					`<tr>${cell('playerstartrank', rank)}${cell('playertitle', '')}${cell('playername', `${prefix} Inventado, Jugador ${rank}`)}` +
					`${cell('playerfederation', 'ESP')}${cell('playerfiderat', 1800 + rank)}${cell('playerfideratid', 930100 + rank)}</tr>`
			)
			.join('')
	const pgn = (prefix: string) =>
		`[Event "Torneo"]\n[Round "1.1"]\n[White "${prefix} Inventado, Jugador 1"]\n[Black "${prefix} Inventado, Jugador 2"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`
	const pages: Record<string, string> = {
		// Del primero, una ronda jugada y la siguiente, mañana.
		'events.json': JSON.stringify([
			{ title: 'R.1 - Campeonato Inventado para Sordos', url: `/${SENSITIVE}/`, start: '2026-09-01T17:00:00' },
			{ title: 'R.2 - Campeonato Inventado para Sordos', url: `/${SENSITIVE}/`, start: `${tomorrow}T17:00:00` },
			{ title: 'R.1 - Open Inventado', url: `/${OTHER}/`, start: '2026-09-01T17:00:00' }
		]),
		[SENSITIVE]: `<h1>Campeonato Inventado para Sordos</h1><table id="initial-ranking-table"><tbody>${ranking('Sordo')}</tbody></table>`,
		[`${SENSITIVE}/games`]: `<textarea id="pgnText">${pgn('Sordo')}</textarea>`,
		[OTHER]: `<h1>Open Inventado</h1><table id="initial-ranking-table"><tbody>${ranking('Abierto')}</tbody></table>`,
		[`${OTHER}/games`]: `<textarea id="pgnText">${pgn('Abierto')}</textarea>`
	}

	// Pasos de verdad, sin Workflow: cada uno se ejecuta y su salida pasa por JSON.
	const step = {
		do: async (_name: string, ...rest: unknown[]) =>
			JSON.parse(JSON.stringify((await (rest.at(-1) as () => Promise<unknown>)()) ?? null)),
		sleep: async () => {}
	} as unknown as WorkflowStep
	const run = (payload: Info64SyncParams) =>
		(Object.assign(Object.create(Info64SyncWorkflow.prototype), { env }) as Info64SyncWorkflow).run(
			{ payload } as WorkflowEvent<Info64SyncParams>,
			step
		)
	const window: Info64SyncParams = { from: '2026-08-01', to: '2026-10-01' }

	beforeEach(async () => {
		await clean()
		requested = []
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const path = new URL(String(input instanceof Request ? input.url : input)).pathname.replace(/^\//, '')
			requested.push(path)
			const page = pages[path]
			return page === undefined ? new Response('no encontrado', { status: 404 }) : new Response(page)
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('apunta para revisarlo el que lo parece y, mientras, lo guarda como los demás', async () => {
		await run(window)
		expect(await count('SELECT count(*) AS n FROM tournaments')).toBe(2)
		expect(await count('SELECT count(*) AS n FROM games')).toBe(2)
		expect(await proposed()).toEqual([
			{ source: 'info64', key: SENSITIVE, nombre: 'Campeonato Inventado para Sordos', excluido: null }
		])

		// Revisado, una relectura no lo vuelve a poner por revisar.
		await mark('info64', SENSITIVE, 0)
		await run({ from: '', to: '', keys: [SENSITIVE] })
		expect(await proposed()).toMatchObject([{ key: SENSITIVE, excluido: 0 }])
	})

	it('marcado, ni la diaria ni una pasada a mano lo piden ni lo guardan', async () => {
		await mark('info64', SENSITIVE, 1)
		await run(window)
		await run({ from: '', to: '', keys: [SENSITIVE], force: true })
		expect(requested.filter((path) => path.startsWith(SENSITIVE))).toEqual([])
		expect(requested).toContain(OTHER)
		expect(await count('SELECT count(*) AS n FROM tournaments WHERE source_key = ?1', SENSITIVE)).toBe(0)
	})

	it('marcado, la pasada de emparejamientos no pide su ronda', async () => {
		await mark('info64', SENSITIVE, 1)
		await run({ from: '', to: '', pairings: 'only' })
		expect(requested).toEqual(['events.json'])
		expect(await count('SELECT count(*) AS n FROM tournaments')).toBe(0)
	})

	it('marcado, la de sólo clasificación tampoco lo lee, aunque siga guardado', async () => {
		await run(window)
		await mark('info64', SENSITIVE, 1)
		requested = []
		await run({ from: '2026-08-01', to: '2026-10-01', standings: 'only' })
		expect(requested).toEqual([`${OTHER}/standings`])
	})
})

describe('applySensitive', () => {
	const tournament = (key: string, name: string): TournamentInput => ({
		source: 'info64',
		key,
		type: 'individual',
		name,
		city: 'Ninguna',
		startDate: '2026-09-01',
		endDate: '2026-09-02',
		timeControl: '90+30',
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z'
	})
	const player = (startRank: number, name: string, fideId: number): TournamentPlayer => ({
		startRank,
		team: null,
		title: null,
		name,
		fed: 'ESP',
		rating: 1800 + startRank,
		fideId
	})
	// Uno de los dos sólo juega el torneo sensible; el otro, también un open.
	const players = [player(1, 'Ciego Inventado, Uno', 930201), player(2, 'Ciego Inventado, Dos', 930202)]

	/** Guarda el torneo con esos participantes y, si hay dos, una partida entre ellos. */
	async function store(input: TournamentInput, entrants: TournamentPlayer[]): Promise<number> {
		const id = await upsertTournament(db, input)
		await replaceParticipations(db, id, entrants)
		if (entrants.length < 2) return id
		const [white, black] = entrants
		const game = `[Event "Torneo"]\n[Round "1.1"]\n[White "${white.name}"]\n[Black "${black.name}"]\n[Result "1-0"]\n\n1. d4 d5 1-0\n`
		await saveGames(db, id, buildGameRows(parseGames(game), entrants, input), '2026-10-01T00:00:00.000Z', {
			name: 'info64',
			url: null
		})
		return id
	}

	beforeEach(clean)

	it('borra el marcado con todo lo suyo, apunta los que lo parecen y no toca los revisados', async () => {
		const sensitive = await store(tournament('xl-open-fedc', 'XL Open FEDC'), players)
		await replacePairings(db, sensitive, 2, '2030-09-02 10:00', [
			{ board: 1, white: { startRank: 1, name: 'x', rating: null }, black: { startRank: 2, name: 'x', rating: null } }
		])
		await db
			.prepare("INSERT INTO standings (tournament_id, pos, start_rank, points, tiebreaks) VALUES (?1, 1, 1, 1, '[]')")
			.bind(sensitive)
			.run()
		await saveLichessTour(
			db,
			{ tourId: 'Inventad', name: 'XL Open FEDC', url: null, status: 'enlazado', tournamentId: sensitive, espPlayers: 2, finished: true },
			'2026-10-01T00:00:00.000Z'
		)
		await store(tournament('open-inventado', 'Open Inventado'), [player(1, 'Ciego Inventado, Dos', 930202), player(2, 'Rival Inventado, Tres', 930203)])
		await store(tournament('torneo-inclusivo-inventado', 'Torneo Inclusivo Inventado'), [])
		await store(tournament('blitz-solidario-sindrome', 'Blitz Solidario Síndrome Inventado'), [])
		await mark('info64', 'xl-open-fedc', 1)
		await mark('info64', 'blitz-solidario-sindrome', 0)

		expect(await applySensitive(db)).toEqual({ proposed: 1, deleted: 1 })

		expect(await count('SELECT count(*) AS n FROM tournaments WHERE id = ?1', sensitive)).toBe(0)
		for (const table of ['participations', 'games', 'pairings', 'standings']) {
			expect(await count(`SELECT count(*) AS n FROM ${table} WHERE tournament_id = ?1`, sensitive), table).toBe(0)
		}
		// Ni en la búsqueda de partidas ni en las fichas.
		expect(await count(`SELECT count(*) AS n FROM games_fts WHERE games_fts MATCH '"uno"'`)).toBe(0)
		expect(await getPlayerTournaments(db, 930201)).toEqual([])
		expect((await getPlayerTournaments(db, 930202)).map((t) => t.tournamentName)).toEqual(['Open Inventado'])
		expect(await db.prepare('SELECT tournament_id AS id FROM lichess_tours').first()).toEqual({ id: null })
		expect(await db.prepare('SELECT tournaments FROM site_totals').first()).toEqual({ tournaments: 3 })
		expect(await proposed()).toEqual([
			{ source: 'info64', key: 'blitz-solidario-sindrome', nombre: 'Torneo inventado', excluido: 0 },
			{ source: 'info64', key: 'torneo-inclusivo-inventado', nombre: 'Torneo Inclusivo Inventado', excluido: null },
			{ source: 'info64', key: 'xl-open-fedc', nombre: 'Torneo inventado', excluido: 1 }
		])

		// Repetirlo no cambia nada.
		expect(await applySensitive(db)).toEqual({ proposed: 0, deleted: 0 })
	})
})
