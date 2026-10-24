// Rey: la pieza más alta. Cuerpo de cintura estrecha que se abre hacia la
// peana, collar, copa con un filete de taracea y la cruz, de barras anchas
// para que el contorno no la cierre.
import { filetePeana, peana, poligono, torno } from './comun.mjs'

const cruz = poligono(
	[46, 3.5],
	[54, 3.5],
	[54, 8],
	[59.5, 8],
	[59.5, 15],
	[54, 15],
	[54, 22.5],
	[46, 22.5],
	[46, 15],
	[40.5, 15],
	[40.5, 8],
	[46, 8]
)

export default {
	letra: 'K',
	partes: [
		torno([50, 41], ['L', 63, 41], ['C', 60, 47, 59.5, 52, 60.3, 58], ['C', 61.2, 66, 64.5, 74, 74, 78], ...peana(27)),
		cruz,
		torno([50, 21.5], ['L', 64, 21.5], ['Q', 66, 21.5, 65.5, 23.5], ['L', 61, 37.5], ['L', 50, 37.5]),
		torno([50, 36.5], ['L', 64.5, 36.5], ['Q', 68, 36.5, 68, 39.5], ['Q', 68, 42.5, 64.5, 42.5], ['L', 50, 42.5])
	],
	lineas: `${filetePeana(27)}M38.5 27.5H61.5`
}
