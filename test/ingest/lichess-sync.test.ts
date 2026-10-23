import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	fetchTopPage,
	gamesWithPlayers,
	pgnFideIds,
	topCandidates,
	type BroadcastDetail,
	type BroadcastPlayer,
	type BroadcastTour
} from '../../src/ingest/lichess/api'
import {
	broadcastParticipants,
	decide,
	LichessSyncWorkflow,
	selectTours,
	sinceOf,
	syncTour,
	tourInfo,
	tournamentTimeControl,
	type LichessRequest,
	type LichessSyncParams
} from '../../src/ingest/lichess/sync'
import {
	loadLichessTours,
	loadLinkedBroadcasts,
	replaceParticipations,
	upsertTournament,
	type LichessTour
} from '../../src/ingest/repo'
import { madridYear } from '../../src/lib/dates'
import broadcastPgn from '../fixtures/lichess/broadcast.pgn?raw'

describe('listado de retransmisiones', () => {
	const entry = (id: string, finishedAt?: number, group?: string) => ({
		tour: { id, name: `Torneo ${id}` },
		round: { id: `R${id.slice(1)}`, ...(finishedAt ? { finishedAt } : {}) },
		...(group ? { group } : {})
	})
	const since = Date.parse('2026-10-17T00:00:00Z')

	it('toma las activas y las terminadas desde la fecha', () => {
		const page = {
			active: [entry('Activa01', undefined, 'Festival')],
			past: {
				currentPageResults: [
					entry('Reciente', Date.parse('2026-10-18T20:00:00Z')),
					entry('Antigua1', Date.parse('2026-10-10T20:00:00Z'))
				],
				nextPage: 2
			}
		}
		expect(topCandidates(page, since)).toEqual({
			candidates: [
				{ id: 'Activa01', name: 'Torneo Activa01', finished: false, group: true, round: 'Rctiva01' },
				{ id: 'Reciente', name: 'Torneo Reciente', finished: true, round: 'Reciente' }
			],
			more: true
		})
	})

	it('deja de pasar páginas cuando ya no hay terminadas en el plazo', () => {
		const page = {
			active: [],
			past: { currentPageResults: [entry('Antigua1', Date.parse('2026-10-10T20:00:00Z'))], nextPage: 3 }
		}
		expect(topCandidates(page, since)).toEqual({ candidates: [], more: false })
	})

	it('pasada la última página, la API responde 400: no hay más', async () => {
		const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"page"}', { status: 400 }))
		await expect(fetchTopPage(6)).resolves.toBeNull()
		fetch.mockResolvedValue(new Response('error', { status: 500 }))
		await expect(fetchTopPage(1)).rejects.toThrow('HTTP 500')
		fetch.mockRestore()
	})
})

describe('partidas con jugadores concretos', () => {
	it('saca los FIDE ID de las cabeceras', () => {
		expect(pgnFideIds(broadcastPgn)).toContain(97648458)
		expect(pgnFideIds(broadcastPgn)).toHaveLength(12)
	})

	it('sólo parsea las partidas en las que juegan', () => {
		const games = gamesWithPlayers(broadcastPgn, new Set([97648458, 99581621]))
		expect(games.map((g) => g.white)).toEqual(['Vadam Barejezi, Ogimo', 'Obifohuji Nilop, Ejupup'])
		expect(gamesWithPlayers(broadcastPgn, new Set([1]))).toEqual([])
	})
})

