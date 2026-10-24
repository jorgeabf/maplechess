// Torre: una columna recta y robusta entre dos juntas a la vista, el anillo
// de la corona y la basa que se abre hacia la peana. La corona lleva tres
// merlones iguales y los huecos con el fondo redondo, como las juntas del
// «!?». No entra en la esquina del número de la fila (comun.mjs, ESQUINAS).
import { filetePeana, peana, torno } from './comun.mjs'

/**
 * Las almenas, del eje al canto de la corona, con la cara de arriba en
 * `arriba`: medio merlón central hasta `merlon`, un hueco de ancho `hueco`
 * con el fondo redondo en `fondo` y el merlón del lado hasta `canto`.
 */
const almenas = (arriba, merlon, hueco, fondo, canto) => [
	['L', merlon, arriba],
	['L', merlon, fondo - hueco / 2],
	['A', hueco / 2, merlon + hueco, fondo - hueco / 2, 0],
	['L', merlon + hueco, arriba],
	['L', canto, arriba]
]

// Del fuste a la peana.
const basa = [['L', 66, 69.5], ['C', 67.5, 75, 69, 78, 72, 78], ...peana(25)]

export default {
	letra: 'R',
	partes: [
		torno([50, 46], ['L', 63, 46], ['L', 63, 72], ['L', 50, 72]),
		torno([50, 69.5], ...basa),
		torno([50, 25], ...almenas(25, 54.5, 6, 33, 69.5), ['L', 69.5, 39], ['Q', 69.5, 42, 66.5, 42], ['L', 50, 42]),
		torno([50, 40], ['L', 63.5, 40], ['Q', 67, 40, 67, 43.5], ['Q', 67, 47, 63.5, 47], ['L', 50, 47])
	],
	lineas: filetePeana(25),
	// La silueta que se ve en el tablero, sin juntas, como la del rey: las
	// partes con medio contorno más por los lados y por arriba, y la peana en
	// la línea base. Los huecos de las almenas, más anchos y hondos que en el
	// tablero, para que se lean a 14 px.
	figura: torno(
		[50, 23],
		...almenas(23, 54.5, 8, 33, 71.5),
		['L', 71.5, 39],
		['A', 5, 69, 43.3, 1],
		['A', 5.5, 65, 48.8, 1],
		['L', 65, 67.5],
		['L', 66, 67.5],
		['A', 2, 67.9, 69, 1],
		['C', 69.6, 75.2, 70.9, 76, 72, 76],
		['L', 74, 76],
		...peana(27, 12)
	)
}
