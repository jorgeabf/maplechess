// Peón: robusto, de bola grande y cuello grueso. Tres piezas de torno
// apiladas: cuerpo cóncavo con peana, bola y, delante, un collar de píldora
// en el que se asienta la bola, como el collar del rey.
//
// Las medidas caen en la rejilla de las casillas de 32 px a 2×, donde el borde
// claro de la negra sobre el nogal pasa la medida de comun.mjs por poco: si se
// mueve un borde, hay que volver a medir (node scripts/piezas.mjs peon).
import { circulo, filetePeana, peana, torno } from './comun.mjs'

export default {
	letra: 'P',
	partes: [
		torno([50, 56], ['L', 59.3, 56], ['C', 59.3, 67, 62.3, 75.5, 74, 78], ...peana(27)),
		circulo(50, 42.5, 13),
		torno([50, 51], ['L', 62.8, 51], ['Q', 66, 51, 66, 54.3], ['Q', 66, 57.5, 62.8, 57.5], ['L', 50, 57.5])
	],
	lineas: filetePeana(27),
	// En SAN el peón no lleva letra: no hay figura.
	figura: null
}
