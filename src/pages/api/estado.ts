// Salud de la ingesta, para .github/workflows/vigilancia.yml (ver src/lib/salud.ts).
// Pública y sin caché: 200 si ninguna pasada da la alarma y 503 si alguna está
// caducada o con fallos. Sólo dice el estado de cada pasada, sin recuentos ni
// fechas.
//
//   GET /api/estado  →  {"estado":"ok","pasadas":{"info64":"ok","emparejamientos":"ok","lichess":"ok","fide":"sin datos"}}
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { isAlarm, loadHealth } from '../../lib/salud'

export const GET: APIRoute = async () => {
	const runs = await loadHealth(env.DB)
	const alarm = Object.values(runs).some(isAlarm)
	return Response.json(
		{ estado: alarm ? 'fallo' : 'ok', pasadas: runs },
		{ status: alarm ? 503 : 200, headers: { 'Cache-Control': 'no-store' } }
	)
}
