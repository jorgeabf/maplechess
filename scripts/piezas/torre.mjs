// Torre: robusta, de cuerpo ancho y casi recto, con una corona de tres
// merlones y un anillo bajo ella. La corona no entra en la esquina del número
// de la fila (comun.mjs, ESQUINAS).
import { filetePeana, peana, torno } from './comun.mjs'

// Corona con tres merlones y dos huecos de 6, con las esquinas de abajo redondeadas.
function corona(x0, x1, arriba, hueco, abajo, r = 3) {
	const merlon = (x1 - x0 - 12) / 3
	const xs = [x0, x0 + merlon, x0 + merlon + 6, x0 + 2 * merlon + 6, x0 + 2 * merlon + 12, x1]
	return (
		`M${xs[0]} ${arriba}H${xs[1]}V${hueco}H${xs[2]}V${arriba}H${xs[3]}V${hueco}H${xs[4]}V${arriba}H${xs[5]}` +
		`V${abajo - r}Q${x1} ${abajo} ${x1 - r} ${abajo}H${x0 + r}Q${x0} ${abajo} ${x0} ${abajo - r}Z`
	)
}

export default {
	letra: 'R',
	partes: [
		torno([50, 40], ['L', 66.5, 40], ['L', 69, 71], ['C', 69.5, 75.5, 70.5, 78, 74, 78], ...peana(27)),
		corona(27, 73, 25, 32, 41),
		torno([50, 40.5], ['L', 68.5, 40.5], ['Q', 71, 40.5, 71, 42.75], ['Q', 71, 45, 68.5, 45], ['L', 50, 45])
	],
	lineas: filetePeana(27)
}
