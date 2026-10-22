import { describe, expect, it } from 'vitest'
import {
	CRON_FIDE_MONTHLY,
	CRON_INFO64_DAILY,
	CRON_INFO64_PAIRINGS,
	CRON_LICHESS_DAILY,
	runScheduled
} from '../../src/ingest/schedule'
import wranglerConfig from '../../wrangler.jsonc?raw'

/** Ids de las instancias de INFO64_SYNC que lanza el cron a esa hora UTC. */
async function info64Instances(cron: string, utc: string): Promise<string[]> {
	const ids: string[] = []
	const create = async ({ id }: { id: string }) => {
		ids.push(id)
	}
	const env = { INFO64_SYNC: { create } } as unknown as Env
	const controller = { cron, scheduledTime: Date.parse(utc), noRetry() {} } as ScheduledController
	await runScheduled(controller, env)
	return ids
}

describe('runScheduled', () => {
	it('lanza los emparejamientos a las 15:00 y las 22:00 de Madrid en verano', async () => {
		expect(await info64Instances(CRON_INFO64_PAIRINGS, '2026-10-24T13:00:00Z')).toEqual([
			'info64-emparejamientos-2026-10-24-15'
		])
		expect(await info64Instances(CRON_INFO64_PAIRINGS, '2026-10-24T14:00:00Z')).toEqual([])
		expect(await info64Instances(CRON_INFO64_PAIRINGS, '2026-10-24T20:00:00Z')).toEqual([
			'info64-emparejamientos-2026-10-24-22'
		])
		expect(await info64Instances(CRON_INFO64_PAIRINGS, '2026-10-24T21:00:00Z')).toEqual([])
	})

	it('y en invierno, una hora UTC más tarde', async () => {
		expect(await info64Instances(CRON_INFO64_PAIRINGS, '2026-10-26T13:00:00Z')).toEqual([])
		expect(await info64Instances(CRON_INFO64_PAIRINGS, '2026-10-26T14:00:00Z')).toEqual([
			'info64-emparejamientos-2026-10-26-15'
		])
		expect(await info64Instances(CRON_INFO64_PAIRINGS, '2026-10-26T20:00:00Z')).toEqual([])
		expect(await info64Instances(CRON_INFO64_PAIRINGS, '2026-10-26T21:00:00Z')).toEqual([
			'info64-emparejamientos-2026-10-26-22'
		])
	})

	it('usa las mismas expresiones que wrangler.jsonc', () => {
		const crons = JSON.parse(/"crons":\s*(\[[^\]]*\])/.exec(wranglerConfig)?.[1] ?? '[]') as string[]
		expect(crons.sort()).toEqual([CRON_INFO64_DAILY, CRON_INFO64_PAIRINGS, CRON_LICHESS_DAILY, CRON_FIDE_MONTHLY].sort())
	})
})
