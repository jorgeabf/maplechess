// Provincias, comunidades y ciudades autónomas, con su código del INE y sus
// otros nombres. Los organizadores nombran el mismo sitio de varias formas:
// «Cto de Alava» y «Cto Individual Alavesa», «Campeonato Gallego» y
// «Campionato Galego», «Ourense» y «Orense», «Euskadi». Sirve para:
// - reconocer el sitio que se busca en /torneos (`placeAt`, en `db/fts.ts`);
// - saber dónde se juega un torneo cuya ciudad no lo dice, por su nombre
//   (`placesInName`), y la provincia o la comunidad que nombra su ciudad
//   («Bormujos (Sevilla)», en `lugares.ts`).
import { words } from './chess/names'

export interface Place {
	kind: 'provincia' | 'comunidad'
	/** Código del INE: de la provincia (01–52) o de la comunidad (01–19). */
	code: string
	/** La comunidad de la provincia; la de una comunidad, ella misma. */
	community: string
	/** El topónimo y los nombres cooficiales y antiguos, en palabras. */
	names: string[][]
	/** Los gentilicios, en palabras. */
	gentilics: string[][]
}

/**
 * Una provincia por línea: su código, el de su comunidad, sus nombres y sus
 * gentilicios. De las comunidades de una sola provincia, sus nombres y el
 * gentilicio en su lengua si los organizadores lo usan van con la provincia.
 */
const PROVINCES: [string, string, string, string][] = [
	['01', '16', 'Álava, Araba', 'alavés, alavesa'],
	['02', '08', 'Albacete', 'albaceteño, albaceteña, albacetense'],
	['03', '10', 'Alicante, Alacant', 'alicantino, alicantina'],
	['04', '01', 'Almería', 'almeriense'],
	['33', '03', 'Asturias, Principado de Asturias, Principado', 'asturiano, asturiana'],
	['05', '07', 'Ávila', 'abulense'],
	['06', '11', 'Badajoz', 'pacense, badajocense'],
	['07', '04', 'Islas Baleares, Illes Balears, Baleares, Balears', 'balear'],
	['08', '09', 'Barcelona', 'barcelonés, barcelonesa'],
	['48', '16', 'Bizkaia, Vizcaya', 'vizcaíno, vizcaína'],
	['09', '07', 'Burgos', 'burgalés, burgalesa'],
	['10', '11', 'Cáceres', 'cacereño, cacereña'],
	['11', '01', 'Cádiz', 'gaditano, gaditana'],
	['39', '06', 'Cantabria', 'cántabro, cántabra'],
	['12', '10', 'Castellón, Castelló', 'castellonense'],
	['13', '08', 'Ciudad Real', 'ciudadrealeño, ciudadrealeña'],
	['14', '01', 'Córdoba', 'cordobés, cordobesa'],
	['15', '12', 'A Coruña, La Coruña, Coruña', 'coruñés, coruñesa'],
	['16', '08', 'Cuenca', 'conquense'],
	['20', '16', 'Gipuzkoa, Guipúzcoa', 'guipuzcoano, guipuzcoana'],
	['17', '09', 'Girona, Gerona', 'gerundense'],
	['18', '01', 'Granada', 'granadino, granadina'],
	['19', '08', 'Guadalajara', 'guadalajareño, guadalajareña'],
	['21', '01', 'Huelva', 'onubense'],
	['22', '02', 'Huesca', 'oscense'],
	['23', '01', 'Jaén', 'jiennense, giennense'],
	['24', '07', 'León', 'leonés, leonesa'],
	['25', '09', 'Lleida, Lérida', 'leridano, leridana, ilerdense'],
	['27', '12', 'Lugo', 'lucense'],
	['28', '13', 'Madrid, Comunidad de Madrid', 'madrileño, madrileña'],
	['29', '01', 'Málaga', 'malagueño, malagueña'],
	['30', '14', 'Murcia, Región de Murcia', 'murciano, murciana'],
	['31', '15', 'Navarra, Nafarroa, Comunidad Foral de Navarra', 'navarro'],
	['32', '12', 'Ourense, Orense', 'ourensano, ourensana, orensano, orensana'],
	['34', '07', 'Palencia', 'palentino, palentina'],
	['35', '05', 'Las Palmas', 'palmense'],
	['36', '12', 'Pontevedra', 'pontevedrés, pontevedresa'],
	['26', '17', 'La Rioja, Rioja', 'riojano, riojana'],
	['37', '07', 'Salamanca', 'salmantino, salmantina'],
	['38', '05', 'Santa Cruz de Tenerife, Tenerife', 'tinerfeño, tinerfeña'],
	['40', '07', 'Segovia', 'segoviano, segoviana'],
	['41', '01', 'Sevilla', 'sevillano, sevillana'],
	['42', '07', 'Soria', 'soriano, soriana'],
	['43', '09', 'Tarragona', 'tarraconense'],
	['44', '02', 'Teruel', 'turolense'],
	['45', '08', 'Toledo', 'toledano, toledana'],
	['46', '10', 'Valencia, València', 'valenciano, valenciana'],
	['47', '07', 'Valladolid', 'vallisoletano, vallisoletana'],
	['49', '07', 'Zamora', 'zamorano, zamorana'],
	['50', '02', 'Zaragoza', 'zaragozano, zaragozana'],
	// Ciudades autónomas
	['51', '18', 'Ceuta', 'ceutí'],
	['52', '19', 'Melilla', 'melillense']
]

