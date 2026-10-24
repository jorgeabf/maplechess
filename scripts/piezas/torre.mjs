// Torre: una columna recta y robusta entre dos juntas a la vista, el anillo
// de la corona y la basa que se abre hacia la peana. La corona lleva tres
// merlones iguales y los huecos con el fondo redondo, como las juntas del
// «!?». No entra en la esquina del número de la fila (comun.mjs, ESQUINAS).
import { filetePeana, peana, torno } from './comun.mjs'

/**
 * Las almenas, del eje al canto de la corona: medio merlón central hasta
 * `merlon`, un hueco de ancho `hueco` con el fondo redondo en `fondo` y el
 * merlón del lado hasta `canto`.
 */
const almenas = (merlon, hueco, fondo, canto) => [
	['L', merlon, 25],
	['L', merlon, fondo - hueco / 2],
	['A', hueco / 2, merlon + hueco, fondo - hueco / 2, 0],
	['L', merlon + hueco, 25],
	['L', canto, 25]
]

// Del fuste a la peana.
const basa = [['L', 66, 69.5], ['C', 67.5, 75, 69, 78, 72, 78], ...peana(25)]

export default {
	letra: 'R',
	partes: [
		torno([50, 46], ['L', 63, 46], ['L', 63, 72], ['L', 50, 72]),
		torno([50, 69.5], ...basa),
		torno([50, 25], ...almenas(54.5, 6, 33, 69.5), ['L', 69.5, 39], ['Q', 69.5, 42, 66.5, 42], ['L', 50, 42]),
		torno([50, 40], ['L', 63.5, 40], ['Q', 67, 40, 67, 43.5], ['Q', 67, 47, 63.5, 47], ['L', 50, 47])
	],
	lineas: filetePeana(25),
	// La silueta sin el anillo, con los huecos más anchos y hondos que en el
	// tablero: en la fuente, a 14 px, cada hueco y cada merlón es un píxel.
	figura: torno([50, 25], ...almenas(54, 8, 34, 70), ['L', 70, 39], ['Q', 70, 42, 67, 42], ['L', 63, 42], ['L', 63, 69.5], ...basa)
}
