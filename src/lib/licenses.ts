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

/** Cabeceras con la dirección de la partida o de la retransmisión en lichess. */
const LICHESS_HEADER = /^\[(?:Site|BroadcastURL|GameURL) "https:\/\/lichess\.org\//m

/**
 * El PGN guardado tal como se entrega: si es de lichess, con LICHESS_NOTICE en
 * un comentario antes de la primera jugada. Los lectores de PGN conservan los
 * comentarios; una cabecera inventada, no siempre.
 *
 * Se reconoce por sus cabeceras, que lichess pone en sus retransmisiones y la
 * ingesta conserva, y no por la fuente del torneo: así no lee más filas, y
 * también encuentra las de info64 que vienen de lichess. Hay organizadores que
 * suben allí lo que exportan de lichess, con su Site y su análisis (el CE
 * Absoluto 2025).
 *
 * El PGN guardado es el de makePgn (writeGame): las cabeceras, una línea en
 * blanco y las jugadas.
 */
export function licensedPgn(pgn: string): string {
	const headersEnd = pgn.indexOf('\n\n')
	if (headersEnd === -1 || !LICHESS_HEADER.test(pgn.slice(0, headersEnd))) return pgn
	const movetext = headersEnd + 2
	return `${pgn.slice(0, movetext)}{ ${LICHESS_NOTICE} } ${pgn.slice(movetext)}`
}
