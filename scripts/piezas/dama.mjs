// Dama: una corona de cinco puntas con una bola en cada una, sin cruz. Es la
// pieza más ancha.
import { BASE, circulo, collar, cuello, fila, junta, juntasBase, juntasCollar, molduras, semiancho, torno } from './comun.mjs'

const inicio = [50, 22]
const tramos = [
	// Los valles, hondos: el contorno se come la mitad, y con menos cada bola se
	// apoya en el aro y el conjunto se acerca a una flor. Con el fondo redondo: en V,
	// el inglete bajaba 2,7 u más, casi hasta la diadema, y a 32 px se cerraba la
	// corona de la blanca.
	['C', 50.8, 29, 52.8, 34.4, 56.6, 38.6],
	['Q', 58, 40.2, 59.4, 38.6],
	['C', 62.4, 35, 66, 29.6, 68.8, 25],
	['C', 69, 30, 69.6, 34.4, 71.2, 38.2],
	['Q', 72, 40, 73.6, 38.6],
	['C', 76, 36.6, 79.2, 35.6, 82, 32.6],
	['C', 81.6, 44, 70.8, 48, 64.4, 55.5],
	...collar(55.5, 16.8, 5.4, 10.4),
	cuello(27, 59.8, 67.5),
	...molduras(27)
]
// Las bolas crecen lo que crece el contorno, para no perder su blanco por dentro,
// y su centro cae en la rejilla de 32 px: en un píxel, en una junta de dos o en
// una esquina de cuatro.
const bolas = [
	circulo(50, 17.2, 5.1),
	circulo(68.8, 20.3, 4.8),
	circulo(31.2, 20.3, 4.8),
	circulo(82.8, 28.1, 5),
	circulo(17.2, 28.1, 5)
].join('')
// La diadema, con su centro en la fila 15.
const yDiadema = fila(15) - 2

export default {
	letra: 'Q',
	partes: [torno(inicio, ...tramos), bolas],
	lineas: [
		junta(yDiadema, semiancho(inicio, tramos, yDiadema), 2),
		...juntasCollar(55.5, 16.8, 5.4, 10.4),
		...juntasBase(27)
	],
	// La silueta que se ve en el tablero, sin juntas: las partes con medio contorno
	// más (las bolas, arcos de radio 1,7 más), hasta la línea base.
	figura: torno(
		[50, 10.4],
		['A', 6.8, 52, 23.7, 1],
		['C', 52.6, 28, 54.6, 33.4, 57.9, 37.6],
		['L', 60.9, 33.9],
		['C', 62.6, 31.6, 64.4, 28.8, 66.1, 26.2],
		['A', 6.5, 68.8, 13.8, 1],
		['A', 6.5, 70.6, 26.5, 1],
		['C', 70.8, 30, 71.4, 33.8, 72.6, 37.2],
		['L', 78.6, 33.3],
		['A', 6.7, 82.8, 21.4, 1],
		['A', 6.7, 83.4, 34.8, 1],
		['C', 82, 40, 77.6, 45.8, 75.8, 47.4],
		['L', 67.4, 54.6],
		['Q', 68.5, 55.6, 68.5, 58.2],
		['Q', 68.4, 62.6, 65, 62.6],
		['L', 62, 62.6],
		['C', 62.6, 67.4, 66.4, 73, 75, 73.8],
		['Q', 76.2, 74, 76.2, 75.6],
		['L', 76.2, 78],
		['L', 78.6, 78],
		['L', 78.6, BASE],
		['L', 50, BASE]
	)
}
