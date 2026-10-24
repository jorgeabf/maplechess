// Peón: robusto, de cabeza grande y cuello grueso, sobre la peana más
// estrecha de la familia. Tres piezas de torno apiladas: cuerpo con peana,
// collar y cabeza.
import { circulo, filetePeana, peana, torno } from './comun.mjs'

export default {
	letra: 'P',
	partes: [
		torno([50, 56], ['L', 59, 56], ['C', 59, 67, 62.5, 75.5, 73, 78], ...peana(26)),
		torno([50, 51.5], ['L', 62, 51.5], ['Q', 65.5, 51.5, 65.5, 54.75], ['Q', 65.5, 58, 62, 58], ['L', 50, 58]),
		circulo(50, 40, 13)
	],
	lineas: filetePeana(26),
	// En SAN el peón no lleva letra: no hay figura.
	figura: null
}
