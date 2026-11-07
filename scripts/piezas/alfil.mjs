// Alfil: toda la pieza es de torno, y el corte se hace en la curva derecha de la
// mitra. La mitra es simétrica, con una punta de flancos cóncavos bajo la bola, lo
// que más la separa de la cabeza redonda del peón a 32 px. El corte es una cuña
// estrecha, en diagonal hacia el eje, con una boca de unas 7 u; su vértice,
// redondeado, no llega al eje en las blancas. La base, la de la dama.
import { BASE, circulo, collar, cuello, curva, fila, juntasBase, juntasCollar, molduras, n, partir, torno } from './comun.mjs'

const X = 71
const SEMIBASE = 27
const derecha = [[50, 25], [50.8, 31], [X, 33.5], [X, 47.5]]
const [t1, t2] = [0.52, 0.72]
const [arriba, resto] = partir(derecha, t1)
const [, abajo] = partir(resto, (t2 - t1) / (1 - t1))
const corte = `${curva(arriba)}L53.6 43.6Q52.6 45.6 54.6 45.4L${n(abajo[0][0])} ${n(abajo[0][1])}${curva(abajo)}`
// El collar acaba en la fila 20, como el del rey.
const Y_COLLAR = fila(20) - 4.8

const silueta = torno(
	[50, 25],
	['C', 50.8, 31, X, 33.5, X, 47.5],
	['C', X, 53, 67.5, 56.8, 64.2, 58.9],
	['Q', 63.7, Y_COLLAR, 64.4, Y_COLLAR],
	...collar(Y_COLLAR, 17.6, 4.8, 11),
	cuello(SEMIBASE, 60.2, 68.8),
	...molduras(SEMIBASE)
).replace(`C50.8 31 ${X} 33.5 ${X} 47.5`, corte)

export default {
	letra: 'B',
	partes: [silueta, circulo(50, fila(5) + 1.6, 4.8)],
	lineas: [...juntasCollar(Y_COLLAR, 17.6, 4.8, 11), ...juntasBase(SEMIBASE)],
	// La silueta que se ve en el tablero, sin juntas: las partes con medio contorno
	// más, hasta la línea base. El corte, que el medio contorno estrecha, queda algo
	// más ancho que en el tablero, para que se lea a 14 px.
	figura: torno(
		[50, 12.3],
		['A', 6.5, 51.8, 25, 1],
		['C', 53, 26.6, 57.6, 29.6, 62.6, 32.4],
		['L', 68.2, 37],
		['C', 70.8, 39.8, 72.7, 43, 72.7, 47.4],
		['C', 72.7, 52, 70.6, 55, 67.8, 58.1],
		['Q', 69.3, 58.6, 69.3, 61.6],
		['Q', 69.3, 65.8, 65, 65.8],
		['L', 62.6, 65.9],
		['C', 63.2, 70.2, 66.6, 73.4, 75, 73.8],
		['Q', 76.2, 74, 76.2, 75.6],
		['L', 76.2, 78],
		['L', 78.6, 78],
		['L', 78.6, BASE],
		['L', 50, BASE]
	).replace('L68.2 37', 'L55.6 43.6L68.2 37')
}
