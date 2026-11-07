// Peón: la pieza más baja, con una cabeza redonda sobre un collar y una base como
// la de las demás, algo más estrecha.
import { collar, cuello, juntasBase, juntasCollar, molduras, torno } from './comun.mjs'

export default {
	letra: 'P',
	partes: [
		torno(
			[50, 26.7],
			['C', 58.5, 26.7, 64.8, 32.8, 64.8, 40.8],
			['C', 64.8, 46.2, 62, 50.4, 58.4, 52.5],
			['Q', 57.8, 52.9, 58.6, 52.9],
			...collar(52.9, 16, 4.9, 9.4),
			cuello(24, 59.8, 65),
			...molduras(24)
		)
	],
	lineas: [...juntasCollar(52.9, 16, 4.9, 9.4), ...juntasBase(24)],
	// En SAN el peón no lleva letra: no hay figura.
	figura: null
}
