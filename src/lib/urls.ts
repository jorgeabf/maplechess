// URL de las fuentes (info64, lichess, la Federación Cántabra y SICHESS) que se
// enlazan desde el torneo y la partida, y URL canónica de las páginas.

/**
 * URL canónica de una página: la ruta sobre el dominio (`site` en
 * astro.config.mjs), sin query y sin barra final salvo en la portada. Se
 * asigna la ruta en vez de resolverla: «//otro.sitio» resuelto daría otro
 * dominio.
 */
export function canonicalHref(pathname: string, site: URL): string {
	const url = new URL(site)
	url.pathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
	return url.href
}

/** Web de la Federación Cántabra de Ajedrez, de cuyo archivo salen los torneos con source 'fca' (ingest/fca). */
export const FCA_SITE = 'https://www.fcajedrez.es/'

/** Donde la FEDA retransmite sus campeonatos: las partidas con games_source 'sichess' (ingest/sichess). */
export const SICHESS_SITE = 'https://sichess.com/'

/** Sitios de las fuentes, siempre por https. */
const SOURCES = ['https://info64.org/', 'https://lichess.org/', FCA_SITE, SICHESS_SITE]

/** Cómo se nombra la fuente en los textos («Ver en …»): la de la FCA, por su web. */
export function sourceName(source: string): string {
	return source === 'fca' ? 'fcajedrez.es' : source
}

/**
 * La URL si es de una fuente; si no, null, y no se enlaza. Las guarda la
 * ingesta, pero algunas salen de la API de lichess: así ni un `javascript:` ni
 * otro sitio llegan nunca a un href. Con la barra tras el dominio, lo que
 * sigue es ya la ruta («https://lichess.org/@evil.com» sigue en lichess).
 */
export function sourceUrl(url: string | null | undefined): string | null {
	return url && SOURCES.some((site) => url.startsWith(site)) ? url : null
}
