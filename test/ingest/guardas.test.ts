import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FideSyncWorkflow } from '../../src/ingest/fide/sync'
import { buildGameRows } from '../../src/ingest/games'
import { decodeEntities, PageFormatError, parseTournamentPage, type TournamentPlayer } from '../../src/ingest/info64/parse'
import { Info64SyncWorkflow, type Info64SyncParams } from '../../src/ingest/info64/sync'
import {
	replacePairings,
	replaceParticipations,
	saveGames,
	saveSyncState,
	upsertTournament,
	type TournamentInput
} from '../../src/ingest/repo'
import { parseGames, parsePgnDate } from '../../src/lib/chess/pgn'
import { validDate } from '../../src/lib/dates'
import { FIDE_LIST_KEY } from '../../src/lib/db/players'
import { healthKey, type HealthRun } from '../../src/lib/salud'

// Guardas de no-regresión de la ingesta: una lectura vacía, parcial o con otra
// forma no sustituye lo guardado (repo.ts). Nombres inventados.
const db = env.DB
const INFO64 = { name: 'info64', url: null }
const KEY = 'torneo-guardas'

const tournament: TournamentInput = {
	source: 'info64',
	key: KEY,
	type: 'individual',
	name: 'Torneo de las guardas',
	city: 'Ninguna',
	startDate: '2026-09-01',
	endDate: '2026-09-05',
	timeControl: '90+30',
	url: `https://info64.org/${KEY}`,
	syncedAt: '2026-10-01T00:00:00.000Z'
}

const player = (startRank: number): TournamentPlayer => ({
	startRank,
	team: null,
	title: null,
	name: `Apellido${startRank} Inventado, Nombre`,
	fed: 'ESP',
	rating: 1500 + startRank,
	fideId: 910000 + startRank
})
const players = Array.from({ length: 20 }, (_, i) => player(i + 1))

/** Partida como las de info64; `brokenComment` deja un comentario sin cerrar. */
function game(round: number, board: number, brokenComment = false): string {
	const white = players[(board - 1) * 2].name
	const black = players[(board - 1) * 2 + 1].name
	const moves = brokenComment ? '1. e4 { sin cerrar e5 2. Nf3 1-0' : '1. e4 e5 2. Nf3 1-0'
	return `[Event "Torneo"]\n[Round "${round}.${board}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "1-0"]\n\n${moves}\n`
}

/** `n` partidas: dos rondas de hasta 10 tableros. */
function pgnOf(n: number, brokenAt?: number): string {
	return Array.from({ length: n }, (_, i) => game(Math.floor(i / 10) + 1, (i % 10) + 1, i === brokenAt)).join('\n')
}

const rowsOf = (n: number) => buildGameRows(parseGames(pgnOf(n)), players, tournament)
const count = async (sql: string, ...params: unknown[]) =>
	(await db
		.prepare(sql)
		.bind(...params)
		.first<{ n: number }>())!.n

async function clean() {
	await db.batch([
		db.prepare('DELETE FROM pairings'),
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM sync_state')
	])
}

