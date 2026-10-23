// Salud de la ingesta, para .github/workflows/vigilancia.yml (ver src/lib/salud.ts).
// Pública y sin caché: 200 si ninguna pasada da la alarma y 503 si alguna está
// caducada o con fallos, o si queda algún torneo sensible por revisar. Sólo
// dice el estado de cada pasada y de la revisión, sin recuentos ni fechas.
//
//   GET /api/estado  →  {"estado":"ok","pasadas":{"info64":"ok","emparejamientos":"ok","lichess":"ok","fide":"sin datos"},"sensibles":"ok"}
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { hasSensitivePending, isAlarm, loadHealth } from '../../lib/salud'

export const GET: APIRoute = async () => {
	const [runs, pending] = await Promise.all([loadHealth(env.DB), hasSensitivePending(env.DB)])
	const alarm = Object.values(runs).some(isAlarm) || pending
	return Response.json(
		{ estado: alarm ? 'fallo' : 'ok', pasadas: runs, sensibles: pending ? 'por revisar' : 'ok' },
		{ status: alarm ? 503 : 200, headers: { 'Cache-Control': 'no-store' } }
	)
}
