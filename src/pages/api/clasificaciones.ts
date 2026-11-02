// El primero de la clasificación guardada de unos torneos de info64
// (getFirstPlaces), para los scripts de la web del club Eguidazu
// (eguidazu.com): anota sus campeones sin leer info64. Pública: sólo lo que
// enseña la página de cada torneo, y sin nombre ni FIDE ID de quien puede ser
// menor o se ha retirado. Los torneos que no tienen clasificación aquí (no
// guardados, de menores, sensibles) no salen. El slug, como en el enlace de
// info64: los de equipos, con «team/». Hasta 50 por petición; caché pública de
// una hora.
//
//   GET /api/clasificaciones?info64=cto-individual-inventado-2025,team/liga-inventada-2026
//   →  {"torneos":[{"info64":"cto-individual-inventado-2025","final":true,"ronda":9,"rondas":9,
//        "primero":{"titulo":"FM","nombre":"Apellido, Nombre","fide":2200000}},
//       {"info64":"team/liga-inventada-2026","final":false,"ronda":null,"rondas":7,"primero":{"equipo":"Club Inventado"}}]}
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { badRequest, listParam } from '../../lib/api'
import { madridDate } from '../../lib/dates'
import { getFirstPlaces } from '../../lib/db/standings'

export const MAX_TOURNAMENTS = 50

export const GET: APIRoute = async ({ url }) => {
	const slugs = listParam(url.searchParams, 'info64', MAX_TOURNAMENTS, /^(team\/)?[\w-]{1,200}$/)
	if ('error' in slugs) return badRequest(slugs.error)
	const places = await getFirstPlaces(env.DB, slugs.values, madridDate(new Date()))
	return Response.json(
		{
			torneos: places.map(({ slug, final, round, rounds, first }) => ({
				info64: slug,
				final,
				ronda: round,
				rondas: rounds,
				primero: 'team' in first ? { equipo: first.team } : { titulo: first.title, nombre: first.name, fide: first.fideId }
			}))
		},
		{ headers: { 'Cache-Control': 'public, max-age=3600' } }
	)
}