describe('decide', () => {
	const tourUrl = 'https://lichess.org/broadcast/open-x/AbCd1234'
	const match = (overlap: number, gamesSource: string | null = null, gamesSourceUrl: string | null = null) => ({
		id: 7,
		overlap,
		gamesSource,
		gamesSourceUrl
	})

	it('es propia si no hay torneo de info64 con bastantes de sus españoles', () => {
		expect(decide(null, 10, 'AbCd1234')).toEqual({ status: 'propio', tournamentId: null })
		expect(decide(match(4), 10, 'AbCd1234').status).toBe('propio')
		// Con un único español no basta para decir que es el mismo torneo.
		expect(decide(match(1), 1, 'AbCd1234').status).toBe('propio')
	})

	it('se enlaza al torneo de info64 sin partidas o con las suyas', () => {
		expect(decide(match(6), 10, 'AbCd1234')).toEqual({ status: 'enlazado', tournamentId: 7 })
		expect(decide(match(6, 'lichess', tourUrl), 10, 'AbCd1234').status).toBe('enlazado')
	})

	it('se descarta si el torneo de info64 ya tiene partidas', () => {
		expect(decide(match(6, 'info64'), 10, 'AbCd1234')).toEqual({ status: 'duplicado', tournamentId: 7 })
		const other = 'https://lichess.org/broadcast/open-x/round-1/Owmjw8DK'
		expect(decide(match(6, 'lichess', other), 10, 'AbCd1234').status).toBe('duplicado')
	})
})

describe('selectTours', () => {
	const known = (tourId: string, status: LichessTour['status'], finished = false): LichessTour => ({
		tourId,
		name: tourId,
		url: null,
		status,
		tournamentId: null,
		espPlayers: 0,
		finished
	})
	const candidate = (id: string, finished = false) => ({ id, name: id, finished })

	it('lee las nuevas y las propias en marcha, sin repetir', () => {
		const result = selectTours(
			[candidate('Nueva001'), candidate('Propia01'), candidate('Nueva001')],
			[known('Propia01', 'propio')],
			false
		)
		expect(result.map((c) => c.id)).toEqual(['Nueva001', 'Propia01'])
	})

	it('relee las que no tenían españoles sólo cuando terminan', () => {
		const tours = [known('SinEsp01', 'sin_espanoles')]
		expect(selectTours([candidate('SinEsp01')], tours, false)).toEqual([])
		expect(selectTours([candidate('SinEsp01', true)], tours, false)).toHaveLength(1)
	})

	it('no relee las terminadas, las enlazadas ni las duplicadas salvo con force', () => {
		const tours = [known('Termin01', 'propio', true), known('Enlaza01', 'enlazado'), known('Duplic01', 'duplicado')]
		const candidates = tours.map((t) => candidate(t.tourId, true))
		expect(selectTours(candidates, tours, false)).toEqual([])
		expect(selectTours(candidates, tours, true)).toHaveLength(3)
	})
})

describe('sinceOf', () => {
	const now = new Date('2026-10-19T06:30:00Z')

	it('mira desde un día antes de la pasada anterior', () => {
		expect(sinceOf(undefined, '2026-10-18T06:30:00.000Z', now)).toBe(Date.parse('2026-10-17T06:30:00Z'))
	})

	it('la primera vez, los dos últimos días; con fecha, desde ella', () => {
		expect(sinceOf(undefined, null, now)).toBe(Date.parse('2026-10-17T06:30:00Z'))
		expect(sinceOf('2026-09-28', '2026-10-18T06:30:00.000Z', now)).toBe(Date.parse('2026-09-28T00:00:00Z'))
	})
})

describe('tourInfo', () => {
	const tour = (dates?: number[]) => ({ id: 'AbCd1234', name: 'Open', url: 'u', dates, info: { fideTC: 'rapid' as const } })
	const now = Date.parse('2026-10-19T12:00:00Z')

	it('da por terminado el torneo que lo dice el listado o con todas sus rondas terminadas', () => {
		expect(tourInfo({ tour: tour(), rounds: [] }, true, now).finished).toBe(true)
		expect(tourInfo({ tour: tour(), rounds: [{ id: 'r1', finished: true }] }, false, now).finished).toBe(true)
		expect(tourInfo({ tour: tour(), rounds: [{ id: 'r1', finished: true }, { id: 'r2' }] }, false, now).finished).toBe(false)
	})

	it('por una ronda, lo da por terminado cuando ya pasó su último día', () => {
		const round = { id: 'r1', finished: true }
		expect(tourInfo({ tour: tour([Date.parse('2026-10-10'), Date.parse('2026-10-17')]), round }, false, now).finished).toBe(
			true
		)
		expect(tourInfo({ tour: tour([Date.parse('2026-10-14'), Date.parse('2026-10-20')]), round }, false, now).finished).toBe(
			false
		)
		expect(tourInfo({ tour: tour(), round }, false, now)).toEqual({
			tour: { id: 'AbCd1234', name: 'Open', url: 'u', dates: undefined, teamTable: undefined, info: { fideTC: 'rapid' } },
			finished: false
		})
	})
})

