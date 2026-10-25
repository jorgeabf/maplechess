// Licencias y enlaces que hay que citar donde se muestran.
import { version } from 'stockfish/package.json'

/**
 * Código fuente del sitio. El JS que se sirve lleva chessground y chessops
 * (GPL-3.0): quien lo recibe tiene derecho al código. Lo enlazan el pie,
 * /acerca y /aviso-legal.
 */
export const SOURCE_CODE = 'https://github.com/jorgeabf/maplechess'

/** El texto de la GPL-3.0, en el repositorio: lo enlaza el aviso de copyright de /aviso-legal. */
export const SOURCE_LICENSE = `${SOURCE_CODE}/blob/main/LICENSE`

/** Versión del paquete `stockfish`: la del motor que se sirve (scripts/copy-engine.mjs). */
export const ENGINE_VERSION = version

/**
 * Código del motor que se sirve (GPL-3.0): la versión publicada de
 * stockfish.js de la que sale la build. El paquete de npm sólo trae lo
 * compilado; con la versión del paquete, el enlace cambia con el motor.
 */
export const ENGINE_SOURCE = `https://github.com/nmrugg/stockfish.js/releases/tag/v${ENGINE_VERSION}`

/**
 * Partidas de las retransmisiones de lichess: CC BY-SA 4.0
 * (https://database.lichess.org/#broadcasts). Pide citar la fuente, enlazar la
 * licencia, avisar de los cambios y publicar lo derivado con la misma licencia.
 */
export const CC_BY_SA = 'https://creativecommons.org/licenses/by-sa/4.0/deed.es'

/**
 * Aviso de las partidas de lichess en los PGN que se descargan o se copian: la
 * fuente, la licencia con su enlace y que se han cambiado (§3.a; la ingesta
 * pone el torneo, los nombres, los FIDE ID, el ELO y la apertura: buildGameRows),
 * y que lo derivado va con la misma licencia (§3.b).
 */
export const LICHESS_NOTICE = `Partida de una retransmisión de lichess.org, con licencia CC BY-SA 4.0 (${CC_BY_SA}). MapleChess ha completado o corregido sus cabeceras; esta versión tiene la misma licencia.`

/**
 * Cabeceras con la dirección en lichess, por orden de preferencia: las dos de
 * la partida (lo que se exporta de lichess y se sube a info64 sólo trae Site)
 * y la de la ronda.
 */
const LICHESS_HEADERS = ['GameURL', 'Site', 'BroadcastURL']
const LICHESS_HEADER = /^\[(GameURL|Site|BroadcastURL) "(https:\/\/lichess\.org\/[^"\\]*)"/gm

/**
 * Dirección en lichess del PGN guardado, o null si no es de lichess. Es lo que
 * dice si una partida es de lichess, para su aviso de licencia (licensedPgn)
 * y el crédito de su página.
 *
 * Se reconoce por sus cabeceras, que lichess pone en sus retransmisiones y la
 * ingesta conserva, y no por la fuente del torneo: así las descargas no leen
 * más filas, y también encuentra las de info64 que vienen de lichess. Hay
 * organizadores que suben allí lo que exportan de lichess, con su Site y su
 * análisis (el CE Absoluto 2025).
 *
 * El PGN guardado es el de makePgn (writeGame): las cabeceras, una línea en
 * blanco y las jugadas. Las jugadas no se miran: un enlace en un comentario no
 * dice de dónde es la partida.
 */
export function lichessUrl(pgn: string): string | null {
	const headersEnd = pgn.indexOf('\n\n')
	if (headersEnd === -1) return null
	const urls = new Map(
		Array.from(pgn.slice(0, headersEnd).matchAll(LICHESS_HEADER), ([, tag, url]): [string, string] => [tag, url])
	)
	return LICHESS_HEADERS.map((tag) => urls.get(tag)).find((url) => url !== undefined) ?? null
}

/**
 * CC BY 4.0: las partidas del archivo de la Federación Cántabra de Ajedrez (el
 * aviso legal de fcajedrez.es la da para todo lo publicado), y los municipios
 * del INE y los núcleos de población del IGN con los que se saca la provincia
 * de los torneos (data/lugares/). Pide citar la fuente, enlazar la licencia y
 * avisar de los cambios; no, publicar lo derivado con la misma.
 */
export const CC_BY = 'https://creativecommons.org/licenses/by/4.0/deed.es'

/** La relación de municipios del INE (data/lugares/municipios.tsv): la cita pide su fecha. */
export const INE_MUNICIPIOS = {
	url: 'https://www.ine.es/daco/daco42/codmun/26codmun.xlsx',
	date: '1 de enero de 2026'
}

/** Los núcleos de población del Nomenclátor del IGN (data/lugares/nucleos.tsv). */
export const IGN_NUCLEOS = 'https://api-features.ign.es/collections/nuc'

/**
 * Aviso de las partidas de la FCA en los PGN que se descargan o se copian: la
 * fuente, la licencia con su enlace y qué se ha cambiado (ingest/fca: el
 * torneo, las cabeceras y el FIDE ID de los jugadores, cruzado por el nombre).
 */
export const FCA_NOTICE = `Partida del archivo de la Federación Cántabra de Ajedrez (fcajedrez.es), con licencia CC BY 4.0 (${CC_BY}). MapleChess ha completado o corregido sus cabeceras y ha enlazado a los jugadores con su FIDE ID por el nombre.`

/** Cabecera con el archivo de la FCA (FCA_SITE en urls.ts) de la partida. */
const FCA_HEADER = /^\[Source "(https:\/\/www\.fcajedrez\.es\/[^"\\]*)"/m

/**
 * El archivo de la FCA del que sale la partida, o null si no es de la FCA. La
 * importación (ingest/fca) lo pone en la cabecera Source; como con lichessUrl,
 * así las descargas no leen el torneo.
 */
export function fcaUrl(pgn: string): string | null {
	const headersEnd = pgn.indexOf('\n\n')
	if (headersEnd === -1) return null
	return FCA_HEADER.exec(pgn.slice(0, headersEnd))?.[1] ?? null
}

/**
 * El PGN guardado tal como se entrega: si es de lichess (lichessUrl) o de la
 * FCA (fcaUrl), con su aviso de licencia en un comentario antes de la primera
 * jugada. Los lectores de PGN conservan los comentarios; una cabecera
 * inventada, no siempre.
 */
export function licensedPgn(pgn: string): string {
	const notice = lichessUrl(pgn) !== null ? LICHESS_NOTICE : fcaUrl(pgn) !== null ? FCA_NOTICE : null
	if (notice === null) return pgn
	const movetext = pgn.indexOf('\n\n') + 2
	return `${pgn.slice(0, movetext)}{ ${notice} } ${pgn.slice(movetext)}`
}
