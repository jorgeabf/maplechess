// Rondas ya emparejadas que aún no han empezado (getPairedRounds), para el build
// de la web de la Federación Alavesa (fadaajedrez.com): avisa en su portada de
// los emparejamientos en cuanto info64 los publica. Pública y sin datos de
// nadie: el torneo (su slug en info64), la ronda, su hora local y cuántas
// mesas tiene. Una entrada por torneo; sólo los individuales tienen.
//
// 503 si la pasada de emparejamientos da la alarma (caducada o con fallos, como
// en /api/estado): lo guardado puede no ser lo publicado, y la FADA vuelve a
// deducir la ronda de las fechas. Los datos cambian una vez por noche: caché
// pública de cinco minutos, y el 503 sin caché.
//
//   GET /api/emparejamientos  →  {"rondas":[{"info64":"cto-individual-preferente-alavesa-2026","ronda":4,"empieza":"2026-11-07 16:00","mesas":7}]}
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { getPairedRounds } from '../../lib/db/pairings'
import { isAlarm, loadHealth } from '../../lib/salud'

export const GET: APIRoute = async () => {
	const [runs, rounds] = await Promise.all([loadHealth(env.DB), getPairedRounds(env.DB)])
	if (isAlarm(runs.emparejamientos)) {
		return Response.json({ emparejamientos: runs.emparejamientos }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
	}
	return Response.json(
		{ rondas: rounds.map((r) => ({ info64: r.slug, ronda: r.round, empieza: r.startsAt, mesas: r.boards })) },
		{ headers: { 'Cache-Control': 'public, max-age=300' } }
	)
}
