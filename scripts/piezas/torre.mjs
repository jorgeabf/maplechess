// Torre: esbelta, con la corona al 50 % de la casilla y el fuste del 33 al 40 %:
// en octubre, una de corona 50 y fuste 38-42 se veía demasiado ancha. El fuste cae
// recto y sólo se abre al pie, sin cintura: nada de jarrón.
import { BASE, Y_PLINTO, fila, junta, juntasBase, plinto, torno } from './comun.mjs'

export default {
	letra: 'R',
	partes: [
		torno(
			[50, 20.9],
			['L', 55.6, 20.9],
			['L', 55.6, 27.7],
			['L', 64, 27.7],
			['L', 64, 20.9],
			['L', 73.3, 20.9],
			['L', 73.3, 33.7],
			['C', 73.3, 38.3, 65, 38.9, 65, 43.5],
			['C', 65, 56, 65.2, 68.5, 72.5, 75],
			['Q', 74.1, 75.4, 74.1, 76.6],
			['L', 74.1, Y_PLINTO],
			...plinto(75.7)
		)
	],
	// Las dos juntas altas, centradas en una fila de píxeles a 32 px: entre dos, se apagan.
	lineas: [junta(fila(10), 23.3, 0, 3.4), junta(fila(13), 15.1, 0, 3), ...juntasBase(25.7)],
	// La silueta que se ve en el tablero, sin juntas: las partes con medio contorno
	// más, hasta la línea base. Los huecos de las almenas, más anchos y hondos que en
	// el tablero, para que se lean a 14 px.
	figura: torno(
		[50, 19.2],
		['L', 56.6, 19.2],
		['L', 56.6, 27.2],
		['L', 63, 27.2],
		['L', 63, 19.2],
		['L', 75, 19.2],
		['L', 75, 34.8],
		['C', 75, 38, 68.4, 39.8, 66.7, 42.8],
		['C', 66.7, 56, 67.4, 68, 73.3, 73.5],
		['Q', 75.7, 74.4, 75.7, 76.6],
		['L', 75.7, 78],
		['L', 77.4, 78],
		['L', 77.4, BASE],
		['L', 50, BASE]
	)
}
