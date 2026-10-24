// Dama: el cuerpo y el collar del rey, al 95 % desde el hombro de la peana
// (que no se mueve), con una coronilla de lóbulos: una copa de torno que se
// abre y acaba en dos lóbulos redondos por lado, como perlas, y una bola
// encima, que es otra pieza y deja la junta a la vista. Sin cruz: la
// distinguen del rey la corona ancha y la bola. Los lóbulos de fuera no entran
// en la esquina del número de la fila (comun.mjs, ESQUINAS), tampoco a 32 px.
//
// Los lóbulos sustituyen a los dientes en punta, que en la cabeza resultaban
// agresivos. La copa va sin filete: con él, la corona se veía como una doble
// banda a 41 px.
import { circulo, filetePeana, peana, torno } from './comun.mjs'

export default {
	letra: 'Q',
	partes: [
		torno([50, 49.5], ['L', 64.3, 49.5], ['C', 62.4, 55.2, 61.9, 60, 62.5, 65.2], ['C', 63.3, 71.8, 66.2, 75.6, 73, 78], ...peana(26)),
		circulo(50, 17, 5.5),
		// Cada lóbulo, un arco de radio 4,6 entre sus pies; los dos se cortan
		// en pico.
		torno([50, 24.5], ['L', 54.5, 24.5], ['A', 4.6, 63, 23.5, 1], ['A', 4.6, 71, 25.5, 1], ['C', 68, 31, 63, 37, 63, 45.5], ['L', 50, 45.5]),
		torno([50, 43.8], ['L', 67.6, 43.8], ['Q', 70.9, 43.8, 70.9, 47.2], ['Q', 70.9, 50.6, 67.6, 50.6], ['L', 50, 50.6])
	],
	lineas: filetePeana(26),
	// La silueta que se ve en el tablero, sin juntas, como la del rey: las
	// partes con medio contorno más por los lados y por arriba (la bola y los
	// lóbulos, arcos de radio 2 más, cortados donde se encuentran) y la peana
	// en la línea base.
	figura: torno(
		[50, 9.5],
		['A', 7.5, 57.1, 19.3, 1],
		['A', 6.6, 63.3, 20.7, 1],
		['A', 6.6, 73, 25.1, 1],
		['A', 2, 72.8, 26.5, 1],
		['C', 70.1, 31.3, 66.4, 36, 65.3, 41.8],
		['L', 67.6, 41.8],
		['Q', 72.9, 41.8, 72.9, 47.2],
		['Q', 72.9, 52.6, 67.6, 52.6],
		['L', 65.5, 52.6],
		['C', 64.3, 57, 64, 60.7, 64.5, 65],
		['C', 65.2, 71, 67.4, 73.9, 75, 76],
		...peana(28, 12)
	)
}
