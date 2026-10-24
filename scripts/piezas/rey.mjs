// Rey: la pieza más alta y la de más masa. Cuerpo de cintura ancha que se
// abre hacia la peana, collar ancho y corona de campana: se abre desde el
// collar y se cierra en una cúpula, con el filete de taracea donde es más
// ancha. Encima, una cruz de palo grueso, separada de la cúpula para que se
// lea entera.
import { filetePeana, peana, poligono, torno } from './comun.mjs'

const cruz = poligono(
	[45, 2],
	[55, 2],
	[55, 6.5],
	[62.5, 6.5],
	[62.5, 13],
	[55, 13],
	[55, 21],
	[45, 21],
	[45, 13],
	[37.5, 13],
	[37.5, 6.5],
	[45, 6.5]
)

export default {
	letra: 'K',
	partes: [
		torno([50, 48], ['L', 65, 48], ['C', 63, 54, 62.5, 59, 63.2, 64.5], ['C', 64, 71.5, 67, 75.5, 74, 78], ...peana(27)),
		cruz,
		torno([50, 18], ['C', 59, 18, 68.5, 21, 69.3, 27], ['C', 69, 32.5, 65, 37, 63.8, 43], ['L', 50, 43]),
		torno([50, 42], ['L', 68.5, 42], ['Q', 72, 42, 72, 45.5], ['Q', 72, 49, 68.5, 49], ['L', 50, 49])
	],
	lineas: `${filetePeana(27)}M34 28H66`,
	// La silueta que se ve en el tablero, sin juntas: las partes con medio
	// contorno más por los lados y por arriba, y la peana en la línea base.
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
