// Dama: el cuerpo y el collar del rey, algo más bajos, con la coronilla de
// la Staunton: una copa de torno de borde dentado y una bola encima, que es
// otra pieza y deja la junta a la vista. Sin cruz: de lejos, la distinguen del
// rey la corona ancha y la bola. Los dientes de fuera no entran en la esquina
// del número de la fila (comun.mjs, ESQUINAS).
//
// La copa va sin filete: con él, la corona se veía como una doble banda a
// 41 px, y sus líneas dejaban el cuerpo de la blanca sobre el nogal y el de la
// negra sobre el arce a un punto de no llegar al contraste.
import { circulo, filetePeana, peana, torno } from './comun.mjs'

// Borde de la copa, del centro afuera: diente de dentro, valle y diente de
// fuera, cuyo lado exterior baja ya por la copa.
const dientes = [
	['L', 60, 16],
	['L', 65, 23.5],
	['L', 70.5, 16.5],
	['L', 71.5, 25]
]

export default {
	letra: 'Q',
	partes: [
		torno([50, 43], ['L', 62, 43], ['C', 59.5, 48.5, 59, 53.5, 59.7, 59], ['C', 60.6, 67, 63.8, 74.5, 73, 78], ...peana(26)),
		circulo(50, 16, 6),
		torno([50, 24], ['L', 55, 24], ...dientes, ['C', 67, 30, 62.5, 33, 62, 39.5], ['L', 50, 39.5]),
		torno([50, 38.5], ['L', 63.5, 38.5], ['Q', 67, 38.5, 67, 41.5], ['Q', 67, 44.5, 63.5, 44.5], ['L', 50, 44.5])
	],
	lineas: filetePeana(26),
	// La silueta en un solo contorno: la bola baja hasta el pie del diente de
	// dentro, la copa entra en el collar y el collar, en el cuerpo.
	figura: torno(
		[50, 10],
		['A', 6, 53, 21.2, 1],
		['L', 55, 24],
		...dientes,
		['C', 67, 30, 62.5, 33, 62.1, 38.5],
		['L', 63.5, 38.5],
		['Q', 67, 38.5, 67, 41.5],
		['Q', 67, 44.5, 63.5, 44.5],
		['L', 61.4, 44.5],
		['C', 59.7, 49.5, 59.1, 54, 59.7, 59],
		['C', 60.6, 67, 63.8, 74.5, 73, 78],
		...peana(26)
	)
}
