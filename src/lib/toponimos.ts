// Provincias, comunidades y ciudades autónomas con sus otros nombres, para la
// búsqueda de torneos. Los organizadores nombran el mismo sitio de varias
// formas: «Cto de Alava» y «Cto Individual Alavesa», «Campeonato Gallego» y
// «Campionato Galego», «Ourense» y «Orense», «Euskadi». Buscar uno de los
// nombres de un sitio los busca todos (`placeTerms` en `db/fts.ts`).
import { words } from './chess/names'

/**
 * Un sitio por línea: el topónimo, el nombre cooficial y los gentilicios. De
 * las comunidades, también el gentilicio en su lengua si los organizadores lo
 * usan («galego»). Las comunidades de una sola provincia van con ella.
 */
const PLACES: string[][][] = [
	// Provincias
	'Álava, Araba, alavés, alavesa',
	'Albacete, albaceteño, albaceteña, albacetense',
	'Alicante, Alacant, alicantino, alicantina',
	'Almería, almeriense',
	'Asturias, Principado de Asturias, Principado, asturiano, asturiana',
	'Ávila, abulense',
	'Badajoz, pacense, badajocense',
	'Islas Baleares, Illes Balears, Baleares, Balears, balear',
	'Barcelona, barcelonés, barcelonesa',
	'Bizkaia, Vizcaya, vizcaíno, vizcaína',
	'Burgos, burgalés, burgalesa',
	'Cáceres, cacereño, cacereña',
	'Cádiz, gaditano, gaditana',
	'Cantabria, cántabro, cántabra',
	'Castellón, Castelló, castellonense',
	'Ciudad Real, ciudadrealeño, ciudadrealeña',
	'Córdoba, cordobés, cordobesa',
	'A Coruña, La Coruña, Coruña, coruñés, coruñesa',
	'Cuenca, conquense',
	'Gipuzkoa, Guipúzcoa, guipuzcoano, guipuzcoana',
	'Girona, Gerona, gerundense',
	'Granada, granadino, granadina',
	'Guadalajara, guadalajareño, guadalajareña',
	'Huelva, onubense',
	'Huesca, oscense',
	'Jaén, jiennense, giennense',
	'León, leonés, leonesa',
	'Lleida, Lérida, leridano, leridana, ilerdense',
	'Lugo, lucense',
	'Madrid, Comunidad de Madrid, madrileño, madrileña',
	'Málaga, malagueño, malagueña',
	'Murcia, Región de Murcia, murciano, murciana',
	'Navarra, Nafarroa, Comunidad Foral de Navarra, navarro',
	'Ourense, Orense, ourensano, ourensana, orensano, orensana',
	'Palencia, palentino, palentina',
	'Las Palmas, palmense',
	'Pontevedra, pontevedrés, pontevedresa',
	'La Rioja, Rioja, riojano, riojana',
	'Salamanca, salmantino, salmantina',
	'Santa Cruz de Tenerife, Tenerife, tinerfeño, tinerfeña',
	'Segovia, segoviano, segoviana',
	'Sevilla, sevillano, sevillana',
	'Soria, soriano, soriana',
	'Tarragona, tarraconense',
	'Teruel, turolense',
	'Toledo, toledano, toledana',
	'Valencia, València, valenciano, valenciana',
	'Valladolid, vallisoletano, vallisoletana',
	'Zamora, zamorano, zamorana',
	'Zaragoza, zaragozano, zaragozana',
	// Comunidades autónomas de varias provincias
	'Andalucía, andaluz, andaluza',
	'Aragón, aragonés, aragonesa',
	'Canarias, Islas Canarias, canario, canaria',
	'Castilla y León, castellanoleonés, castellanoleonesa, castellano-leonés, castellano-leonesa',
	'Castilla-La Mancha, castellanomanchego, castellanomanchega, castellano-manchego, castellano-manchega',
	'Cataluña, Catalunya, catalán, catalana, català',
	'Comunidad Valenciana, Comunitat Valenciana, valenciano, valenciana',
	'Extremadura, extremeño, extremeña',
	'Galicia, gallego, gallega, galego, galega',
	'País Vasco, Euskadi, vasco, vasca',
	// Ciudades autónomas
	'Ceuta, ceutí',
	'Melilla, melillense'
].map((line) => line.split(',').map(words))

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
 * Buscado como prefijo (la última palabra), `a` encuentra todo lo que
 * encuentra `b`: «alaves» encuentra «alavesa», y «madrid», «Comunidad de Madrid».
 */
function covers(a: string[], b: string[]): boolean {
	for (let j = 0; j + a.length <= b.length; j++) {
		if (a.every((word, k) => (k === a.length - 1 ? b[j + k].startsWith(word) : b[j + k] === word))) return true
	}
	return false
}

/** Los nombres sin repetir y sin los que ya encuentra otro. */
function uncovered(names: string[][]): string[][] {
	const unique = [...new Map(names.map((name) => [name.join(' '), name])).values()]
	return unique.filter((name) => !unique.some((other) => other !== name && covers(other, name)))
}

/**
 * El sitio que empieza en la palabra `i` de la búsqueda (en minúsculas y sin
 * tildes): cuántas palabras ocupa y todos sus nombres, cada uno en palabras.
 * Gana el nombre más largo («castilla y leon» frente a «leon»); si el mismo
 * nombre es de dos sitios («valenciana»), van los de los dos.
 */
export function placeAt(query: string[], i: number): { length: number; names: string[][] } | null {
	let length = 0
	let found: string[][][] = []
	for (const place of PLACES) {
		const n = Math.max(
			0,
			...place
				.filter((name) => name.length <= query.length - i && name.every((word, k) => sameWord(query[i + k], word)))
				.map((name) => name.length)
		)
		if (n === 0 || n < length) continue
		if (n > length) found = []
		length = n
		found.push(place)
	}
	return length > 0 ? { length, names: uncovered(found.flat()) } : null
}
