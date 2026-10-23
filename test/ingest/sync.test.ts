import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { EventTournament } from '../../src/ingest/info64/parse'
import {
	Info64SyncWorkflow,
	RECHECK_DAYS,
	selectPending,
	windowInstanceId,
	type Info64SyncParams
} from '../../src/ingest/info64/sync'
import { addDays, endOfMonth, madridDateTime } from '../../src/lib/dates'

const candidate = (key: string, firstRound: string, lastRound = firstRound): EventTournament => ({
	key,
	type: 'individual',
	name: key,
	firstRound,
	lastRound
})

describe('selectPending', () => {
	const today = '2026-10-17'

	it('omite los torneos que aún no han empezado', () => {
		expect(selectPending([candidate('futuro', '2026-10-20')], [], today, false)).toEqual([])
	})

	it('incluye los torneos nuevos', () => {
		expect(selectPending([candidate('nuevo', '2026-10-01')], [], today, false)).toHaveLength(1)
	})

	it('sigue revisando hasta RECHECK_DAYS días después del final', () => {
		const end = '2026-10-10'
		const checked = [{ key: 't', endDate: end, gamesCheckedAt: '2026-10-16T05:00:00.000Z' }]
		expect(selectPending([candidate('t', '2026-10-05', end)], checked, today, false)).toHaveLength(1)
	})

	it('da por cerrado un torneo comprobado después de ese margen', () => {
		const end = '2026-09-01'
		const checkedAt = `${addDays(end, RECHECK_DAYS)}T05:00:00.000Z`
		const checked = [{ key: 't', endDate: end, gamesCheckedAt: checkedAt }]
		expect(selectPending([candidate('t', '2026-08-25', end)], checked, today, false)).toEqual([])
		expect(selectPending([candidate('t', '2026-08-25', end)], checked, today, true)).toHaveLength(1)
	})
})

describe('Info64SyncWorkflow', () => {
	it('sigue con los demás torneos si uno falla tras sus reintentos', async () => {
		// Pasos de mentira: sin pedir nada a info64, el torneo «roto» falla y el
		// «sano» devuelve lo justo para seguir. Los de la base se ejecutan.
		const steps: string[] = []
		const step = {
			do: async (name: string, ...rest: unknown[]) => {
				if (name === 'torneo roto') throw new Error('info64 no responde')
				steps.push(name)
				if (name.startsWith('torneo ')) return { id: 1, key: 'sano', broadcasts: [] }
				if (name.startsWith('clasificación ')) return true
				if (name.startsWith('partidas ')) return { games: 0, identified: 0, illegal: 0, source: null }
				return (rest.at(-1) as () => Promise<unknown>)()
			},
			sleep: async () => {}
		} as unknown as WorkflowStep
		const event = { payload: { from: '', to: '', keys: ['roto', 'sano'] } } as WorkflowEvent<Info64SyncParams>
		// El constructor de WorkflowEntrypoint sólo admite el contexto que crea el
		// runtime al lanzar una instancia: aquí, el prototipo con su env.
		const workflow: Info64SyncWorkflow = Object.assign(Object.create(Info64SyncWorkflow.prototype), { env })

		await workflow.run(event, step)

		expect(steps).toEqual(['pendientes', 'torneo sano', 'clasificación sano', 'partidas sano', 'totales'])
	})
})

describe('windowInstanceId', () => {
	it('las ventanas de sólo clasificación no chocan con las de la carga inicial', () => {
		expect(windowInstanceId('2014-01-01', '2014-01-31')).toBe('info64-2014-01-01-2014-01-31')
		expect(windowInstanceId('2014-01-01', '2014-01-31', 'only')).toBe('info64-clasificacion-2014-01-01-2014-01-31')
	})
})

describe('fechas', () => {
	it('suma días cruzando meses', () => {
		expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
	})

	it('da la hora local de España en verano y en invierno', () => {
		expect(madridDateTime(new Date('2026-10-18T19:33:00Z'))).toBe('2026-10-18 21:33')
		expect(madridDateTime(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-02 00:30')
	})

	it('calcula el final de una ventana de meses', () => {
		expect(endOfMonth('2026-02-01')).toBe('2026-02-28')
		expect(endOfMonth('2024-02-10')).toBe('2024-02-29')
		expect(endOfMonth('2013-01-01', 12)).toBe('2013-12-31')
	})
})
