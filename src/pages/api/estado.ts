// Salud de la ingesta, para .github/workflows/vigilancia.yml (ver src/lib/salud.ts).
// Pública y sin caché: 200 si ninguna pasada da la alarma y 503 si alguna está
// caducada o con fallos, si queda algún torneo sensible por revisar o si hay
// alguna rectificación sin aplicar. Sólo dice el estado de cada pasada y de las
// revisiones, sin recuentos ni fechas.
//
//   GET /api/estado  →  {"estado":"ok","pasadas":{"info64":"ok","emparejamientos":"ok","lichess":"ok","fide":"sin datos"},"sensibles":"ok","rectificaciones":"ok"}
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { hasRectificationsPending, hasSensitivePending, isAlarm, loadHealth } from '../../lib/salud'

export const GET: APIRoute = async () => {
	const [runs, sensitive, rectifications] = await Promise.all([
		loadHealth(env.DB),
		hasSensitivePending(env.DB),
		hasRectificationsPending(env.DB)
	])
	const alarm = Object.values(runs).some(isAlarm) || sensitive || rectifications
	return Response.json(
		{
			estado: alarm ? 'fallo' : 'ok',
			pasadas: runs,
			sensibles: sensitive ? 'por revisar' : 'ok',
			rectificaciones: rectifications ? 'por revisar' : 'ok'
		},
		{ status: alarm ? 503 : 200, headers: { 'Cache-Control': 'no-store' } }
	)
}
