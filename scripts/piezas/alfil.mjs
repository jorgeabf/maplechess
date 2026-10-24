// Alfil: mitra apuntada sobre un collar y el cuerpo abierto en curva, con la
// peana del peón. Lo separan del peón la altura, la bola de arriba y la
// ranura: una cuña tallada que entra ancha por la derecha de la mitra y se
// estrecha hacia el eje. No corta la silueta: llega al borde y se funde con
// él. Las medidas están ajustadas a la rejilla de 56, 64, 72 y 82 px, para que
// el borde claro de la negra pase con margen sobre el nogal.
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
		torno([50, 53.5], ['L', 57, 53.5], ['C', 56.5, 65, 60.5, 75, 73, 78], ...peana(26)),
		torno([50, 21.5], ['C', 56, 24.5, 62.5, 30.5, 62.5, 37.5], ['C', 62.5, 43, 59.5, 46.5, 56.5, 49], ['L', 50, 49]),
		torno([50, 48], ['L', 61.5, 48], ['Q', 65, 48, 65, 51.25], ['Q', 65, 54.5, 61.5, 54.5], ['L', 50, 54.5]),
		circulo(50, 21, 5)
	],
	lineas: filetePeana(26),
	marcas: ranura([61.5, 32.5], [48.7, 42.1], 2.5, 1.5),
	// La silueta que se ve en el tablero, sin juntas, como la del rey: las
	// partes con medio contorno más por los lados y por arriba, y la peana en
	// la línea base. La ranura, un hueco algo más ancho que en el tablero.
	figura:
		torno(
			[50, 14],
			['A', 7, 56.5, 23.6, 1],
			['C', 60.8, 27.3, 64.5, 32.6, 64.5, 37.5],
			['C', 64.5, 40.6, 63.3, 43.6, 61.7, 46],
			['Q', 67, 46, 67, 51.25],
			['Q', 67, 56.5, 61.5, 56.5],
			['L', 58.9, 56.5],
			['C', 59, 66.4, 62.1, 73.3, 75, 76],
			...peana(28, 12)
		) + ranura([61, 33.6], [48.2, 42.6], 3, 2)
}