describe('torneos propios', () => {
	const tour = (info: BroadcastTour['info']): BroadcastTour => ({ id: 'AbCd1234', name: 'Open', url: '', info })

	it('toman el ritmo del texto con cifras o, si no, de la clase FIDE', () => {
		expect(tournamentTimeControl(tour({ tc: '90 min + 30 sec / move', fideTC: 'standard' }))).toBe(
			'90 min + 30 sec / move'
		)
		expect(tournamentTimeControl(tour({ tc: 'Classical', fideTC: 'standard' }))).toBe('Estándar')
		expect(tournamentTimeControl(tour({ tc: 'Rapid' }))).toBe('Rapid')
		expect(tournamentTimeControl(tour(undefined))).toBeNull()
	})

	it('numeran por ELO a los jugadores de las partidas, con los datos de la lista', () => {
		const games = gamesWithPlayers(broadcastPgn, new Set([97648458, 99581621]))
		const players = [{ name: 'Tigegonovik, Cotezav S.', fideId: 99161832, fed: 'UZB', rating: 2360, title: 'GM' }]
		expect(broadcastParticipants(games, players, new Set([97648458, 99581621, 98953868]))).toEqual([
			{ startRank: 1, name: 'Tigegonovik, Cotezav S.', fideId: 99161832, title: 'GM', rating: 2360, fed: 'UZB', team: null },
			{ startRank: 2, name: 'Obifohuji Nilop, Ejupup', fideId: 99581621, title: 'CM', rating: 2235, fed: 'ESP', team: null },
			{ startRank: 3, name: 'Vadam Barejezi, Ogimo', fideId: 97648458, title: null, rating: 2034, fed: 'ESP', team: null },
			{ startRank: 4, name: 'Bukiroc Zeseto, Utuju', fideId: 98953868, title: null, rating: 2005, fed: 'ESP', team: null }
		])
	})

	it('descartan los ELO inverosímiles de la lista y de la cabecera', () => {
		const games = gamesWithPlayers(broadcastPgn.replace('[WhiteElo "2034"]', '[WhiteElo "956"]'), new Set([97648458]))
		// En la lista, 785: se queda el de la cabecera (2357).
		const players = [{ name: 'Tigegonovik, Cotezav S.', fideId: 99161832, fed: 'UZB', rating: 785 }]
		const ratings = new Map(broadcastParticipants(games, players, new Set([97648458])).map((p) => [p.fideId, p.rating]))
		expect(ratings.get(99161832)).toBe(2357)
		expect(ratings.get(97648458)).toBeNull()
	})
})

// --- syncTour contra la D1, con las respuestas de lichess simuladas ---

const db = env.DB
const TOUR_ID = 'AbCd1234'
const TOUR_URL = `https://lichess.org/broadcast/xii-open-albacete-u2400/${TOUR_ID}`
const ROUND_ID = 'jQucOFAV'
// Los jugadores del fixture: todos españoles menos uno de Uzbekistán (UZB).
const FOREIGN = 99161832
const fixtureIds = pgnFideIds(broadcastPgn)
const fixturePlayers: BroadcastPlayer[] = gamesWithPlayers(broadcastPgn, new Set(fixtureIds)).flatMap((g) =>
	(['White', 'Black'] as const).map((color) => {
		const fideId = Number(g.game.headers.get(`${color}FideId`))
		return { name: color === 'White' ? g.white : g.black, fideId, fed: fideId === FOREIGN ? 'UZB' : 'ESP' }
	})
)
const detail: BroadcastDetail = {
	tour: {
		id: TOUR_ID,
		name: 'XII Open Internacional de Ajedrez Ciudad de Albacete | U2400',
		url: TOUR_URL,
		dates: [Date.parse('2026-09-24T14:00:00Z'), Date.parse('2026-09-27T14:00:00Z')],
		info: { tc: '60 min + 30 sec', fideTC: 'standard', location: 'Albacete' }
	},
	rounds: [{ id: 'jQucOFAV', finished: true }]
}

