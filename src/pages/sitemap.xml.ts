// Índice del sitemap, el que enlaza robots.txt: las páginas fijas y los trozos
// de jugadores, torneos y partidas (sitemap/[parte].xml.ts). Lee 3 filas.
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { sitemapCounts } from '../lib/db/sitemap'
import { sitemapIndex, sitemapParts, xmlResponse } from '../lib/sitemap'

export const GET: APIRoute = async ({ site, url }) =>
	xmlResponse(sitemapIndex(sitemapParts(await sitemapCounts(env.DB)), site ?? url))