/** Las comunidades de varias provincias: su código, sus nombres y sus gentilicios. */
const COMMUNITIES: [string, string, string][] = [
	['01', 'Andalucía', 'andaluz, andaluza'],
	['02', 'Aragón', 'aragonés, aragonesa'],
	['05', 'Canarias, Islas Canarias', 'canario, canaria'],
	['07', 'Castilla y León, Castilla León', 'castellanoleonés, castellanoleonesa, castellano-leonés, castellano-leonesa'],
	['08', 'Castilla-La Mancha', 'castellanomanchego, castellanomanchega, castellano-manchego, castellano-manchega'],
	['09', 'Cataluña, Catalunya', 'catalán, catalana, català'],
	['10', 'Comunidad Valenciana, Comunitat Valenciana', 'valenciano, valenciana'],
	['11', 'Extremadura', 'extremeño, extremeña'],
	['12', 'Galicia', 'gallego, gallega, galego, galega'],
	['16', 'País Vasco, Euskadi', 'vasco, vasca']
]

const list = (names: string) => names.split(',').map(words)

export const PLACES: Place[] = [
	...PROVINCES.map(([code, community, names, gentilics]): Place => ({
		kind: 'provincia',
		code,
		community,
		names: list(names),
		gentilics: list(gentilics)
	})),
	...COMMUNITIES.map(([code, names, gentilics]): Place => ({
		kind: 'comunidad',
		code,
		community: code,
		names: list(names),
		gentilics: list(gentilics)
	}))
]

/** La comunidad de cada provincia. */
export const COMMUNITY_OF = new Map(PROVINCES.map(([code, community]) => [code, community]))

/** La palabra buscada es la del nombre o su plural («alaveses», «andaluces»). */
function sameWord(query: string, name: string): boolean {
	return (
		query === name ||
		query === `${name}s` ||
		query === `${name}es` ||
		(name.endsWith('z') && query === `${name.slice(0, -1)}ces`)
	)
}

/**
 * Los sitios cuyo nombre o gentilicio empieza en la palabra `i` de la búsqueda
 * (en minúsculas y sin tildes), y cuántas palabras ocupa. Gana el nombre más
 * largo («castilla y leon» frente a «leon»); si el mismo nombre es de dos
 * sitios («valenciana»), van los dos.
 */
export function placeAt(query: string[], i: number): { length: number; places: Place[] } | null {
	let length = 0
	let found: Place[] = []
	for (const place of PLACES) {
		const n = Math.max(
			0,
			...[...place.names, ...place.gentilics]
				.filter((name) => name.length <= query.length - i && name.every((word, k) => sameWord(query[i + k], word)))
				.map((name) => name.length)
		)
		if (n === 0 || n < length) continue
		if (n > length) found = []
		length = n
		found.push(place)
	}
	return length > 0 ? { length, places: found } : null
}

/**
 * Si `phrase` está en `text`, con la última palabra como prefijo, como la
 * busca el FTS («araba» está en «Arabako Txapelketa»).
 */
export function contains(text: string[], phrase: string[]): boolean {
	for (let j = 0; j + phrase.length <= text.length; j++) {
		if (phrase.every((word, k) => (k === phrase.length - 1 ? text[j + k].startsWith(word) : text[j + k] === word))) {
			return true
		}
	}
	return false
}

/** Los sitios que nombra el nombre de un torneo, por cualquiera de sus nombres o gentilicios. */
export function placesInName(name: string): Place[] {
	const text = words(name)
	return PLACES.filter((place) => [...place.names, ...place.gentilics].some((phrase) => contains(text, phrase)))
}
