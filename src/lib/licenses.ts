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
