// Nombres que se guardan. Las fuentes copian el de la lista FIDE, que
// distingue a los homónimos con su año de nacimiento («Apellidos, Nombre
// 2009»): info64 en el ranking, las plantillas y los emparejamientos, y de ahí
// las partidas; lichess en sus jugadores y cabeceras. El año de quien puede ser
// menor no se guarda en ningún nombre, venga de donde venga. Y de quien ha
// pedido que se le retire no se guarda ni el nombre (RETIRED_NAME).
import { normalizeName } from '../lib/chess/names'
import { setPgnTags } from '../lib/chess/pgn'
import { madridYear } from '../lib/dates'
import { mayBeMinor } from '../lib/db/players'
import { homonymYear, withoutHomonymYear } from '../lib/format'

/**
 * El nombre tal como se guarda en `year`: sin el año de homónimo si es el de
 * un posible menor (mayBeMinor). El año del nombre es el de nacimiento, así
 * que no hace falta el FIDE ID. Los adultos lo conservan, como en la lista FIDE.
 *
 * Se aplica al escribir, no al leer de la fuente: las partidas se cruzan con
 * los participantes por el nombre completo, y sin el año dos homónimos del
 * mismo torneo serían el mismo nombre y ninguno recibiría su FIDE ID.
 */
export function publicName(name: string, year = madridYear(new Date())): string {
	return mayBeMinor(homonymYear(name), year) ? withoutHomonymYear(name) : name
}

/** Cabecera White o Black de un PGN, con su valor escapado (\" y \\). */
const NAME_HEADER = /^\[(White|Black) "((?:[^"\\]|\\.)*)"\]$/gm

/**
 * El PGN con los nombres de sus cabeceras White y Black como publicName. Sólo
 * cambian esas dos líneas: el resto del texto queda igual, byte a byte.
 */
export function publicPgnNames(pgn: string, year = madridYear(new Date())): string {
	return pgn.replace(NAME_HEADER, (line, tag: string, escaped: string) => {
		const name = escaped.replace(/\\(.)/g, '$1')
		const clean = publicName(name, year)
		return clean === name ? line : `[${tag} "${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
	})
}

// --- Retirada de datos (tabla retiradas, migración 0010) ---

/**
 * Nombre con el que se guarda a quien ha pedido que se le retire: en
 * participantes, partidas y emparejamientos, sin FIDE ID ni título.
 */
export const RETIRED_NAME = 'Jugador retirado'

/** Personas retiradas: sus FIDE ID y sus nombres en forma de comparar (nameKey). */
export interface Retired {
	ids: ReadonlySet<number>
	names: ReadonlySet<string>
}

/**
 * Forma de comparar dos nombres de una misma persona: canónica y sin el año de
 * los homónimos, que un menor recupera al dejar de serlo. La usan la retirada y
 * la rectificación.
 */
export function nameKey(name: string): string {
	return normalizeName(withoutHomonymYear(name))
}

/**
 * ¿Es este jugador una persona retirada? Con FIDE ID, sólo por él: un
 * homónimo con otro ID es otra persona. Sin él, por el nombre: en la duda, se
 * retira (es lo que protege a quien lo pidió).
 */
export function isRetired(retired: Retired, fideId: number | null, name: string): boolean {
	return fideId !== null ? retired.ids.has(fideId) : retired.names.has(nameKey(name))
}

/**
 * El PGN con el jugador de ese color anonimizado: su cabecera de nombre pasa
 * a RETIRED_NAME y se quitan las de FIDE ID y título. El resto del texto queda
 * igual, byte a byte.
 */
export function anonymizePgn(pgn: string, color: 'White' | 'Black'): string {
	return setPgnTags(pgn, { [color]: RETIRED_NAME, [`${color}FideId`]: null, [`${color}Title`]: null })
}
