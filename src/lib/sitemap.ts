// Sitemap: el índice (/sitemap.xml) y sus trozos (/sitemap/{parte}.xml). Las
// consultas, en db/sitemap.ts.
import { canonicalHref } from './urls'

/** Máximo de URL por trozo, el del estándar (sitemaps.org). */
export const SITEMAP_SIZE = 50_000

/** Trozos que salen de D1. Cada uno es también la ruta de sus páginas: /jugadores/{id}. */
export const SITEMAP_KINDS = ['jugadores', 'torneos', 'partidas'] as const
export type SitemapKind = (typeof SITEMAP_KINDS)[number]

/** Un trozo: las páginas fijas o el n-ésimo (desde 1) de un tipo. */
export type SitemapPart = { kind: 'paginas' } | { kind: SitemapKind; n: number }

/** Páginas fijas que se indexan; las búsquedas no (robots.txt). */
export const STATIC_PAGES = ['/', '/jugadores', '/partidas', '/torneos', '/acerca', '/privacidad', '/aviso-legal']

export function partName(part: SitemapPart): string {
	return part.kind === 'paginas' ? part.kind : `${part.kind}-${part.n}`
}

/** El trozo de un nombre («partidas-3»); null si no es ninguno. */
export function parsePart(name: string | undefined): SitemapPart | null {
	if (name === 'paginas') return { kind: 'paginas' }
	const match = /^(jugadores|torneos|partidas)-([1-9]\d{0,5})$/.exec(name ?? '')
	return match ? { kind: match[1] as SitemapKind, n: Number(match[2]) } : null
}

/** Todos los trozos, con `counts` trozos de cada tipo (sitemapCounts). */
export function sitemapParts(counts: Record<SitemapKind, number>): SitemapPart[] {
	return [
		{ kind: 'paginas' },
		...SITEMAP_KINDS.flatMap((kind) => Array.from({ length: counts[kind] }, (_, i) => ({ kind, n: i + 1 })))
	]
}

const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => XML_ENTITIES[c])

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n'
const XMLNS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'

/** Índice con los trozos, en el dominio (`site`). */
export function sitemapIndex(parts: SitemapPart[], site: URL): string {
	const entries = parts.map(
		(part) => `<sitemap><loc>${escapeXml(canonicalHref(`/sitemap/${partName(part)}.xml`, site))}</loc></sitemap>\n`
	)
	return `${XML_HEAD}<sitemapindex ${XMLNS}>\n${entries.join('')}</sitemapindex>\n`
}

/**
 * Trozo con las páginas de `paths`, en su URL canónica: la misma que da Base.
 * Sin lastmod: no hay una fecha fiable de cambio (games_checked_at cambia
 * aunque no cambie nada). Google ignora changefreq y priority.
 */
export function urlSet(paths: Iterable<string>, site: URL): string {
	const entries: string[] = []
	for (const path of paths) entries.push(`<url><loc>${escapeXml(canonicalHref(path, site))}</loc></url>\n`)
	return `${XML_HEAD}<urlset ${XMLNS}>\n${entries.join('')}</urlset>\n`
}

/** Respuesta XML. No depende de la cookie yo: se puede guardar una hora. */
export function xmlResponse(body: string): Response {
	return new Response(body, {
		headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
	})
}
