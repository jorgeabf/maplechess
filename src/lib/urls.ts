// URL de las fuentes (info64 y lichess) que se enlazan desde el torneo y la partida.

/** Sitios de las fuentes, siempre por https. */
const SOURCES = ['https://info64.org/', 'https://lichess.org/']

/**
 * La URL si es de una fuente; si no, null, y no se enlaza. Las guarda la
 * ingesta, pero algunas salen de la API de lichess: así ni un `javascript:` ni
 * otro sitio llegan nunca a un href. Con la barra tras el dominio, lo que
 * sigue es ya la ruta («https://lichess.org/@evil.com» sigue en lichess).
 */
export function sourceUrl(url: string | null | undefined): string | null {
	return url && SOURCES.some((site) => url.startsWith(site)) ? url : null
}
