// Peón: la pieza menor de la familia, con la peana más estrecha, pero robusto:
// bola grande y cuello grueso, lejos del cono fino. Tres piezas de torno
// apiladas: cuerpo cóncavo con peana, bola y, delante, un collar de píldora
// en el que se asienta la bola, como el collar del rey.
import { circulo, filetePeana, peana, torno } from './comun.mjs'

export default {
	letra: 'P',
	partes: [
		torno([50, 56.5], ['L', 58.5, 56.5], ['C', 58.5, 67, 61.5, 75.5, 71.5, 78], ...peana(24.5)),
		circulo(50, 44, 11.5),
		torno([50, 51.5], ['L', 61.3, 51.5], ['Q', 64.5, 51.5, 64.5, 54.8], ['Q', 64.5, 58, 61.3, 58], ['L', 50, 58])
	],
	lineas: filetePeana(24.5),
	// En SAN el peón no lleva letra: no hay figura.
	figura: null
}
