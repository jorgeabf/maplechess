import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseStandingsPage, type StandingsPage, type TournamentPlayer } from '../../src/ingest/info64/parse'
import { Info64SyncWorkflow, type Info64SyncParams } from '../../src/ingest/info64/sync'
import { replaceParticipations, replaceStandings, upsertTournament } from '../../src/ingest/repo'
import { addDays, madridDate } from '../../src/lib/dates'
import { healthKey, type HealthRun } from '../../src/lib/salud'
import standingsHtml from '../fixtures/info64/standings.html?raw'
import standingsUnplayedHtml from '../fixtures/info64/standings-unplayed.html?raw'
import teamStandingsHtml from '../fixtures/info64/team-standings.html?raw'

// Clasificación del torneo (tabla standings): su guardado, sus guardas y los
// pasos de INFO64_SYNC que la leen. Nombres inventados, los del fixture.
const db = env.DB
const KEY = 'open-inventado-2026'

const player = (startRank: number, name: string): TournamentPlayer => ({
	startRank,
	team: null,
	title: null,
	name,
	fed: 'ESP',
	rating: 2000 + startRank,
	fideId: 930000 + startRank
})
// Los cinco del fixture, por su número inicial.
const players = [
	player(1, 'Morivek Dasul, Pelo'),
	player(2, 'Fabuzo Lerinat, Tomeco'),
	player(3, 'Kepado Runil, Sabe'),
	player(4, 'Zelitu Borano, Amaci'),
	player(5, 'Tovani Celu, Orsefa')
]

const tournament = (key: string, type: 'individual' | 'team' = 'individual', startDate = '2026-09-01') =>
	upsertTournament(db, {
		source: 'info64',
		key,
		type,
		name: key,
		city: null,
		startDate,
		endDate: addDays(startDate, 6),
		timeControl: null,
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z'
	})

const standings = async (html: string) => (await parseStandingsPage(html)) as StandingsPage
const rows = (id: number) =>
	db
		.prepare('SELECT pos, start_rank AS startRank, name, rating, points, tiebreaks FROM standings WHERE tournament_id = ?1 ORDER BY pos')
		.bind(id)
		.all<{ pos: number; startRank: number; name: string | null; rating: number | null; points: number; tiebreaks: string }>()
		.then((r) => r.results)
const meta = (id: number) =>
	db.prepare('SELECT rounds, standings_round AS round, tiebreaks FROM tournaments WHERE id = ?1').bind(id).first()

