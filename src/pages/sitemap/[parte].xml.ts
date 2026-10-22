// Un trozo del sitemap: /sitemap/paginas.xml o /sitemap/{jugadores|torneos|partidas}-{n}.xml,
// con hasta 50.000 URL. Uno que no está en el índice da 404.
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { sitemapCounts, sitemapIds } from '../../lib/db/sitemap'
import { notFound } from '../../lib/pgn-response'
import { parsePart, STATIC_PAGES, urlSet, xmlResponse } from '../../lib/sitemap'

export const GET: APIRoute = async ({ params, site, url }) => {
	const part = parsePart(params.parte)
	if (!part) return notFound()
	const base = site ?? url
	if (part.kind === 'paginas') return xmlResponse(urlSet(STATIC_PAGES, base))
	if (part.n > (await sitemapCounts(env.DB))[part.kind]) return notFound()
	const ids = await sitemapIds(env.DB, part.kind, part.n)
	return xmlResponse(urlSet(ids.map((id) => `/${part.kind}/${id}`), base))
}
