// Tareas programadas (Cron Triggers). Las expresiones tienen que coincidir
// literalmente con las de wrangler.jsonc.
import { addDays, isoDate, madridDateTime } from '../lib/dates'
import { dailyInstanceId } from './info64/sync'

export const CRON_INFO64_DAILY = '0 5 * * *'
// Los crons van en UTC. Éste salta a las dos horas UTC que pueden ser cada una
// de PAIRINGS_HOURS (en invierno y en verano), y sólo lanza la pasada la que lo es.
export const CRON_INFO64_PAIRINGS = '0 13,14,20,21 * * *'
export const CRON_LICHESS_DAILY = '30 6 * * *'
export const CRON_FIDE_MONTHLY = '0 6 3 * *'

/** Ventana diaria de info64: rondas de los últimos 60 días. */
const INFO64_DAILY_WINDOW_DAYS = 60

/**
 * Horas de Madrid de las pasadas de sólo emparejamientos. A las 15:00, la ronda
 * de la tarde de los días con dos: la de la mañana suele empezar a las 10:00 y
 * acabar hacia las 14:00, y la de la tarde empieza entre las 16:00 y las 17:00.
 * A las 22:00, la de la mañana siguiente, para prepararla la noche antes.
 */
const PAIRINGS_HOURS = ['15', '22']

export async function runScheduled(controller: ScheduledController, env: Env): Promise<void> {
	const today = isoDate(new Date(controller.scheduledTime))
	switch (controller.cron) {
		case CRON_INFO64_DAILY:
			await env.INFO64_SYNC.create({
				id: dailyInstanceId(today),
				params: { from: addDays(today, -INFO64_DAILY_WINDOW_DAYS), to: today, pairings: 'also' }
			})
			break
		case CRON_INFO64_PAIRINGS: {
			const local = madridDateTime(new Date(controller.scheduledTime))
			const hour = local.slice(11, 13)
			if (!PAIRINGS_HOURS.includes(hour)) break
			await env.INFO64_SYNC.create({
				id: `info64-emparejamientos-${local.slice(0, 10)}-${hour}`,
				params: { from: today, to: today, pairings: 'only' }
			})
			break
		}
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