async function clean() {
	await db.batch([
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM pairings'),
		db.prepare('DELETE FROM standings'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM sync_state')
	])
}

describe('replaceStandings', () => {
	beforeEach(clean)

	it('guarda la clasificación de un individual sin repetir los jugadores, con su ronda y sus desempates', async () => {
		const id = await tournament(KEY)
		await replaceParticipations(db, id, players)
		expect(await replaceStandings(db, id, 'individual', await standings(standingsHtml))).toBe(true)
		const saved = await rows(id)
		expect(saved).toHaveLength(5)
		expect(saved[0]).toEqual({ pos: 1, startRank: 2, name: null, rating: null, points: 4.5, tiebreaks: '[14,9.5,4]' })
		expect(await meta(id)).toEqual({ rounds: 7, round: 5, tiebreaks: '["BH","BH/M1","WON"]' })
	})

	it('en los de equipos guarda el nombre y el ELO medio de cada equipo', async () => {
		const id = await tournament('team/liga-inventada-2026', 'team')
		expect(await replaceStandings(db, id, 'team', await standings(teamStandingsHtml))).toBe(true)
		expect((await rows(id))[0]).toMatchObject({ startRank: 3, name: 'Club Tablero Norte', rating: 2105, points: 6 })
		expect(await meta(id)).toEqual({ rounds: 3, round: null, tiebreaks: '["MatPnt","GamPnt","Dir_MP"]' })
	})

	it('una lectura sin puntos no borra la guardada: avisa sólo si había una', async () => {
		const id = await tournament(KEY)
		await replaceParticipations(db, id, players)
		const unplayed = await standings(standingsUnplayedHtml)
		// Aún sin resultados y sin nada guardado: no hay nada que avisar.
		expect(await replaceStandings(db, id, 'individual', unplayed)).toBe(true)
		expect(await rows(id)).toEqual([])

		await replaceStandings(db, id, 'individual', await standings(standingsHtml))
		expect(await replaceStandings(db, id, 'individual', unplayed)).toBe(false)
		expect(await replaceStandings(db, id, 'individual', { ...unplayed, rows: [] })).toBe(false)
		expect(await rows(id)).toHaveLength(5)
		expect(await meta(id)).toMatchObject({ round: 5 })
	})

	it('no guarda la de un individual con algún número que no está entre los participantes', async () => {
		const id = await tournament(KEY)
		await replaceParticipations(db, id, players.slice(0, 4))
		expect(await replaceStandings(db, id, 'individual', await standings(standingsHtml))).toBe(false)
		expect(await rows(id)).toEqual([])
	})
})

/** Pasos de verdad, sin Workflow: su salida pasa por JSON, como la guarda Workflows. */
const step = {
	do: async (_name: string, ...rest: unknown[]) =>
		JSON.parse(JSON.stringify((await (rest.at(-1) as () => Promise<unknown>)()) ?? null)),
	sleep: async () => {}
} as unknown as WorkflowStep

const run = (params: Info64SyncParams) =>
	(Object.assign(Object.create(Info64SyncWorkflow.prototype), { env }) as Info64SyncWorkflow).run(
		{ payload: params } as WorkflowEvent<Info64SyncParams>,
		step
	)

async function health(run: HealthRun) {
	const row = await db.prepare('SELECT value FROM sync_state WHERE key = ?1').bind(healthKey(run)).first<{ value: string }>()
	return row ? JSON.parse(row.value) : null
}

describe('INFO64_SYNC', () => {
	let pages: Record<string, string | number> = {}
	let requested: string[] = []
	const today = madridDate(new Date())

	beforeEach(async () => {
		await clean()
		const ranking = players
			.map(
				(p) =>
					`<tr><td class="playerstartrank">${p.startRank}</td><td class="playername">${p.name}</td>` +
					`<td class="playerfideratid">${p.fideId}</td></tr>`
			)
			.join('')
		// La ronda 5 ya jugada (entra en la ventana) y la 6, emparejada para pasado mañana.
		const events = JSON.stringify([
			{ title: 'R.5 - Open inventado', url: `/${KEY}/`, start: `${addDays(today, -1)}T17:00:00` },
			{ title: 'R.6 - Open inventado', url: `/${KEY}/`, start: `${addDays(today, 2)}T17:00:00` }
		])
		pages = {
			'events.json': events,
			[KEY]: `<h1>Open inventado</h1><table id="initial-ranking-table"><tbody>${ranking}</tbody></table>`,
			[`${KEY}/standings`]: standingsHtml,
			[`${KEY}/games`]: '<div class="well">There are no games.</div>',
			[`${KEY}/6`]:
				`<div id="round"><h2>Pairings of round 6 - ${addDays(today, 2)} - 17:00</h2></div>` +
				'<table id="pairing-table"><thead><tr><th>Brd.</th><th>White</th><th>Ran.</th><th>Black</th><th>Ran.</th></tr></thead>' +
				'<tbody><tr><td>1</td><td>Fabuzo Lerinat, Tomeco</td><td>2</td><td>Morivek Dasul, Pelo</td><td>1</td></tr></tbody></table>'
		}
		requested = []
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = new URL(String(input instanceof Request ? input.url : input))
			const path = url.pathname.replace(/^\//, '')
			requested.push(path)
			const page = pages[path]
			if (typeof page === 'number') return new Response('', { status: page })
			return page === undefined ? new Response('no encontrado', { status: 404 }) : new Response(page)
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	const daily: Info64SyncParams = { from: addDays(today, -60), to: today, pairings: 'also' }
	const id = async () => (await db.prepare('SELECT id FROM tournaments WHERE source_key = ?1').bind(KEY).first<{ id: number }>())!.id

	it('la diaria la guarda tras los participantes y no la pide otra vez con los emparejamientos', async () => {
		await run(daily)
		expect(await rows(await id())).toHaveLength(5)
		expect(requested.filter((p) => p.endsWith('/standings'))).toHaveLength(1)
		expect(await health('info64')).toMatchObject({ ok: 1, fallos: 0, avisos: 0 })
	})

	it('una clasificación con otra forma es un aviso: las partidas se leen igual', async () => {
		pages[`${KEY}/standings`] = '<p>Nueva web de info64</p>'
		await run(daily)
		expect(requested).toContain(`${KEY}/games`)
		expect(await health('info64')).toMatchObject({ ok: 1, fallos: 0, avisos: 1 })
	})

	it('sin página de clasificación (404), sin clasificación y sin aviso', async () => {
		delete pages[`${KEY}/standings`]
		await run(daily)
		expect(await rows(await id())).toEqual([])
		expect(await health('info64')).toMatchObject({ ok: 1, avisos: 0 })
	})

	it('las pasadas de emparejamientos la releen en los torneos ya empezados', async () => {
		await run(daily)
		pages[`${KEY}/standings`] = standingsHtml.replace('after the round 5', 'after the round 6')
		await run({ from: today, to: today, pairings: 'only' })
		expect(requested.filter((p) => p.endsWith('/standings'))).toHaveLength(2)
		expect(await meta(await id())).toMatchObject({ round: 6 })
		expect(await health('emparejamientos')).toMatchObject({ ok: 1, fallos: 0, avisos: 0 })
	})

	it('sólo clasificación: la de los torneos guardados de la ventana, sin calendario ni partidas', async () => {
		await run(daily)
		await db.prepare('DELETE FROM standings').run()
		const other = await tournament('otro-open-inventado', 'individual', '2026-01-10')
		requested = []
		await run({ from: addDays(today, -60), to: today, standings: 'only' })
		expect(requested).toEqual([`${KEY}/standings`])
		expect(await rows(await id())).toHaveLength(5)
		expect(await rows(other)).toEqual([])
		// Con keys, sólo esos, aunque empiecen fuera de la ventana.
		requested = []
		await run({ from: '', to: '', keys: ['otro-open-inventado'], standings: 'only' })
		expect(requested).toEqual(['otro-open-inventado/standings'])
	})
})
