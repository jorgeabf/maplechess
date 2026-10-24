// Caballo: la cabeza no es de torno, es un perfil dibujado que mira a la
// izquierda, como en los diagramas, sobre la peana y el collar del peón. La
// cara a unos 45°, la frente marcada sobre el ojo, una oreja y el morro romo
// con la boca en un filete. El ojo es redondo, como el punto del «!?».
//
// La crin es una franja de taracea: la madera del otro color incrustada en la
// nuca, como el arce del logo en el nogal. Además deja clara la nuca entera
// del negro, que sobre el nogal sólo se ve por el contorno: sin ella, en los
// bordes inclinados de la cabeza el contorno no llegaba a 4,5:1.
import { circulo, filetePeana, peana, torno } from './comun.mjs'

const PEANA = 26

// El perfil, del pecho a la oreja: quijada y morro, cara y frente, oreja.
const perfil =
	'C38.5 56 38 54.5 35.3 54.3L27 55C24.2 55.2 22.4 53.5 22.4 51L22.4 48C22.4 46 23.3 45 25.2 43.5' +
	'C29.8 39.5 33.4 36 36.2 33C39 30 39.9 27 42.6 25.5C44.5 24.5 46.3 24.5 47.2 24' +
	'C48.2 21.5 50.5 18 53.2 17C54.6 19.5 55.5 22 56 24.5C57.4 23.5 58.7 23.5 60.1 23.5'
// La nuca, de la oreja a donde acaba la crin; la cabeza sigue hasta el collar.
const nuca = 'C64.7 25 70.2 33 70.2 43C70.2 47.2 69.8 51 68.9 54.7'
const cuello = 'C68.2 57.2 67.5 59.6 66.6 62'

export default {
	letra: 'N',
	partes: [
		torno([50, 64], ['L', 61, 64], ['L', 61, 72], ['C', 61, 76, 64, 78, 73, 78], ...peana(PEANA)),
		`M38.5 63L38.5 59${perfil}${nuca}${cuello}Z`,
		torno([50, 60], ['L', 64.5, 60], ['Q', 68, 60, 68, 63.5], ['Q', 68, 67, 64.5, 67], ['L', 50, 67])
	],
	lineas: `${filetePeana(PEANA)}M22.4 50.5H28.8`,
	marcas: `M60.1 23.5${nuca}H64.3V43C64.3 35 62 29 56.9 25.5Z${circulo(44.9, 33.5, 3)}`,
	// La silueta que se ve en el tablero, sin juntas, como la del rey: las
	// partes con medio contorno más por los lados y por arriba, y la peana en
	// la línea base. Sin el ojo, que a 14 px mediría menos de un píxel.
	figura:
		'M50 88H24Q22 88 22 86V79C22 77.2 23.2 76 25 76C34 76 37 74.7 37 72V69H35.5Q30 69 30 63.5Q30 58 35.5 58H36.5' +
		'C36.5 57 36.3 56.3 35.2 56.3L27.2 57C23 57.2 20.4 54.6 20.4 51V48C20.4 45.2 21.1 44.1 23.9 41.9' +
		'C28.6 37.9 32.1 34.6 34.8 31.6C37.6 28.6 39 25.2 41.7 23.7C43.7 22.7 45 22.6 45.9 22.3' +
		'C46.4 20.8 49.9 16.1 52.7 15.1A2 2 0 0 1 55 16C56.2 18.5 56.9 20.2 57.3 21.7L60.1 21.5' +
		'C65.9 22.8 72.2 32.5 72.2 43C72.2 47.2 71.6 51.5 70.7 55.2C70.2 56.8 69.7 58.5 69.2 60.1Q70 61.4 70 63.5' +
		'Q70 69 64.5 69H63V72C63 74.7 66 76 75 76C76.8 76 78 77.2 78 79V86Q78 88 76 88Z'
}
