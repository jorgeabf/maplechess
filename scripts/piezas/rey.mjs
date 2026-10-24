// Rey: la pieza más alta y la de más masa. Cuerpo de cintura ancha que se
// abre hacia la peana, collar ancho y corona de campana: se abre desde el
// collar y se cierra en una cúpula, con el filete de taracea donde es más
// ancha. Encima, una cruz de palo grueso, separada de la cúpula para que se
// lea entera.
//
// La cruz llega a y = 5,5, no a 2: más alto, en el tablero casi se salía de
// la casilla.
import { filetePeana, peana, poligono, torno } from './comun.mjs'

const cruz = poligono(
	[45, 5.5],
	[55, 5.5],
	[55, 10],
	[62.5, 10],
	[62.5, 16.5],
	[55, 16.5],
	[55, 24.5],
	[45, 24.5],
	[45, 16.5],
	[37.5, 16.5],
	[37.5, 10],
	[45, 10]
)

export default {
	letra: 'K',
	partes: [
		torno([50, 49.5], ['L', 65, 49.5], ['C', 63, 55.2, 62.5, 60, 63.2, 65.2], ['C', 64, 71.8, 67, 75.6, 74, 78], ...peana(27)),
		cruz,
		torno([50, 21.5], ['C', 59, 21.5, 68.5, 24.3, 69.3, 30], ['C', 69, 35.3, 65, 39.7, 63.8, 45.5], ['L', 50, 45.5]),
		torno([50, 44], ['L', 68.5, 44], ['Q', 72, 44, 72, 47.25], ['Q', 72, 50.5, 68.5, 50.5], ['L', 50, 50.5])
	],
	lineas: `${filetePeana(27)}M34 31H66`,
	// La silueta del rey que llegaba a y = 2, con medio contorno más por los
	// lados y por arriba, sin juntas y con la peana en la línea base. No baja
	// con la pieza: es la figura más alta y fija la escala de todas en la
	// notación, que se quedó así.
	figura: torno(
		[50, 0],
		['L', 57, 0],
		['L', 57, 4.5],
		['L', 64.5, 4.5],
		['L', 64.5, 15],
		['L', 57, 15],
		['L', 57, 16.6],
		['C', 63.5, 17.7, 70.7, 22.2, 71.3, 26.7],
		['C', 71.1, 30.7, 68.4, 36.2, 66.8, 40],
		['L', 68.5, 40],
		['Q', 74, 40, 74, 45.5],
		['Q', 74, 51, 68.5, 51],
		['L', 66.2, 51],
		['C', 65, 55.3, 64.5, 59.7, 65.2, 64.3],
		['C', 66, 71.3, 69.5, 75, 76, 76],
		...peana(29, 12)
	)
}
