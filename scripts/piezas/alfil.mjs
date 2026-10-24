// Alfil: lo que más pesa es la mitra, una gota apuntada más ancha que la bola
// del peón, con la bola encima. Debajo, más estrechos, el collar y el cuello,
// y la peana de la dama. La ranura corta la mitra, como en los alfiles de
// madera: entra ancha por la derecha, baja hacia la izquierda, cruza el eje y
// acaba redonda. Al cambiar la silueta, se lee a 41 px.
import { circulo, filetePeana, peana, torno } from './comun.mjs'

// La mitra con el corte: el lado derecho, de la punta al canto, entra por el
// corte y sale; el izquierdo está entero.
const mitra =
	'M50 20C50.9 21.7 55.3 24.7 59.5 28.6L41.1 42.7A2.3 2.3 0 0 0 43.5 46.6L65.4 35.6' +
	'C67 38.2 68 41 68 44C68 50 63 56 57 57H43C37 56 32 50 32 44C32 32 48.2 23.5 50 20Z'

export default {
	letra: 'B',
	partes: [
		torno([50, 60.5], ['L', 58.5, 60.5], ['C', 58.1, 69, 61.5, 76, 73, 78], ...peana(26)),
		mitra,
		torno([50, 55], ['L', 61.7, 55], ['Q', 65, 55, 65, 58.25], ['Q', 65, 61.5, 61.7, 61.5], ['L', 50, 61.5]),
		circulo(50, 20.5, 5)
	],
	lineas: filetePeana(26),
	// La silueta que se ve en el tablero, sin juntas: las partes con medio
	// contorno más por los lados y por arriba, y la peana en la línea base. El
	// corte, que el medio contorno estrecha, queda algo más ancho que en el
	// tablero para que se lea a 14 px.
	figura:
		'M50 13.5A7 7 0 0 1 56.3 23.6C57.9 25 59.8 26.6 61.6 28.4L41.6 43.5A1.3 1.3 0 0 0 43 45.7L66.3 33.9' +
		'C68.5 37 70 40.4 70 44C70 47.2 68.1 51 65.3 54Q67 55.3 67 58.3Q67 63.5 61.7 63.5H60.5' +
		'C60.7 70.2 63.2 74.3 75 76C76.8 76 78 77.2 78 79V86Q78 88 76 88H24Q22 88 22 86V79C22 77.2 23.2 76 25 76' +
		'C36.8 74.3 39.3 70.2 39.5 63.5H38.3Q33 63.5 33 58.3Q33 55.3 34.7 54C31.9 51 30 47.2 30 44' +
		'C30 35.5 38.3 28.3 43.7 23.6A7 7 0 0 1 50 13.5Z'
}