/** Sin Workflow: cada petición se hace tal cual, sin paso ni pausa. */
const direct: LichessRequest = (_name, fn) => fn()

let requested: string[] = []
const requestsSoFar = () => requested.length

/** Simula la API de lichess y apunta qué se pide. */
function mockLichess(players: BroadcastPlayer[] = fixturePlayers, pgn = broadcastPgn, tour = detail.tour): string[] {
	requested = []
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = String(input instanceof Request ? input.url : input)
		requested.push(url)
		if (url.endsWith(`/broadcast/${TOUR_ID}/players`)) return Response.json(players)
		if (url.endsWith(`/api/broadcast/${TOUR_ID}.pgn`)) return new Response(pgn)
		if (url.endsWith(`/api/broadcast/${TOUR_ID}`)) return Response.json({ ...detail, tour })
		if (url.endsWith(`/api/broadcast/-/-/${ROUND_ID}`)) {
			return Response.json({ tour, round: { id: ROUND_ID, finished: true } })
		}
		return new Response('no encontrado', { status: 404 })
	})
	return requested
}

async function addSpanishPlayers(ids: number[]) {
	await db.batch(
		ids.map((id) =>
			db.prepare("INSERT INTO players (fide_id, name, seen_at) VALUES (?1, ?2, '2026-10-01')").bind(id, `Jugador ${id}`)
		)
	)
}

/** Torneo de info64 de las mismas fechas con todos los jugadores del fixture. */
async function addInfo64Tournament(): Promise<number> {
	const id = await upsertTournament(db, {
		source: 'info64',
		key: 'xii-open-albacete-sub2400',
		type: 'individual',
		name: 'XII Open Internacional Ciudad de Albacete Sub2400',
		city: 'Albacete',
		startDate: '2026-09-24',
		endDate: '2026-09-28',
		timeControl: "60'+30''",
		url: 'https://info64.org/xii-open-albacete-sub2400',
		syncedAt: '2026-10-01T00:00:00.000Z'
	})
	await replaceParticipations(
		db,
		id,
		fixturePlayers.map((p, i) => ({
			startRank: i + 1,
			team: null,
			title: null,
			name: p.name,
			fed: p.fed ?? null,
			rating: null,
			fideId: p.fideId ?? null
		}))
	)
	return id
}

const count = async (sql: string, ...params: unknown[]) =>
	(await db
		.prepare(sql)
		.bind(...params)
		.first<{ n: number }>())!.n

