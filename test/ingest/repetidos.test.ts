import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Info64SyncWorkflow, type Info64SyncParams } from '../../src/ingest/info64/sync'
import { buildGameRows } from '../../src/ingest/games'
import { replaceParticipations, saveGames, upsertTournament, type TournamentInput } from '../../src/ingest/repo'
import { isListedCopy, LISTED_COPIES } from '../../src/ingest/repetidos'
import { applyListedCopies } from '../../src/ingest/reprocess'
import { parseGames } from '../../src/lib/chess/pgn'

// Torneos de info64 que repiten las partidas de otro: no se guardan. Jugadores
// inventados; los slugs, los de la lista.
const db = env.DB
const COPY = 'granada-chess-open-2026-1'
const ORIGINAL = 'granada-chess-open-2026'

const count = async (sql: string, ...params: unknown[]) =>
	(await db
		.prepare(sql)
		.bind(...params)
		.first<{ n: number }>())!.n

const clean = () =>
	db.batch([
		db.prepare('DELETE FROM standings'),
		db.prepare('DELETE FROM pairings'),
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM site_totals')
	])

const players = [1, 2].map((startRank) => ({
	startRank,
	team: null,
	title: null,
	name: `Repetido Inventado, Jugador ${startRank}`,
	fed: 'ESP',
	rating: 1500 + startRank,
	fideId: 930500 + startRank
}))
const pgn = `[Event "Torneo"]\n[Round "1.1"]\n[White "${players[0].name}"]\n[Black "${players[1].name}"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`

describe('isListedCopy', () => {
	it('reconoce los de la lista por su slug de info64', () => {
		expect(isListedCopy(COPY)).toBe(true)
		expect(isListedCopy('variacion-elo-fide-std-r1')).toBe(true)
		expect(isListedCopy(ORIGINAL)).toBe(false)
		expect(isListedCopy('campeonato-de-asturias-individual-2024')).toBe(false)
	})

	it('no se repiten', () => {
		expect(new Set(LISTED_COPIES).size).toBe(LISTED_COPIES.length)
	})
})

describe('la pasada de info64', () => {
	let requested: string[] = []
	const pages: Record<string, string> = {
		'events.json': JSON.stringify([
			{ title: 'R.1 - Granada Chess Open - 2026', url: `/${ORIGINAL}/`, start: '2026-07-28T17:00:00' },
			{ title: 'R.1 - Granada Chess Open 2026', url: `/${COPY}/`, start: '2026-07-28T17:00:00' }
		]),
		[ORIGINAL]:
			`<h1>Granada Chess Open - 2026</h1><table id="initial-ranking-table"><tbody>` +
			players
				.map(
					(p) =>
						`<tr><td class="playerstartrank">${p.startRank}</td><td class="playertitle"></td><td class="playername">${p.name}</td>` +
						`<td class="playerfederation">ESP</td><td class="playerfiderat">${p.rating}</td><td class="playerfideratid">${p.fideId}</td></tr>`
				)
				.join('') +
			`</tbody></table>`,
		[`${ORIGINAL}/games`]: `<textarea id="pgnText">${pgn}</textarea>`
	}
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

	it('no pide ni guarda el repetido, ni en la diaria ni a mano', async () => {
		await run({ from: '2026-07-01', to: '2026-08-31' })
		await run({ from: '', to: '', keys: [COPY], force: true })
		expect(requested).toContain(ORIGINAL)
		expect(requested.filter((path) => path.startsWith(COPY))).toEqual([])
		expect(await count('SELECT count(*) AS n FROM tournaments WHERE source_key = ?1', COPY)).toBe(0)
		expect(await count('SELECT count(*) AS n FROM games')).toBe(1)
	})
})

describe('applyListedCopies', () => {
	const tournament = (key: string, source = 'info64'): TournamentInput => ({
		source,
		key,
		type: 'individual',
		name: 'Granada Chess Open 2026',
		city: 'Granada',
		startDate: '2026-07-28',
		endDate: '2026-08-02',
		timeControl: '90+30',
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z'
	})

	async function store(input: TournamentInput): Promise<number> {
		const id = await upsertTournament(db, input)
		await replaceParticipations(db, id, players)
		await saveGames(db, id, buildGameRows(parseGames(pgn), players, input), '2026-10-01T00:00:00.000Z', {
			name: 'info64',
			url: null
		})
		return id
	}

	beforeEach(clean)

	it('borra los de la lista con todo lo suyo y deja el original', async () => {
		const copy = await store(tournament(COPY))
		const original = await store(tournament(ORIGINAL))
		// La misma clave en otra fuente no es de la lista.
		await store(tournament(COPY, 'fca'))

		expect(await applyListedCopies(db)).toEqual({ deleted: 1 })

		expect(await count('SELECT count(*) AS n FROM tournaments WHERE id = ?1', copy)).toBe(0)
		for (const [table, kept] of [
			['participations', 2],
			['games', 1]
		] as const) {
			expect(await count(`SELECT count(*) AS n FROM ${table} WHERE tournament_id = ?1`, copy), table).toBe(0)
			expect(await count(`SELECT count(*) AS n FROM ${table} WHERE tournament_id = ?1`, original), table).toBe(kept)
		}
		expect(await db.prepare('SELECT tournaments FROM site_totals').first()).toEqual({ tournaments: 2 })

		// Repetirlo no cambia nada.
		expect(await applyListedCopies(db)).toEqual({ deleted: 0 })
	})
})
