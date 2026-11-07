import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Info64SyncWorkflow, type GroupsSummary, type Info64SyncParams } from '../../src/ingest/info64/sync'
import { GROUP_FAILURES_KEY, loadSyncState, replaceParticipations, upsertTournament } from '../../src/ingest/repo'
import { LISTED_COPIES } from '../../src/ingest/repetidos'
import { GamesReprocessWorkflow, rehearseLabels, type GamesReprocessParams } from '../../src/ingest/reprocess'
import type { RelatedTournament } from '../../src/lib/db/tournaments'

// Sólo el grupo de los torneos guardados (groups: 'only'): lo que pide a info64,
// lo que escribe y cómo evita coincidir con la diaria. Torneos inventados.
const db = env.DB
const A = 'open-inventado-a'
const B = 'open-inventado-b'
const TEAM = 'team/open-inventado-equipos'

const label = (key: string) => key.slice(-1).toUpperCase()
const group = (...keys: string[]): RelatedTournament[] => keys.map((key) => ({ key, label: label(key) }))
const nav = (...keys: string[]) =>
	'<div id="tournament-selection-nav"><ul class="nav nav-tabs">' +
	keys.map((key) => `<li><a href="/${key}">${label(key)}</a></li>`).join('') +
	'</ul></div><h1>Open Inventado</h1>'

const store = (key: string, name = key, startDate = '2026-09-01', related: RelatedTournament[] | null = null) =>
	upsertTournament(db, {
		source: 'info64',
		key,
		type: key.startsWith('team/') ? 'team' : 'individual',
		name,
		city: 'Ninguna',
		startDate,
		endDate: startDate,
		timeControl: '90+30',
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z',
		related
	})

const stored = (key: string) =>
	db
		.prepare('SELECT name, city, synced_at AS syncedAt, related FROM tournaments WHERE source_key = ?1')
		.bind(key)
		.first<{ name: string; city: string; syncedAt: string; related: string | null }>()
const storedGroup = async (key: string) => {
	const related = (await stored(key))?.related
	return related ? (JSON.parse(related) as RelatedTournament[]) : null
}
const failures = async () => JSON.parse((await loadSyncState(db, GROUP_FAILURES_KEY)) ?? '[]') as string[]

/** Un env con la instancia de la diaria en ese estado; las demás no existen. */
function envWith(status: () => string, create = vi.fn(async () => {})) {
	const asked: string[] = []
	return {
		DB: db,
		asked,
		create,
		INFO64_SYNC: {
			get: async (id: string) => {
				if (!id.startsWith('info64-diario-')) throw new Error('instance.not_found')
				asked.push(id)
				return { status: async () => ({ status: status() }) }
			},
			create
		}
	}
}

