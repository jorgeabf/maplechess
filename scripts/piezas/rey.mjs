// Rey: la pieza más alta, con una corona de dos lóbulos sobre un embudo y una
// cruz latina encima.
import { BASE, collar, cuello, fila, junta, juntasBase, juntasCollar, molduras, semiancho, torno } from './comun.mjs'

// Cruz latina, con el pie más largo que el remate: a 32 px, cinco filas y brazos
// de seis píxeles en dos filas. Con ella, el rey es la pieza más alta sin
// engordar la corona, y no más: 0,8 de peón/rey y 0,87 de torre/rey son el mínimo
// de los juegos corrientes.
const cruz = 'M48.1 11.1H51.9L51.4 14.2L57.3 13.8V17.4L51.4 17L51.5 30.1H48.5L48.6 17L42.7 17.4V13.8L48.6 14.2Z'

const inicio = [50, 26]
// La base, la de la dama y el alfil.
const SEMIBASE = 27
// El collar, una fila por debajo del de la dama: el embudo de la corona se alarga.
const Y_COLLAR = fila(20) - 5.4
const tramos = [
	// Un brote bajo la cruz, con una muesca honda a cada lado: separa los lóbulos
	// también en la negra a 32 px y hace de eje. Sin hendidura ni raya central, la
	// corona no se lee como un corazón.
	['C', 54, 26, 57.6, 30, 59, 37.4],
	// El lóbulo, con el hombro alto y más cuadrado, en x = 82,4.
	['C', 61.6, 31, 67.4, 26.2, 73, 27.2],
	['C', 78.4, 28.2, 82.4, 31.6, 82.4, 36],
	// El flanco acaba en la diadema, ancha; no converge en punta.
	['C', 82.4, 40, 78.6, 43.2, 75.4, 46.2],
	// Y un embudo hasta el collar, sobre un cuello que aguanta la corona.
	['C', 71.4, 49.4, 66.6, 52.4, 65.6, Y_COLLAR],
	...collar(Y_COLLAR, 19, 5.4, 14.6),
	cuello(SEMIBASE, 63.4, 68.4),
	...molduras(SEMIBASE)
]
// La diadema, con su centro en la fila 14 y poca flecha: con más, se reparte en dos filas.
const yDiadema = fila(14) - 2

export default {
	letra: 'K',
	macizas: [cruz],
	partes: [torno(inicio, ...tramos)],
	lineas: [
		junta(yDiadema, semiancho(inicio, tramos, yDiadema), 2),
		...juntasCollar(Y_COLLAR, 19, 5.4, 14.6),
		...juntasBase(SEMIBASE)
	],
	// La silueta que se ve en el tablero, sin juntas: las partes con medio contorno
	// más, hasta la línea base.
	figura: torno(
		[50, 9.4],
		['L', 53.8, 9.4],
		['L', 53.3, 12.3],
		['L', 58.9, 12],
		['L', 58.9, 19.1],
		['L', 53.1, 18.7],
		['L', 53.1, 24.9],
		['C', 55.6, 26.4, 58.1, 29, 59.5, 32.7],
		['C', 62, 28.6, 66.6, 25.4, 72.6, 25.4],
		['C', 78.6, 25.6, 84, 30, 84, 35.6],
		['C', 84, 38.4, 82.8, 40.6, 81.6, 42.2],
		['L', 76.5, 47.4],
		['C', 73, 50.2, 69.4, 52.8, 67.7, 56.9],
		['Q', 70.7, 57.4, 70.7, 61.1],
		['Q', 70.7, 65.7, 66, 65.8],
		['C', 66, 70.4, 69.4, 73.6, 75, 73.8],
		['Q', 76.2, 74, 76.2, 75.6],
		['L', 76.2, 78],
		['L', 78.6, 78],
		['L', 78.6, BASE],
		['L', 50, BASE]
	)
}
