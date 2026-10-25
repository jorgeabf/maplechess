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

/** Un sitio de la búsqueda de torneos: dónde se juegan y la palabra escrita, para el nombre. */
export interface PlaceTerm {
	/** Códigos del INE de las provincias y las comunidades (tournaments.provincia y comunidad). */
	provinces: string[]
	communities: string[]
	/** La palabra tal como se ha escrito, en el nombre del torneo (FTS). */
	name: string
}

/**
 * La búsqueda de torneos: las palabras, como prefijos en el nombre o en la
 * ciudad (`text`), y los sitios (`places`). Una provincia o una comunidad
 * (`toponimos.ts`) se busca por dónde se juega el torneo, que la ingesta saca
 * de su ciudad o, si no, de su nombre (`lugares.ts`), y por la palabra tal
 * como se escribe en el nombre: «memorial gallego» encuentra el Memorial
 * Gallego de Gijón, y «galicia», no. Null si no queda ninguna palabra.
 */
export function tournamentTerms(text: string): { text: string | null; places: PlaceTerm[] } | null {
	const query = words(text)
	if (!query.some((w) => w.length > 1)) return null
	const terms: string[] = []
	const places: PlaceTerm[] = []
	for (let i = 0; i < query.length; ) {
		const found = placeAt(query, i)
		if (found) {
			// «valenciana» es de la provincia y de la comunidad: basta la comunidad.
			const communities = new Set(found.places.filter((p) => p.kind === 'comunidad').map((p) => p.code))
			const provinces = found.places.filter((p) => p.kind === 'provincia' && !communities.has(p.community))
			places.push({
				provinces: provinces.map((p) => p.code),
				communities: [...communities],
				name: inColumn('name', prefix(query.slice(i, i + found.length)))
			})
			i += found.length
		} else {
			terms.push(prefix([query[i]]))
			i++
		}
	}
	return { text: terms.length > 0 ? terms.join(' ') : null, places }
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
