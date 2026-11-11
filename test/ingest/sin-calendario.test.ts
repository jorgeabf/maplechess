import { env, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageFormatError, parseApiTournaments, type ApiTournament, type EventTournament } from '../../src/ingest/info64/parse'
import {
	apiTournamentsUrl,
	Info64SyncWorkflow,
	selectUncalendared,
	uncalendaredCandidates,
	UNCALENDARED_FROM,
	UNCALENDARED_MAX_NIGHTS,
	type Info64SyncParams
} from '../../src/ingest/info64/sync'
import { loadUncalendaredState, markGamesChecked, saveSyncState, upsertTournament } from '../../src/ingest/repo'
import { addDays, isoDate } from '../../src/lib/dates'

// Una página de /api/3/tournaments recortada a lo que se lee, con datos inventados.
const page = {
	count: 3,
	next: null,
	previous: null,
	results: [
		{
			slug: 'open-inventado-2026',
			name: 'Open Inventado 2026',
			city: 'Ninguna Parte',
			federation: 'ESP',
			startdate: '2026-10-03',
			enddate: '2026-10-04',
			chiefarbiter: 'Supuesto Irreal, Otro',
			team_tournament: false
		},
		{
			slug: 'liga-inventada-2026',
			name: 'Liga Inventada &amp; Cía',
			startdate: '2026-09-20',
			enddate: null,
			team_tournament: true
		},
		{ slug: '../fuera', name: 'Slug raro', startdate: '2026-09-01', enddate: '2026-09-01', team_tournament: false }
	]
}

describe('parseApiTournaments', () => {
	it('lee el slug, el nombre, el tipo y las fechas, y nada más', () => {
		const { count, rows, tournaments } = parseApiTournaments(JSON.stringify(page))
		expect(count).toBe(3)
		// La fila del slug raro cuenta: la página siguiente empieza tras ella.
		expect(rows).toBe(3)
		expect(tournaments).toEqual([
			{
				key: 'open-inventado-2026',
				type: 'individual',
				name: 'Open Inventado 2026',
				startDate: '2026-10-03',
				endDate: '2026-10-04'
			},
			{ key: 'team/liga-inventada-2026', type: 'team', name: 'Liga Inventada & Cía', startDate: '2026-09-20', endDate: null }
		])
		expect(JSON.stringify(tournaments)).not.toContain('Supuesto')
	})

	it('una fecha imposible queda vacía', () => {
		const odd = { count: 1, results: [{ slug: 'raro', name: 'Raro', startdate: '2026-13-01', team_tournament: false }] }
		expect(parseApiTournaments(JSON.stringify(odd)).tournaments[0].startDate).toBeNull()
	})

	it('una respuesta sin la forma de la API es un PageFormatError', () => {
		expect(() => parseApiTournaments('<html>Not Found</html>')).toThrow(PageFormatError)
		expect(() => parseApiTournaments(JSON.stringify({ detail: 'Not found.' }))).toThrow(PageFormatError)
	})

	it('pide de 500 en 500', () => {
		expect(apiTournamentsUrl(1000)).toBe('https://info64.org/api/3/tournaments?limit=500&offset=1000')
	})
})

const api = (key: string, startDate: string | null, endDate: string | null = startDate, name = key): ApiTournament => ({
	key,
	type: key.startsWith('team/') ? 'team' : 'individual',
	name,
	startDate,
	endDate
})

describe('uncalendaredCandidates', () => {
	const today = '2026-11-11'

	it('sólo los empezados, con fecha y desde la carga inicial', () => {
		const found = uncalendaredCandidates(
			[
				api('empezado', '2026-11-01', '2026-11-02'),
				api('futuro', '2026-11-20'),
				api('sin-fecha', null),
				api('antiguo', '2013-12-31'),
				api('primero', UNCALENDARED_FROM)
			],
			today
		)
		expect(found.map((c) => c.key)).toEqual(['empezado', 'primero'])
		expect(found[0]).toEqual({
			key: 'empezado',
			type: 'individual',
			name: 'empezado',
			firstRound: '2026-11-01',
			lastRound: '2026-11-02'
		})
	})

	it('sin fecha de fin, la del principio', () => {
		expect(uncalendaredCandidates([api('team/liga', '2026-09-20', null)], today)[0].lastRound).toBe('2026-09-20')
	})

	it('ni de menores ni de las listas a mano', () => {
		const found = uncalendaredCandidates(
			[
				api('edades', '2026-10-01', '2026-10-01', 'Campeonato por Edades de Ninguna Parte S08'),
				api('torneo-infantil-de-navarres', '2026-10-01')
			],
			today
		)
		expect(found).toEqual([])
	})
})