describe('guardas de repo.ts', () => {
	beforeEach(clean)

	it('saveGames no sustituye las guardadas por una lectura vacía o con menos de la mitad', async () => {
		const id = await upsertTournament(db, tournament)
		expect(await saveGames(db, id, rowsOf(10), '2026-10-01T00:00:00.000Z', INFO64)).toBe(true)

		expect(await saveGames(db, id, [], '2026-10-02T00:00:00.000Z', INFO64)).toBe(false)
		expect(await saveGames(db, id, rowsOf(4), '2026-10-03T00:00:00.000Z', INFO64)).toBe(false)
		expect(await count('SELECT count(*) AS n FROM games WHERE tournament_id = ?1', id)).toBe(10)
		// Pasa por revisado, sin tocar la fuente ni el contador.
		const state = await db
			.prepare('SELECT games_count, games_checked_at, games_source FROM tournaments WHERE id = ?1')
			.bind(id)
			.first()
		expect(state).toEqual({ games_count: 10, games_checked_at: '2026-10-03T00:00:00.000Z', games_source: 'info64' })

		// Con la mitad, sí: el organizador ha quitado partidas.
		expect(await saveGames(db, id, rowsOf(5), '2026-10-04T00:00:00.000Z', INFO64)).toBe(true)
		expect(await count('SELECT count(*) AS n FROM games WHERE tournament_id = ?1', id)).toBe(5)
		// Con replace, se guarda igual.
		expect(await saveGames(db, id, [], '2026-10-05T00:00:00.000Z', INFO64, { replace: true })).toBe(true)
		expect(await count('SELECT count(*) AS n FROM games WHERE tournament_id = ?1', id)).toBe(0)
	})

	it('replaceParticipations no vacía una lista guardada', async () => {
		const id = await upsertTournament(db, tournament)
		expect(await replaceParticipations(db, id, [])).toBe(true)
		expect(await replaceParticipations(db, id, players)).toBe(true)
		expect(await replaceParticipations(db, id, [])).toBe(false)
		expect(await count('SELECT count(*) AS n FROM participations WHERE tournament_id = ?1', id)).toBe(20)
		expect(await replaceParticipations(db, id, players.slice(0, 3))).toBe(true)
		expect(await count('SELECT count(*) AS n FROM participations WHERE tournament_id = ?1', id)).toBe(3)
	})

	it('replacePairings sin filas conserva los de esa ronda y quita los de otras', async () => {
		const id = await upsertTournament(db, tournament)
		const side = (startRank: number) => ({ startRank, name: players[startRank - 1].name, rating: null })
		await replacePairings(db, id, 3, '2026-09-03 17:00', [{ board: 1, white: side(1), black: side(2) }])
		await replacePairings(db, id, 3, '2026-09-03 17:00', [])
		expect(await count('SELECT count(*) AS n FROM pairings WHERE round = 3')).toBe(1)
		await replacePairings(db, id, 4, '2026-09-04 17:00', [])
		expect(await count('SELECT count(*) AS n FROM pairings')).toBe(0)
	})

	it('upsertTournament no pisa con nulos la ciudad, las fechas ni el ritmo', async () => {
		const id = await upsertTournament(db, tournament)
		await upsertTournament(db, { ...tournament, name: 'Nombre nuevo', city: null, startDate: null, endDate: null, timeControl: null })
		const row = await db
			.prepare('SELECT name, city, start_date, end_date, time_control FROM tournaments WHERE id = ?1')
			.bind(id)
			.first()
		expect(row).toEqual({ name: 'Nombre nuevo', city: 'Ninguna', start_date: '2026-09-01', end_date: '2026-09-05', time_control: '90+30' })
	})
})

describe('lecturas con otra forma', () => {
	it('una página de torneo sin título es un error de formato; sin ranking, no', async () => {
		await expect(parseTournamentPage('<p>Mantenimiento</p>')).rejects.toBeInstanceOf(PageFormatError)
		const page = await parseTournamentPage('<h1>Torneo sin inscritos</h1>')
		expect(page).toMatchObject({ name: 'Torneo sin inscritos', players: [] })
	})

	it('descarta las fechas imposibles del torneo y del PGN', async () => {
		const page = await parseTournamentPage(
			'<h1>T</h1><div id="dates"><span class="mommentdate">2026-13-45</span> to <span class="mommentdate">9999-01-01</span></div>'
		)
		expect(page).toMatchObject({ startDate: null, endDate: null })
		expect(parsePgnDate('2026.13.45')).toBeNull()
		expect(parsePgnDate('9999.01.01')).toBeNull()
		expect(parsePgnDate('0001.01.01')).toBeNull()
		expect(parsePgnDate('2026.02.29')).toBeNull()
		expect(parsePgnDate('2024.02.29')).toBe('2024-02-29')
		expect(validDate('1849-12-31')).toBeNull()
		expect(validDate('1850-01-01')).toBe('1850-01-01')
	})

	it('deja como texto las entidades fuera de Unicode y el NUL', () => {
		expect(decodeEntities('&#99999999; &#0; &#x41;&amp;')).toBe('&#99999999; &#0; A&')
	})
})

/** Pasos de verdad, sin Workflow: su salida pasa por JSON, como la guarda Workflows. */
const step = {
	do: async (_name: string, ...rest: unknown[]) =>
		JSON.parse(JSON.stringify((await (rest.at(-1) as () => Promise<unknown>)()) ?? null)),
	sleep: async () => {}
} as unknown as WorkflowStep

async function health(run: HealthRun) {
	const row = await db.prepare('SELECT value FROM sync_state WHERE key = ?1').bind(healthKey(run)).first<{ value: string }>()
	return row ? JSON.parse(row.value) : null
}

