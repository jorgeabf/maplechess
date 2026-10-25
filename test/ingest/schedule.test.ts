import { describe, expect, it } from 'vitest'
import { msUntilInfo64Hours } from '../../src/ingest/info64/sync'
import { CRON_FIDE_MONTHLY, CRON_INFO64_DAILY, CRON_LICHESS_DAILY, runScheduled } from '../../src/ingest/schedule'
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

const MINUTE = 60_000

describe('runScheduled', () => {
	it('lanza la diaria de info64 a las 00:00 UTC, con la fecha de ese día', async () => {
		expect(await info64Instances(CRON_INFO64_DAILY, '2026-10-26T00:00:00Z')).toEqual(['info64-diario-2026-10-26'])
	})

	it('usa las mismas expresiones que wrangler.jsonc', () => {
		const crons = JSON.parse(/"crons":\s*(\[[^\]]*\])/.exec(wranglerConfig)?.[1] ?? '[]') as string[]
		expect(crons.sort()).toEqual([CRON_INFO64_DAILY, CRON_LICHESS_DAILY, CRON_FIDE_MONTHLY].sort())
	})
})

describe('msUntilInfo64Hours', () => {
	it('la diaria cae siempre dentro de la franja: a la 01:00 en invierno y a las 02:00 en verano', () => {
		expect(msUntilInfo64Hours(new Date('2026-10-26T00:00:00Z'))).toBe(0)
		expect(msUntilInfo64Hours(new Date('2026-07-01T00:00:00Z'))).toBe(0)
	})

	it('después de las 05:00 de Madrid espera a las 00:05 del día siguiente', () => {
		// 19:30 de Madrid en invierno (UTC+1): faltan 4 h 35 min.
		expect(msUntilInfo64Hours(new Date('2026-10-26T18:30:00Z'))).toBe((4 * 60 + 35) * MINUTE)
		// 05:00 en punto de Madrid en verano (UTC+2): ya no empieza.
		expect(msUntilInfo64Hours(new Date('2026-07-01T03:00:00Z'))).toBe((19 * 60 + 5) * MINUTE)
	})

	it('antes de las 00:05 espera unos minutos, y cuenta los segundos', () => {
		expect(msUntilInfo64Hours(new Date('2026-10-25T23:02:30Z'))).toBe(2 * MINUTE + 30_000)
	})
})