describe('INFO64_SYNC con groups: only', () => {
	let pages: Record<string, string | number> = {}
	let requested: string[] = []
	let steps: string[] = []
	let configs: Record<string, unknown> = {}
	let sleeps: [string, unknown][] = []
	// Con el reloj de mentira: lo que tarda cada pausa de un segundo.
	let pauseMs = 0

	/** Pasos de verdad, sin Workflow: su salida pasa por JSON, como la guarda Workflows. */
	const step = {
		do: async (name: string, ...rest: unknown[]) => {
			steps.push(name)
			if (rest.length > 1) configs[name] = rest[0]
			return JSON.parse(JSON.stringify((await (rest.at(-1) as () => Promise<unknown>)()) ?? null))
		},
		sleep: async (name: string, duration: unknown) => {
			sleeps.push([name, duration])
			if (vi.isFakeTimers()) vi.setSystemTime(Date.now() + (typeof duration === 'number' ? duration : pauseMs))
		}
	} as unknown as WorkflowStep

	const run = (params: Partial<Info64SyncParams> = {}, workflowEnv: unknown = envWith(() => 'complete')) =>
		(Object.assign(Object.create(Info64SyncWorkflow.prototype), { env: workflowEnv }) as Info64SyncWorkflow).run(
			{
				payload: { from: '2026-08-01', to: '2026-10-01', groups: 'only', ...params }
			} as WorkflowEvent<Info64SyncParams>,
			step
		) as Promise<GroupsSummary>

	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM tournaments'),
			db.prepare('DELETE FROM torneos_sensibles'),
			db.prepare('DELETE FROM sync_state')
		])
		pages = {}
		requested = []
		steps = []
		configs = {}
		sleeps = []
		pauseMs = 0
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const path = new URL(String(input instanceof Request ? input.url : input)).pathname.replace(/^\//, '')
			requested.push(path)
			const page = pages[path]
			if (typeof page === 'number') return new Response('', { status: page })
			return page === undefined ? new Response('no encontrado', { status: 404 }) : new Response(page)
		})
		// Dentro de la franja: las pruebas de la franja ponen su hora.
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-08T01:00:00Z') })
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	it('pide sólo su página y guarda sólo el grupo', async () => {
		const id = await store(A)
		await store(TEAM)
		await replaceParticipations(db, id, [
			{ startRank: 1, team: null, title: null, name: 'Supuesto Irreal, Otro', fed: 'ESP', rating: 2000, fideId: 930001 }
		])
		const before = await stored(A)
		pages[`${A}/schedule`] = nav(A, B)
		pages[`${TEAM}/schedule`] = nav(A, TEAM)

		expect(await run()).toEqual({ tournaments: 2, groups: 2, missing: 0, failed: [] })

		// Ni el calendario, ni la página principal, ni la clasificación, ni las partidas.
		expect(requested.sort()).toEqual([`${A}/schedule`, `${TEAM}/schedule`])
		expect(await storedGroup(A)).toEqual(group(A, B))
		expect(await storedGroup(TEAM)).toEqual(group(A, TEAM))
		// Lo demás se queda como estaba, también la hora de la última lectura.
		expect(await stored(A)).toEqual({ ...before, related: JSON.stringify(group(A, B)) })
		expect(await db.prepare('SELECT count(*) AS n FROM participations').first('n')).toBe(1)
		// Ni los totales ni la salud: es una pasada a mano.
		expect(steps).not.toContain('totales')
		expect(await db.prepare('SELECT count(*) AS n FROM sync_state').first('n')).toBe(0)
	})

	it('hace una pausa tras cada torneo y reintenta poco', async () => {
		await store(A)
		await store(B)
		await run()
		expect(sleeps.filter(([name]) => name.startsWith('pausa grupo'))).toEqual([
			[`pausa grupo ${A}`, '1 second'],
			[`pausa grupo ${B}`, '1 second']
		])
		// Con los reintentos de las demás pasadas, una caída saldría de la franja.
		expect(configs[`grupo ${A}`]).toMatchObject({ retries: { limit: 2 } })
	})

	it('en una ventana salta los que ya lo tienen y los que caen fuera; con keys, los relee', async () => {
		await store(A, A, '2026-09-01', group(A, B))
		await store(B)
		await store('open-inventado-viejo', 'Viejo', '2015-01-10')
		await store('open-inventado-futuro', 'Futuro', '2099-01-10')
		await run({ to: '2100-01-01' })
		expect(requested).toEqual([`${B}/schedule`])

		requested = []
		pages[`${A}/schedule`] = nav(B, A)
		await run({ from: '', to: '', keys: [A] })
		expect(requested).toEqual([`${A}/schedule`])
		expect(await storedGroup(A)).toEqual(group(B, A))
	})

	it('no lee los sensibles, los de menores ni los repetidos aún guardados', async () => {
		const copy = [...LISTED_COPIES][0]
		const bySlug = 'campeonato-inventado-sub-12'
		await store(A)
		await store('open-sensible')
		await store('campeonato-inventado', 'Campeonato Inventado Sub 12')
		await store(bySlug, 'Campeonato Inventado', '2015-01-10')
		await store('open-sub-08-12-santa-catalina-park-2021', 'Open Promoción')
		await store(copy)
		await db
			.prepare(
				"INSERT INTO torneos_sensibles (source, source_key, nombre, excluido, creado) VALUES ('info64', 'open-sensible', 'Open', 1, '2026-10-01')"
			)
			.run()
		expect(await run()).toMatchObject({ tournaments: 1 })
		expect(requested).toEqual([`${A}/schedule`])

		// Con keys, los mismos; el de menores, por el slug. Y uno normal, para ver que sí lee.
		requested = []
		await run({ from: '', to: '', keys: ['open-sensible', bySlug, copy, B] })
		expect(requested).toEqual([])
		await store(B)
		await run({ from: '', to: '', keys: ['open-sensible', bySlug, copy, B] })
		expect(requested).toEqual([`${B}/schedule`])
	})

	it('no guarda un grupo sin el propio o de uno solo, ni borra el guardado', async () => {
		await store(A)
		await store(B, B, '2026-09-01', group(A, B))
		pages[`${A}/schedule`] = nav('open-inventado-c', B)
		pages[`${B}/schedule`] = '<h1>Open Inventado</h1>'
		expect(await run()).toMatchObject({ tournaments: 1, groups: 0 })
		expect(await storedGroup(A)).toBeNull()

		await run({ from: '', to: '', keys: [B] })
		expect(await storedGroup(B)).toEqual(group(A, B))
	})

	it('cuenta los que no tienen la página y los que fallan, y sigue con los demás', async () => {
		await store(A)
		await store(B)
		await store('open-inventado-c')
		pages[`${A}/schedule`] = 500
		pages['open-inventado-c/schedule'] = nav('open-inventado-c', B)
		expect(await run()).toEqual({ tournaments: 3, groups: 1, missing: 1, failed: [A] })
	})

	it('una página con otra forma falla, no cuenta como un torneo sin grupo', async () => {
		await store(A)
		pages[`${A}/schedule`] = '<p>Nueva web de info64</p>'
		expect(await run()).toEqual({ tournaments: 1, groups: 0, missing: 0, failed: [A] })
	})

	it('apunta los que fallan en una lista común, y volver a pedirlos los quita', async () => {
		await store(A)
		await store(B, B, '2026-10-15')
		pages[`${A}/schedule`] = 500
		pages[`${B}/schedule`] = 500
		await run({ from: '2026-09-01', to: '2026-09-30' })
		await run({ from: '2026-10-01', to: '2026-10-31' })
		expect(await failures()).toEqual([A, B])

		pages[`${A}/schedule`] = nav(A, B)
		await run({ from: '', to: '', keys: [A] })
		expect(await failures()).toEqual([B])
		expect(await storedGroup(A)).toEqual(group(A, B))
	})

	describe('si info64 deja de responder', () => {
		const keys = ['t1', 't2', 't3', 't4', 't5', 't6']
		const chain = { until: '2026-10-31', months: 1 }
		const window = { from: '2026-09-01', to: '2026-09-30', chain }

		beforeEach(async () => {
			for (const key of keys) await store(key)
			for (const key of keys) pages[`${key}/schedule`] = 500
		})

		it('tras cinco fallos seguidos para: ni más peticiones ni ventana siguiente, y quedan apuntados', async () => {
			const workflowEnv = envWith(() => 'complete')
			await expect(run(window, workflowEnv)).rejects.toThrow(/5 fallos seguidos/)
			expect(requested).toHaveLength(5)
			expect(workflowEnv.create).not.toHaveBeenCalled()
			expect(await failures()).toEqual(['t1', 't2', 't3', 't4', 't5'])
		})

		it('con un acierto por medio, la cuenta vuelve a empezar', async () => {
			const workflowEnv = envWith(() => 'complete')
			pages['t5/schedule'] = nav('t5', 't6')
			expect(await run(window, workflowEnv)).toMatchObject({ groups: 1, failed: ['t1', 't2', 't3', 't4', 't6'] })
			expect(workflowEnv.create).toHaveBeenCalledOnce()
		})
	})

	it('encadena la ventana siguiente, con su nombre y sin perder el modo', async () => {
		const workflowEnv = envWith(() => 'complete')
		const chain = { until: '2026-10-31', months: 1 }
		await run({ from: '2026-09-01', to: '2026-09-30', chain }, workflowEnv)
		expect(workflowEnv.create).toHaveBeenCalledWith({
			id: 'info64-grupo-2026-10-01-2026-10-31',
			params: expect.objectContaining({ from: '2026-10-01', to: '2026-10-31', chain, groups: 'only' })
		})
	})

	describe('la franja y la diaria', () => {
		const running = (states: string[]) => envWith(() => states.shift() ?? 'complete')

		beforeEach(async () => {
			await store(A)
		})

		it('se miran antes de pedir nada', async () => {
			await run()
			expect(steps.slice(0, 4)).toEqual([
				'franja tras la diaria ventana',
				'día de la diaria ventana',
				'diaria acabada ventana 0',
				'torneos guardados'
			])
		})

		it('fuera de la franja duerme hasta las 00:30 UTC y mira la diaria de ese día, no la de ayer', async () => {
			vi.setSystemTime(new Date('2026-11-07T18:30:00Z'))
			const workflowEnv = envWith(() => 'complete')
			await run({}, workflowEnv)
			expect(sleeps[0]).toEqual(['espera a que pase la diaria ventana', 6 * 60 * 60_000])
			expect(workflowEnv.asked[0]).toBe('info64-diario-2026-11-08')
		})

		it('si sigue en marcha, la espera', async () => {
			await run({}, running(['running', 'waiting', 'queued', 'unknown', 'complete']))
			expect(sleeps.filter(([name]) => name.startsWith('espera a la diaria'))).toHaveLength(4)
			expect(requested).toEqual([`${A}/schedule`])
		})

		it('acabada con un error, también cuenta como acabada', async () => {
			await run({}, running(['errored']))
			expect(requested).toEqual([`${A}/schedule`])
		})

		it('si no acaba, se para con un error y no pide nada', async () => {
			await expect(run({}, running(Array(6).fill('running')))).rejects.toThrow(/no se ve acabada/)
			expect(requested).toEqual([])
		})

		it('si no se la ve (el cron llega tarde o no se puede leer), no cuenta como acabada', async () => {
			const missing = {
				DB: db,
				INFO64_SYNC: {
					get: async () => {
						throw new Error('instance.not_found')
					}
				}
			}
			await expect(run({}, missing)).rejects.toThrow(/no se ve acabada/)
			expect(sleeps.filter(([name]) => name.startsWith('espera a la diaria'))).toHaveLength(6)
			expect(requested).toEqual([])
		})

		it('una ventana lenta no pasa de las 05:00: sigue la noche siguiente, tras la diaria', async () => {
			await store(B)
			pages[`${A}/schedule`] = nav(A, B)
			pages[`${B}/schedule`] = nav(A, B)
			// 04:59:30 de Madrid y una pausa de un minuto: el segundo torneo ya no cabe.
			vi.setSystemTime(new Date('2026-11-08T03:59:30Z'))
			pauseMs = 60_000
			const workflowEnv = envWith(() => 'complete')

			await run({}, workflowEnv)

			expect(requested).toEqual([`${A}/schedule`, `${B}/schedule`])
			const wait = sleeps.find(([name]) => name === `espera a que pase la diaria ${B}`)
			expect(wait).toBeDefined()
			expect(workflowEnv.asked.at(-1)).toBe('info64-diario-2026-11-09')
			expect(steps.indexOf(`grupo ${B}`)).toBeGreaterThan(steps.indexOf(`diaria acabada ${B} 0`))
		})
	})
})

