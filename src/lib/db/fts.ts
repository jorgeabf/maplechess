// Construcción de consultas FTS5 a partir de lo que escribe el usuario.
//
// Cada palabra se busca como prefijo ("guij" encuentra "Guijarro") y entre
// comillas, para que caracteres como - o : no se interpreten como operadores.
import { stripDiacritics } from '../chess/names'

/**
 * Palabras de búsqueda como prefijos FTS5, o null si no queda ninguna. Una
 * letra suelta sólo cuenta junto a una palabra más larga («j garcia»): sola,
 * «a» casaba con la mitad de las partidas y no encontraba nada útil, y era la
 * búsqueda más cara (unas 530.000 filas de D1).
 */
export function prefixTerms(text: string): string | null {
	const words = stripDiacritics(text)
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
	if (!words.some((w) => w.length > 1)) return null
	return words.map((w) => `"${w}"*`).join(' ')
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