describe('syncTour', () => {
	const candidate = { id: TOUR_ID, name: 'Albacete U2400', finished: true }

	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM lichess_tours'),
			db.prepare('DELETE FROM games'),
			db.prepare('DELETE FROM participations'),
			db.prepare('DELETE FROM tournaments'),
			db.prepare('DELETE FROM players'),
			db.prepare('DELETE FROM torneos_sensibles')
		])
		await addSpanishPlayers(fixtureIds.filter((id) => id !== FOREIGN))
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('guarda como torneo propio el que no está en info64', async () => {
		mockLichess()
		expect(await syncTour(db, candidate, direct)).toEqual({ status: 'propio', games: 6, espPlayers: 11 })

		const tournament = await db
			.prepare(`SELECT id, source_key, name, city, start_date, end_date, time_control, url, games_count, games_source FROM tournaments`)
			.first<Record<string, unknown>>()
		expect(tournament).toMatchObject({
			source_key: TOUR_ID,
			city: 'Albacete',
			start_date: '2026-09-24',
			end_date: '2026-09-27',
			time_control: '60 min + 30 sec',
			url: TOUR_URL,
			games_count: 6,
			games_source: 'lichess'
		})
		expect(await count('SELECT count(*) AS n FROM participations WHERE tournament_id = ?1', tournament!.id)).toBe(12)
		const [tour] = await loadLichessTours(db, [TOUR_ID])
		expect(tour).toMatchObject({ status: 'propio', tournamentId: tournament!.id, espPlayers: 11, finished: true })
	})

	it('un menor con el año de homónimo en la lista sigue entre los participantes, sin el año', async () => {
		const born = madridYear(new Date()) - 10
		mockLichess(fixturePlayers.map((p, i) => (i === 0 ? { ...p, name: `${p.name} ${born}` } : p)))
		expect(await syncTour(db, candidate, direct)).toMatchObject({ status: 'propio', games: 6 })
		expect(await count('SELECT count(*) AS n FROM participations')).toBe(12)
		expect(await count('SELECT count(*) AS n FROM participations WHERE name LIKE ?1', `%${born}%`)).toBe(0)
		expect(await count('SELECT count(*) AS n FROM games WHERE pgn LIKE ?1', `%${born}%`)).toBe(0)
	})

	it('de un torneo propio guarda sólo las partidas con algún español', async () => {
		await db.prepare('DELETE FROM players WHERE fide_id <> 97648458').run()
		// Sin federación en la lista: los españoles son los de la tabla players.
		mockLichess(fixturePlayers.map(({ name, fideId }) => ({ name, fideId })))
		expect(await syncTour(db, candidate, direct)).toMatchObject({ status: 'propio', games: 1, espPlayers: 1 })
		// El español y su rival.
		expect(await count('SELECT count(*) AS n FROM participations')).toBe(2)
	})

	it('no repite una partida que ya está en otro torneo', async () => {
		mockLichess()
		const other = await addInfo64Tournament()
		await db.prepare("UPDATE tournaments SET start_date = '2026-01-01', end_date = '2026-01-02' WHERE id = ?1").bind(other).run()
		await db
			.prepare(
				`INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_fide_id, black_fide_id,
					result, ply_count, pgn, seen_at)
				VALUES (?1, 1, 1, '2026-09-25', 'Vadam Barejezi, Ogimo', 'Tigegonovik, Cotezav S.', 97648458, 99161832,
					'1/2-1/2', 43, '', '2026-09-25')`
			)
			.bind(other)
			.run()
		expect(await syncTour(db, candidate, direct)).toMatchObject({ status: 'propio', games: 5 })
	})

	it('enlaza la retransmisión al torneo de info64 que no tiene partidas', async () => {
		mockLichess()
		const id = await addInfo64Tournament()
		expect(await syncTour(db, candidate, direct)).toMatchObject({ status: 'enlazado', games: 6 })

		expect(await count("SELECT count(*) AS n FROM tournaments WHERE source = 'lichess'")).toBe(0)
		const row = await db
			.prepare('SELECT games_count, games_source, games_source_url FROM tournaments WHERE id = ?1')
			.bind(id)
			.first()
		expect(row).toEqual({ games_count: 6, games_source: 'lichess', games_source_url: TOUR_URL })
		expect(await loadLinkedBroadcasts(db, id)).toEqual([TOUR_URL])
	})

	it('descarta la retransmisión si el torneo de info64 ya tiene partidas', async () => {
		mockLichess()
		const id = await addInfo64Tournament()
		await db.prepare("UPDATE tournaments SET games_source = 'info64', games_count = 90 WHERE id = ?1").bind(id).run()
		expect(await syncTour(db, candidate, direct)).toMatchObject({ status: 'duplicado', games: 0 })
		expect(await count('SELECT count(*) AS n FROM games')).toBe(0)
		expect(await loadLinkedBroadcasts(db, id)).toEqual([])
	})

	it('pasa el torneo propio a info64 cuando aparece allí', async () => {
		mockLichess()
		await syncTour(db, { ...candidate, finished: false }, direct)
		expect(await count("SELECT count(*) AS n FROM tournaments WHERE source = 'lichess'")).toBe(1)

		const id = await addInfo64Tournament()
		expect(await syncTour(db, { ...candidate, finished: false }, direct)).toMatchObject({ status: 'enlazado', games: 6 })
		expect(await count("SELECT count(*) AS n FROM tournaments WHERE source = 'lichess'")).toBe(0)
		expect(await count('SELECT count(*) AS n FROM games WHERE tournament_id = ?1', id)).toBe(6)
	})

	it('un torneo propio que se relee sin españoles se conserva, con un aviso', async () => {
		mockLichess()
		await syncTour(db, { ...candidate, finished: false }, direct)
		const own = "SELECT count(*) AS n FROM games g JOIN tournaments t ON t.id = g.tournament_id WHERE t.source = 'lichess'"
		expect(await count(own)).toBe(6)

		// La lista de jugadores ya no trae españoles.
		vi.restoreAllMocks()
		await db.prepare('DELETE FROM players').run()
		mockLichess(fixturePlayers.map((p) => ({ ...p, fed: 'UZB' })))
		expect(await syncTour(db, { ...candidate, finished: false }, direct)).toMatchObject({ status: 'propio', avisos: 1 })
		expect(await count(own)).toBe(6)
		expect((await loadLichessTours(db, [TOUR_ID]))[0]).toMatchObject({ status: 'propio' })

		// El PGN pierde las cabeceras FideId: ninguna partida con españoles.
		vi.restoreAllMocks()
		await addSpanishPlayers(fixtureIds.filter((id) => id !== FOREIGN))
		mockLichess(fixturePlayers, broadcastPgn.replace(/^\[(White|Black)FideId "[^"]*"\]\r?\n/gm, ''))
		expect(await syncTour(db, { ...candidate, finished: false }, direct)).toMatchObject({ status: 'propio', avisos: 1 })
		expect(await count(own)).toBe(6)
		expect((await loadLichessTours(db, [TOUR_ID]))[0]).toMatchObject({ status: 'propio' })
	})

	it('sin españoles no pide el torneo ni el PGN', async () => {
		await db.prepare('DELETE FROM players').run()
		const requested = mockLichess(fixturePlayers.map((p) => ({ ...p, fed: 'UZB' })))
		expect(await syncTour(db, candidate, direct)).toMatchObject({ status: 'sin_espanoles' })
		expect(requested).toEqual([`https://lichess.org/broadcast/${TOUR_ID}/players`])
		expect((await loadLichessTours(db, [TOUR_ID]))[0]).toMatchObject({ status: 'sin_espanoles', finished: true })
	})

	it('hace cada petición a lichess en su propio paso', async () => {
		mockLichess()
		const steps: string[] = []
		const counting: LichessRequest = async (name, fn) => {
			const before = requestsSoFar()
			const result = await fn()
			steps.push(`${name}: ${requestsSoFar() - before}`)
			return result
		}
		await syncTour(db, candidate, counting)
		expect(steps).toEqual([`jugadores ${TOUR_ID}: 1`, `torneo ${TOUR_ID}: 1`, `partidas ${TOUR_ID}: 1`])
	})

	it('con una ronda, pide los datos del torneo por ella', async () => {
		const requested = mockLichess()
		expect(await syncTour(db, { ...candidate, round: ROUND_ID }, direct)).toMatchObject({ status: 'propio', games: 6 })
		expect(requested).toContain(`https://lichess.org/api/broadcast/-/-/${ROUND_ID}`)
		expect(requested).not.toContain(`https://lichess.org/api/broadcast/${TOUR_ID}`)
	})

	it('con los datos del torneo ya leídos, sólo pide los jugadores y el PGN', async () => {
		const requested = mockLichess()
		const info = tourInfo(detail, true, Date.now())
		expect(await syncTour(db, candidate, direct, info)).toMatchObject({ status: 'propio', games: 6 })
		expect(requested).toEqual([
			`https://lichess.org/broadcast/${TOUR_ID}/players`,
			`https://lichess.org/api/broadcast/${TOUR_ID}.pgn`
		])
	})

	it('sin jugadores todavía no decide nada hasta otro día', async () => {
		mockLichess([])
		expect(await syncTour(db, { ...candidate, finished: false }, direct)).toMatchObject({ status: null })
		expect(await loadLichessTours(db, [TOUR_ID])).toEqual([])
	})

	it('apunta para revisarlo el torneo propio que parece sensible (torneos_sensibles)', async () => {
		mockLichess()
		const info = { tour: { ...detail.tour, name: 'XII Open Inventado para Ciegos' }, finished: true }
		expect(await syncTour(db, candidate, direct, info)).toMatchObject({ status: 'propio', games: 6 })
		expect(await db.prepare('SELECT source, source_key AS key, nombre, excluido FROM torneos_sensibles').all()).toMatchObject({
			results: [{ source: 'lichess', key: TOUR_ID, nombre: 'XII Open Inventado para Ciegos', excluido: null }]
		})
	})

	it('no pide una retransmisión marcada como sensible, ni con force', async () => {
		const requested = mockLichess()
		await db
			.prepare("INSERT INTO torneos_sensibles (source, source_key, nombre, excluido, creado) VALUES ('lichess', ?1, 'Torneo inventado', 1, '2026-10-23')")
			.bind(TOUR_ID)
			.run()
		// Pasos de verdad, sin Workflow ni pausas.
		const step = {
			do: async (_name: string, ...rest: unknown[]) => (rest.at(-1) as () => Promise<unknown>)(),
			sleep: async () => {}
		} as unknown as WorkflowStep
		const event = { payload: { tours: [TOUR_ID], force: true }, timestamp: new Date() } as WorkflowEvent<LichessSyncParams>
		await (Object.assign(Object.create(LichessSyncWorkflow.prototype), { env }) as LichessSyncWorkflow).run(event, step)
		expect(requested).toEqual([])
		expect(await count('SELECT count(*) AS n FROM tournaments')).toBe(0)
	})

	it('no guarda ni apunta una retransmisión de menores (con tours, se mira al leerla)', async () => {
		const requested = mockLichess()
		const info = { tour: { ...detail.tour, name: 'Campeonato Inventado Sub 12 | U12' }, finished: true }
		expect(await syncTour(db, candidate, direct, info)).toMatchObject({ status: null, games: 0 })
		expect(requested.some((url) => url.endsWith('.pgn'))).toBe(false)
		expect(await count('SELECT count(*) AS n FROM tournaments')).toBe(0)
		expect(await loadLichessTours(db, [TOUR_ID])).toEqual([])
	})

	it('de una retransmisión de menores la pasada sólo pide la ronda que la nombra', async () => {
		const requested = mockLichess(fixturePlayers, broadcastPgn, { ...detail.tour, name: 'European Youth Inventado 2030 | G12' })
		const step = {
			do: async (_name: string, ...rest: unknown[]) => (rest.at(-1) as () => Promise<unknown>)(),
			sleep: async () => {}
		} as unknown as WorkflowStep
		const event = { payload: { rounds: [ROUND_ID] }, timestamp: new Date() } as WorkflowEvent<LichessSyncParams>
		await (Object.assign(Object.create(LichessSyncWorkflow.prototype), { env }) as LichessSyncWorkflow).run(event, step)
		expect(requested).toEqual([expect.stringContaining(`/api/broadcast/-/-/${ROUND_ID}`)])
		expect(await count('SELECT count(*) AS n FROM tournaments')).toBe(0)
	})
})
