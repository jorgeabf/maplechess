// Dama: el cuerpo y el collar del rey, al 95 % desde el hombro de la peana
// (que no se mueve), con la coronilla de la Staunton: una copa de torno de
// borde dentado y una bola encima, que es otra pieza y deja la junta a la
// vista. Sin cruz: de lejos, la distinguen del rey la corona ancha y la bola.
// Los dientes de fuera no entran en la esquina del número de la fila
// (comun.mjs, ESQUINAS), tampoco a 32 px.
//
// La copa va sin filete: con él, la corona se veía como una doble banda a
// 41 px, y sus líneas dejaban el cuerpo de la blanca sobre el nogal y el de la
// negra sobre el arce a un punto de no llegar al contraste.
import { circulo, filetePeana, peana, torno } from './comun.mjs'

export default {
	letra: 'Q',
	partes: [
		torno([50, 49.5], ['L', 64.3, 49.5], ['C', 62.4, 55.2, 61.9, 60, 62.5, 65.2], ['C', 63.3, 71.8, 66.2, 75.6, 73, 78], ...peana(26)),
		// La bola, con su borde, deja una muesca con el diente de dentro y se
		// apoya en el borde de la copa.
		circulo(50, 17, 5.5),
		torno(
			[50, 25],
			['L', 55.5, 25],
			['L', 60.5, 17],
			['L', 65, 24.5],
			['L', 70.5, 17.5],
			['L', 71.5, 26],
			['C', 67.5, 32, 63, 37, 63, 45],
			['L', 50, 45]
		),
		torno([50, 43.8], ['L', 67.6, 43.8], ['Q', 70.9, 43.8, 70.9, 47.2], ['Q', 70.9, 50.6, 67.6, 50.6], ['L', 50, 50.6])
	],
	lineas: filetePeana(26),
	// La silueta que se ve en el tablero, sin juntas, como la del rey: las
	// partes con medio contorno más por los lados y por arriba (las puntas de
	// los dientes, redondas como las deja el trazo), y la peana en la línea
	// base.
	figura: torno(
		[50, 9.5],
		['A', 7.5, 57.4, 18.2, 1],
		['L', 58.8, 15.9],
		['A', 2, 62.2, 16, 1],
		['L', 65.2, 21],
		['L', 68.9, 16.3],
		['A', 2, 72.5, 17.3, 1],
		['L', 73.5, 25.8],
		['A', 2, 73.2, 27.1, 1],
		['C', 69.7, 32.4, 66.1, 36.5, 65.2, 41.8],
		['L', 67.6, 41.8],
		['Q', 72.9, 41.8, 72.9, 47.2],
		['Q', 72.9, 52.6, 67.6, 52.6],
		['L', 65.5, 52.6],
		['C', 64.3, 57, 64, 60.7, 64.5, 65],
		['C', 65.2, 71, 67.4, 73.9, 75, 76],
		...peana(28, 12)
	)
}
