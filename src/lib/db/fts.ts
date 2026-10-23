// Construcción de consultas FTS5 a partir de lo que escribe el usuario.
//
// Cada palabra se busca como prefijo ("guij" encuentra "Guijarro") y entre
// comillas, para que caracteres como - o : no se interpreten como operadores.
import { words } from '../chess/names'
import { placeAt } from '../toponimos'

/** Una o varias palabras seguidas, la última como prefijo. */
const prefix = (phrase: string[]) => `"${phrase.join(' ')}"*`

/**
 * Palabras de búsqueda como prefijos FTS5, o null si no queda ninguna. Una
 * letra suelta sólo cuenta junto a una palabra más larga («j garcia»): sola,
 * «a» casaba con la mitad de las partidas y no encontraba nada útil, y era la
 * búsqueda más cara (unas 530.000 filas de D1).
 */
export function prefixTerms(text: string): string | null {
	const query = words(text)
	if (!query.some((w) => w.length > 1)) return null
	return query.map((w) => prefix([w])).join(' ')
}

/**
 * Como prefixTerms, pero una provincia o una comunidad se busca por todos sus
 * nombres (`toponimos.ts`): «alava» encuentra también «Alavesa» y «Araba».
 * Para los nombres de los torneos.
 */
export function placeTerms(text: string): string | null {
	const query = words(text)
	if (!query.some((w) => w.length > 1)) return null
	const terms: string[] = []
	for (let i = 0; i < query.length; ) {
		const place = placeAt(query, i)
		if (place) {
			const names = place.names.map(prefix)
			terms.push(names.length > 1 ? `(${names.join(' OR ')})` : names[0])
			i += place.length
		} else {
			terms.push(prefix([query[i]]))
			i++
		}
	}
	// AND explícito: tras un paréntesis, FTS5 no admite el implícito.
	return terms.join(' AND ')
}

/** Restringe los términos a una columna: `col : (t1 t2)`. */
export function inColumn(column: string, terms: string): string {
	return `${column} : (${terms})`
}

export type Color = 'white' | 'black' | 'any'

/**
 * Consulta sobre games_fts para "jugador" y "rival". Cada nombre tiene que
 * caer entero en una misma columna, para no mezclar palabras de las blancas
 * con palabras de las negras.
 */
export function gamesNameQuery(player: string, opponent: string, color: Color): string | null {
	const p = prefixTerms(player)
	const o = prefixTerms(opponent)
	const side = (pCol: string, oCol: string) =>
		[p && inColumn(pCol, p), o && inColumn(oCol, o)].filter(Boolean).join(' AND ')

	if (!p && !o) return null
	if (color === 'white') return side('white_name', 'black_name')
	if (color === 'black') return side('black_name', 'white_name')
	return `(${side('white_name', 'black_name')}) OR (${side('black_name', 'white_name')})`
}
