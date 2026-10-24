// Alfil: mitra apuntada sobre un collar y el cuerpo abierto en curva, con la
// peana del rey. Tiene más masa que el peón (la mitra, el cuello y el collar,
// más anchos), y lo distinguen además la altura, la bola de arriba y la
// ranura: una cuña tallada que entra ancha por la derecha de la mitra y se
// estrecha hacia el eje. No corta la silueta: llega al borde y se funde con él.
import { circulo, filetePeana, peana, torno } from './comun.mjs'

const n = (x) => Math.round(x * 10) / 10

/**
 * La ranura: una banda de `fuera` a `dentro`, de semiancho `a0` en el canto
 * recto de fuera y `a1` en la punta redonda de dentro. Va en sentido
 * antihorario, el contrario al de torno(): dentro de la silueta es un hueco.
 */
function ranura([x0, y0], [x1, y1], a0, a1) {
	const largo = Math.hypot(x1 - x0, y1 - y0)
	const [px, py] = [(y0 - y1) / largo, (x1 - x0) / largo]
	const p = (x, y, a) => `${n(x + a * px)} ${n(y + a * py)}`
	return `M${p(x0, y0, a0)}L${p(x1, y1, a1)}A${a1} ${a1} 0 0 0 ${p(x1, y1, -a1)}L${p(x0, y0, -a0)}Z`
}

export default {
	letra: 'B',
	partes: [
		torno([50, 55], ['L', 60, 55], ['C', 59.6, 65, 63.5, 75, 74, 78], ...peana(27)),
		torno([50, 21.5], ['C', 55.9, 24.5, 65.5, 31.5, 65.5, 38.5], ['C', 65.5, 44, 61.6, 47.5, 58.1, 50], ['L', 50, 50]),
		torno([50, 49], ['L', 64, 49], ['Q', 67.5, 49, 67.5, 52.5], ['Q', 67.5, 56, 64, 56], ['L', 50, 56]),
		circulo(50, 21, 5.5)
	],
	lineas: filetePeana(27),
	marcas: ranura([63.9, 33.9], [49.1, 45], 2.8, 1.7),
	// La silueta que se ve en el tablero, sin juntas, como la del rey: las
	// partes con medio contorno más por los lados y por arriba, y la peana en
	// la línea base. La ranura, un hueco algo más ancho que en el tablero.
	figura:
		torno(
			[50, 13.5],
			['A', 7.5, 57, 23.7, 1],
			['C', 62.2, 27.8, 67.5, 33.6, 67.5, 38.5],
			['C', 67.5, 41.6, 66, 44.5, 64.1, 47],
			['Q', 69.5, 47, 69.5, 52.5],
			['Q', 69.5, 58, 64, 58],
			['L', 62, 58],
			['C', 62.2, 66.6, 65.1, 73.4, 76, 76],
			...peana(29, 12)
		) + ranura([63.4, 34.9], [48.6, 45.5], 3.3, 2.2)
}
