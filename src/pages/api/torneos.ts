// Los torneos de info64 que encuentra la búsqueda de /torneos (findInfo64Tournaments),
// para los scripts de la web del club Eguidazu (eguidazu.com): proponen el
// enlace de clasificación de sus torneos sin buscar en info64. Los mismos
// parámetros que /torneos (q, desde, hasta, modalidad), empezados o no; un
// valor mal escrito da 400, en vez de ignorarse como en la web. Primero los que
// nombran el sitio buscado y después los más recientes, hasta 20; `mas`, si hay
// más (afina con las fechas). Los torneos de menores y los sensibles no están,
// porque no se guardan. Caché pública de una hora.
//
//   GET /api/torneos?q=alava%20absoluto&desde=2026-01-01
//   →  {"torneos":[{"info64":"cto-absoluto-inventado-2026","nombre":"Campeonato Absoluto Inventado 2026",
//        "ciudad":"Vitoria-Gasteiz","inicio":"2026-10-17","fin":"2026-11-28","equipos":false}],"mas":false}
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { badRequest } from '../../lib/api'
import { findInfo64Tournaments } from '../../lib/db/tournaments'
import { tournamentFilters } from '../../lib/params'

export const MAX_RESULTS = 20

export const GET: APIRoute = async ({ url }) => {
	const params = url.searchParams
	const { q, from, to, type } = tournamentFilters(params)
	const given = (name: string) => (params.get(name) ?? '').trim() !== ''
	if ((given('desde') && !from) || (given('hasta') && !to)) return badRequest('«desde» y «hasta» van como AAAA-MM-DD.')
	if (given('modalidad') && !type) return badRequest('«modalidad» es «individual» o «equipos».')
	const found = await findInfo64Tournaments(env.DB, { q, from, to, type }, MAX_RESULTS)
	if (!found) return badRequest('Falta «q», con alguna palabra de dos letras o más.')
	return Response.json(
		{
			torneos: found.tournaments.map((t) => ({
				info64: t.key,
				nombre: t.name,
				ciudad: t.city,
				inicio: t.startDate,
				fin: t.endDate,
				equipos: t.type === 'team'
			})),
			mas: found.more
		},
		{ headers: { 'Cache-Control': 'public, max-age=3600' } }
	)
}