describe('el ensayo de los rótulos', () => {
	const related = (own: string, ownLabel: string) => [
		{ key: own, label: ownLabel },
		{ key: 'otro', label: 'Otro' }
	]

	beforeEach(async () => {
		await db.batch([db.prepare('DELETE FROM tournaments'), db.prepare('DELETE FROM torneos_sensibles')])
		await store('navidad-c', 'Torneo de Navidad Grupo C', '2026-09-01', related('navidad-c', 'Sub 12'))
		await store('navidad-d', 'Torneo de Navidad Grupo D', '2026-09-01', related('navidad-d', 'Ciegos'))
		await store('navidad-a', 'Torneo de Navidad Grupo A', '2026-09-01', related('navidad-a', 'Absoluto'))
		// Éste ya lo dice el nombre: no es cosa del rótulo.
		await store('escolar', 'Torneo Escolar Inventado', '2026-09-01', related('escolar', 'Infantil'))
	})

	it('lista lo que sólo el rótulo haría borrar o apuntar', async () => {
		expect(await rehearseLabels(db)).toEqual({
			minors: [{ key: 'navidad-c', name: 'Torneo de Navidad Grupo C', label: 'Sub 12' }],
			sensitive: [{ key: 'navidad-d', name: 'Torneo de Navidad Grupo D', label: 'Ciegos' }]
		})
	})

	it('el Workflow lo deja en su salida y no toca nada, ni lo que el reprocesado completo borraría', async () => {
		const step = {
			do: async (_name: string, ...rest: unknown[]) => (rest.at(-1) as () => Promise<unknown>)(),
			sleep: async () => {}
		} as unknown as WorkflowStep
		const output = await (Object.assign(Object.create(GamesReprocessWorkflow.prototype), { env }) as GamesReprocessWorkflow).run(
			{ payload: { ensayo: true } } as WorkflowEvent<GamesReprocessParams>,
			step
		)
		expect(output).toMatchObject({ minors: [{ key: 'navidad-c' }], sensitive: [{ key: 'navidad-d' }] })
		expect(await db.prepare('SELECT count(*) AS n FROM tournaments').first('n')).toBe(4)
		expect(await db.prepare('SELECT count(*) AS n FROM torneos_sensibles').first('n')).toBe(0)
	})
})