describe('selectUncalendared', () => {
	const today = '2026-11-11'
	const candidate = (key: string, firstRound: string, lastRound = firstRound): EventTournament => ({
		key,
		type: 'individual',
		name: key,
		firstRound,
		lastRound
	})

	it('los más recientes primero, hasta el tope', () => {
		const candidates = [candidate('a', '2024-01-01'), candidate('c', '2026-10-01'), candidate('b', '2025-05-01')]
		expect(selectUncalendared(candidates, [], today, 2).map((c) => c.key)).toEqual(['c', 'b'])
	})

	it('no relee uno guardado y ya cerrado', () => {
		const checked = [{ key: 'cerrado', endDate: '2025-01-05', gamesCheckedAt: '2025-03-01T00:10:00.000Z' }]
		expect(selectUncalendared([candidate('cerrado', '2025-01-04', '2025-01-05')], checked, today, 300)).toEqual([])
	})

	it('sin fecha de fin en la D1, toma la de la API', () => {
		const checked = [{ key: 'sin-fin', endDate: null, gamesCheckedAt: '2025-03-01T00:10:00.000Z' }]
		expect(selectUncalendared([candidate('sin-fin', '2025-01-04', '2025-01-05')], checked, today, 300)).toEqual([])
	})

	it('sigue con uno guardado que aún no ha acabado', () => {
		const checked = [{ key: 'abierto', endDate: '2026-11-20', gamesCheckedAt: '2026-11-10T00:10:00.000Z' }]
		expect(selectUncalendared([candidate('abierto', '2026-11-01', '2026-11-20')], checked, today, 300)).toHaveLength(1)
	})
})

