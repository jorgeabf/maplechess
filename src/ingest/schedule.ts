// Tareas programadas (Cron Triggers). Las expresiones tienen que coincidir
// literalmente con las de wrangler.jsonc.
import { addDays, isoDate } from '../lib/dates'
import { dailyInstanceId } from './info64/sync'

// info64 pide que su robot le consulte sólo de madrugada (INFO64_HOURS en
// info64/sync.ts). Los crons van en UTC: a las 00:00 UTC son la 01:00 en
// invierno y las 02:00 en verano, y la diaria tarda unos 20 minutos. Trae
// también los emparejamientos de los próximos días: los de la ronda de la
// mañana se publican casi siempre la noche antes.
export const CRON_INFO64_DAILY = '0 0 * * *'
export const CRON_LICHESS_DAILY = '30 6 * * *'
export const CRON_FIDE_MONTHLY = '0 6 3 * *'

/** Ventana diaria de info64: rondas de los últimos 60 días. */
const INFO64_DAILY_WINDOW_DAYS = 60

export async function runScheduled(controller: ScheduledController, env: Env): Promise<void> {
	const today = isoDate(new Date(controller.scheduledTime))
	switch (controller.cron) {
		case CRON_INFO64_DAILY:
			await env.INFO64_SYNC.create({
				id: dailyInstanceId(today),
				params: { from: addDays(today, -INFO64_DAILY_WINDOW_DAYS), to: today, pairings: 'also' }
			})
			break
		// Después de la de info64, que también pide a lichess: nunca dos a la vez
		// (si aún no ha terminado, la de lichess la espera).
		case CRON_LICHESS_DAILY:
			await env.LICHESS_SYNC.create({ id: `lichess-diario-${today}`, params: {} })
			break
		case CRON_FIDE_MONTHLY:
			await env.FIDE_SYNC.create({ id: `fide-${today}`, params: {} })
			break
		default:
			console.warn(`[cron] expresión sin tarea: ${controller.cron}`)
	}
}