describe('pasada diaria de info64', () => {
	let pages: Record<string, string | number> = {}

	beforeEach(async () => {
		await clean()
		const ranking = players
			.map(
				(p) =>
					`<tr><td class="playerstartrank">${p.startRank}</td><td class="playername">${p.name}</td>` +
					`<td class="playerfideratid">${p.fideId}</td></tr>`
			)
			.join('')
		// Una ronda ya jugada en el calendario: entra en la ventana y no en las próximas.
		const events = JSON.stringify([{ title: 'R.1 - Torneo de las guardas', url: `/${KEY}/`, start: '2026-09-01T17:00:00' }])
		pages = {
			'events.json': events,
			[KEY]: `<h1>Torneo de las guardas</h1><table id="initial-ranking-table"><tbody>${ranking}</tbody></table>`,
			[`${KEY}/games`]: `<textarea id="pgnText">${pgnOf(10)}</textarea>`
		}
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = new URL(String(input instanceof Request ? input.url : input))
			const path = url.pathname.replace(/^\//, '')
			const page = pages[path]
			if (typeof page === 'number') return new Response('', { status: page })
			return page === undefined ? new Response('no encontrado', { status: 404 }) : new Response(page)
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	const daily = { payload: { from: '2026-08-01', to: '2026-10-01', pairings: 'also' } } as WorkflowEvent<Info64SyncParams>
	const run = () =>
		(Object.assign(Object.create(Info64SyncWorkflow.prototype), { env }) as Info64SyncWorkflow).run(daily, step)

	it('guarda y apunta la salud de la diaria y de los emparejamientos', async () => {
		await run()
		expect(await count('SELECT count(*) AS n FROM games')).toBe(10)
		expect(await health('info64')).toMatchObject({ ok: 1, fallos: 0, avisos: 0 })
		expect(await health('emparejamientos')).toMatchObject({ ok: 0, fallos: 0, avisos: 0 })
	})

	it('un PGN con un comentario sin cerrar no borra las partidas guardadas: avisa', async () => {
		await run()
		await db.prepare('UPDATE tournaments SET games_checked_at = NULL').run()
		// En la novena: se leen 9 de 10, más de la mitad, así que sólo lo para la
		// cuenta de cabeceras Event.
		pages[`${KEY}/games`] = `<textarea id="pgnText">${pgnOf(10, 8)}</textarea>`
		await run()
		expect(await count('SELECT count(*) AS n FROM games')).toBe(10)
		expect(await health('info64')).toMatchObject({ ok: 1, fallos: 0, avisos: 1 })
	})

	it('una página sin ranking conserva los participantes y las partidas siguen con su FIDE ID', async () => {
		await run()
		await db.prepare('UPDATE tournaments SET games_checked_at = NULL').run()
		pages[KEY] = '<h1>Torneo de las guardas</h1>'
		await run()
		expect(await count('SELECT count(*) AS n FROM participations')).toBe(20)
		expect(await count('SELECT count(*) AS n FROM games WHERE white_fide_id IS NULL OR black_fide_id IS NULL')).toBe(0)
		expect(await health('info64')).toMatchObject({ ok: 1, avisos: 1 })
	})

	it('una página con otra forma o un 404 cuentan como fallo, sin reintentos ni cambios', async () => {
		await run()
		await db.prepare('UPDATE tournaments SET games_checked_at = NULL').run()
		pages[KEY] = '<p>Nueva web de info64</p>'
		await run()
		expect(await count('SELECT count(*) AS n FROM games')).toBe(10)
		expect(await health('info64')).toMatchObject({ ok: 0, fallos: 1 })

		pages[KEY] = 404
		await run()
		expect(await health('info64')).toMatchObject({ ok: 0, fallos: 1 })
		expect(await count('SELECT count(*) AS n FROM participations')).toBe(20)
	})

	it('una pasada a mano (keys) no escribe la salud', async () => {
		const manual = { payload: { from: '', to: '', keys: [KEY] } } as WorkflowEvent<Info64SyncParams>
		await (Object.assign(Object.create(Info64SyncWorkflow.prototype), { env }) as Info64SyncWorkflow).run(manual, step)
		expect(await count('SELECT count(*) AS n FROM games')).toBe(10)
		expect(await health('info64')).toBeNull()
	})
})

describe('salud de la lista FIDE', () => {
	beforeEach(clean)
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('sin cambios en la lista, también apunta que la pasada ha ido bien', async () => {
		const lastModified = 'Wed, 21 Oct 2026 21:03:09 GMT'
		await saveSyncState(db, FIDE_LIST_KEY, lastModified)
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { headers: { 'Last-Modified': lastModified } }))
		const event = { payload: {}, timestamp: new Date('2026-11-03T06:00:00Z') } as WorkflowEvent<object>
		await (Object.assign(Object.create(FideSyncWorkflow.prototype), { env }) as FideSyncWorkflow).run(event, step)
		expect(await health('fide')).toMatchObject({ ok: 0, fallos: 0, avisos: 0 })
	})
})