describe('Info64SyncWorkflow, torneos sin calendario', () => {
	const cal = (key: string, day: string): EventTournament => ({
		key,
		type: 'individual',
		name: key,
		firstRound: day,
		lastRound: day
	})
	const fromApi = [cal('del-calendario', '2026-11-01'), cal('sin-fechas', '2026-10-01'), cal('menores-por-su-pagina', '2026-09-01')]

	interface Options {
		/** Lo que da la lista, sin pedirla; null: se pide de verdad (fetch simulado). */
		candidates?: EventTournament[] | null
		/** Pasos que fallan tras sus reintentos. */
		fail?: (name: string) => boolean
		/** Pasos de franja que dicen que ya ha pasado. */
		closed?: (name: string) => boolean
	}

	// Pasos de mentira: no se pide nada a info64. Los de la base se ejecutan.
	const run = async ({ candidates = fromApi, fail = () => false, closed = () => false }: Options = {}) => {
		const steps: string[] = []
		const configs = new Map<string, WorkflowStepConfig>()
		const step = {
			do: async (name: string, ...rest: unknown[]) => {
				// Apuntado antes de fallar: cuenta como pedido.
				steps.push(name)
				if (rest.length === 2) configs.set(name, rest[0] as WorkflowStepConfig)
				if (fail(name)) throw new Error('info64 no responde')
				if (name === 'calendario') return [cal('del-calendario', '2026-11-01')]
				if (name === 'próximas rondas') return { now: '2026-11-11 01:00', rounds: [] }
				if (name === 'api 0' && candidates) return { count: candidates.length, rows: candidates.length, candidates }
				if (name.startsWith('franja sin calendario')) return !closed(name)
				if (name === 'torneo menores-por-su-pagina') return null
				if (name.startsWith('torneo ')) return { id: 1, key: name.slice(7), broadcasts: [] }
				if (name.startsWith('clasificación ')) return true
				if (name.startsWith('partidas ')) return { games: 0, identified: 0, illegal: 0, source: null }
				return (rest.at(-1) as () => Promise<unknown>)()
			},
			sleep: async () => {}
		} as unknown as WorkflowStep
		const event = { payload: { from: '2026-09-12', to: '2026-11-11', pairings: 'also' } } as WorkflowEvent<Info64SyncParams>
		const workflow: Info64SyncWorkflow = Object.assign(Object.create(Info64SyncWorkflow.prototype), { env })
		await workflow.run(event, step)
		return { steps, configs, read: steps.filter((s) => s.startsWith('torneo ')).map((s) => s.slice(7)) }
	}

	const health = async (run: string) => {
		const row = await env.DB.prepare('SELECT value FROM sync_state WHERE key = ?1').bind(`salud.${run}`).first<{ value: string }>()
		return row ? JSON.parse(row.value) : null
	}

	beforeEach(async () => {
		await env.DB.batch([
			env.DB.prepare('DELETE FROM sync_state'),
			env.DB.prepare('DELETE FROM torneos_sensibles'),
			env.DB.prepare('DELETE FROM tournaments')
		])
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('van al final, sin releer los del calendario, y con su salud', async () => {
		const { steps, read } = await run()
		expect(read).toEqual(['del-calendario', 'sin-fechas', 'menores-por-su-pagina'])
		// Las salud de la ventana y la de los emparejamientos, antes de la lista.
		expect(steps.indexOf('salud emparejamientos')).toBeLessThan(steps.indexOf('api 0'))
		expect(steps.indexOf('salud')).toBeLessThan(steps.indexOf('api 0'))
		expect(steps.slice(-3)).toEqual(['sin calendario apuntados', 'salud sin calendario', 'totales'])
		expect(await health('info64')).toMatchObject({ ok: 1, fallos: 0 })
		expect(await health('sin-calendario')).toMatchObject({ ok: 1, fallos: 0 })
	})

	it('reintentan poco, no como los del calendario', async () => {
		const { configs } = await run()
		expect(configs.get('torneo sin-fechas')?.retries?.limit).toBe(2)
		expect(configs.get('partidas sin-fechas')?.retries?.limit).toBe(2)
		expect(configs.get('torneo del-calendario')?.retries?.limit).toBe(5)
	})

	it('apunta los descartados por su página, para no volver a pedirlos', async () => {
		await run()
		expect((await loadUncalendaredState(env.DB)).descartados).toEqual(['menores-por-su-pagina'])
		expect((await run()).read).not.toContain('menores-por-su-pagina')
	})

	it('no pide los sensibles', async () => {
		await env.DB.prepare(
			`INSERT INTO torneos_sensibles (source, source_key, nombre, excluido, creado)
			VALUES ('info64', 'sin-fechas', 'Sin fechas', 1, '2026-11-11T00:00:00Z')`
		).run()
		expect((await run()).read).not.toContain('sin-fechas')
	})

	it(`uno que falla se pide ${UNCALENDARED_MAX_NIGHTS} noches y luego ya no`, async () => {
		const fail = (name: string) => name === 'torneo sin-fechas'
		for (let night = 1; night <= UNCALENDARED_MAX_NIGHTS; night++) {
			expect((await run({ fail })).read).toContain('sin-fechas')
			expect((await loadUncalendaredState(env.DB)).fallos).toEqual({ 'sin-fechas': night })
			expect(await health('sin-calendario')).toMatchObject({ ok: 0, fallos: 1 })
		}
		expect((await run({ fail })).read).not.toContain('sin-fechas')
		expect((await run()).read).not.toContain('sin-fechas')
	})

	it('uno leído bien con keys vuelve a la pasada', async () => {
		const today = isoDate(new Date())
		await saveSyncState(env.DB, 'sin_calendario', JSON.stringify({ descartados: [], fallos: { 'sin-fechas': 3 } }))
		const id = await upsertTournament(env.DB, {
			source: 'info64',
			key: 'sin-fechas',
			type: 'individual',
			name: 'Sin fechas',
			city: null,
			startDate: today,
			endDate: today,
			timeControl: null,
			url: 'https://info64.org/sin-fechas',
			syncedAt: new Date().toISOString(),
			related: null
		})
		await markGamesChecked(env.DB, id, new Date().toISOString())
		expect((await run()).read).toContain('sin-fechas')
	})

	it('una noche en que falla todo, también la ventana, no cuenta', async () => {
		const candidates = Array.from({ length: 7 }, (_, i) => cal(`roto-${i}`, `2026-10-0${i + 1}`))
		await run({ candidates, fail: (name) => name.startsWith('torneo ') })
		expect((await loadUncalendaredState(env.DB)).fallos).toEqual({})
	})

	it('cinco rotos seguidos con la ventana bien sí cuentan: no tapan para siempre a los demás', async () => {
		const candidates = Array.from({ length: 7 }, (_, i) => cal(`roto-${i}`, `2026-10-0${i + 1}`))
		await run({ candidates, fail: (name) => name.startsWith('torneo roto-') })
		expect(Object.keys((await loadUncalendaredState(env.DB)).fallos)).toHaveLength(5)
	})

	it('uno que vuelve a ir bien sale de los fallos', async () => {
		await run({ fail: (name) => name === 'torneo sin-fechas' })
		await run()
		expect((await loadUncalendaredState(env.DB)).fallos).toEqual({})
	})

	it('para tras 5 fallos seguidos', async () => {
		const candidates = Array.from({ length: 7 }, (_, i) => cal(`roto-${i}`, `2026-10-0${i + 1}`))
		const { read } = await run({ candidates, fail: (name) => name.startsWith('torneo roto-') })
		// Los más recientes primero: del 7 al 3; el 2 y el 1 quedan para la noche siguiente.
		expect(read.filter((k) => k.startsWith('roto-'))).toEqual(['roto-6', 'roto-5', 'roto-4', 'roto-3', 'roto-2'])
		expect(await health('sin-calendario')).toMatchObject({ ok: 0, fallos: 5 })
	})

	it('fuera de la franja no pide la lista; a mitad, para', async () => {
		expect((await run({ closed: (name) => name === 'franja sin calendario' })).steps).not.toContain('api 0')
		const { read } = await run({ closed: (name) => name === 'franja sin calendario menores-por-su-pagina' })
		expect(read).toEqual(['del-calendario', 'sin-fechas'])
	})

	it('si falla la lista, no lee ninguno: es una alarma, y la diaria sigue', async () => {
		const { steps, read } = await run({ fail: (name) => name === 'api 0' })
		expect(read).toEqual(['del-calendario'])
		expect(steps.at(-1)).toBe('totales')
		expect(await health('sin-calendario')).toMatchObject({ ok: 0, fallos: 1 })
		expect(await health('info64')).toMatchObject({ ok: 1, fallos: 0 })
	})

	describe('la lista, pedida a la API', () => {
		const row = (slug: string, startdate: string, name = slug) => ({
			slug,
			name,
			startdate,
			enddate: startdate,
			chiefarbiter: 'Supuesto Irreal, Otro',
			team_tournament: false
		})
		const mockApi = (pages: Record<string, { count: number; results: object[] }>) => {
			const requests: Request[] = []
			vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
				const request = new Request(input, init)
				requests.push(request)
				const page = pages[new URL(request.url).searchParams.get('offset') ?? '']
				return page ? new Response(JSON.stringify(page)) : new Response('no encontrado', { status: 404 })
			})
			return requests
		}

		it('sigue donde acaba cada página, sin repetir, en JSON', async () => {
			// La API da 2 por página aunque se pidan 500, y repite uno al cambiar de página.
			const requests = mockApi({
				'0': { count: 4, results: [row('uno', '2026-10-01'), row('dos', '2026-10-02')] },
				'2': { count: 4, results: [row('dos', '2026-10-02'), row('tres', '2026-10-03')] }
			})
			const { steps, read } = await run({ candidates: null })
			expect(steps.filter((s) => s.startsWith('api '))).toEqual(['api 0', 'api 2'])
			expect(read.filter((k) => k !== 'del-calendario')).toEqual(['tres', 'dos', 'uno'])
			expect(requests.every((r) => r.headers.get('Accept') === 'application/json')).toBe(true)
			expect(requests.every((r) => r.headers.get('User-Agent')?.startsWith('MapleChess/'))).toBe(true)
		})

		it('no lee los de menores por el nombre ni los que no han empezado', async () => {
			mockApi({
				'0': {
					count: 3,
					results: [
						row('abierto', '2026-10-01'),
						row('edades', '2026-10-01', 'Campeonato por Edades de Ninguna Parte S08'),
						row('futuro', addDays(isoDate(new Date()), 30))
					]
				}
			})
			expect((await run({ candidates: null })).read.filter((k) => k !== 'del-calendario')).toEqual(['abierto'])
		})

		it('una lista que se acaba antes de su total es un fallo, no una lista a medias', async () => {
			mockApi({
				'0': { count: 4, results: [row('uno', '2026-10-01'), row('dos', '2026-10-02')] },
				'2': { count: 4, results: [] }
			})
			const { read } = await run({ candidates: null })
			expect(read).toEqual(['del-calendario'])
			expect(await health('sin-calendario')).toMatchObject({ ok: 0, fallos: 1 })
		})
	})
})
