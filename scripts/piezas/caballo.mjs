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
	'C37.5 56 37 54.5 34 54.3L25 55C22 55.2 20 53.5 20 51L20 48C20 46 21 45 23 43.5' +
	'C28 39.5 32 36 35 33C38 30 39 27 42 25.5C44 24.5 46 24.5 47 24' +
	'C48 21.5 50.5 18 53.5 17C55 19.5 56 22 56.5 24.5C58 23.5 59.5 23.5 61 23.5'
// La nuca, de la oreja a donde acaba la crin; la cabeza sigue hasta el collar.
const nuca = 'C66 25 72 33 72 43C72 47.2 71.5 51 70.5 54.7'
const cuello = 'C69.8 57.2 69 59.6 68 62'

export default {
	letra: 'N',
	partes: [
		torno([50, 64], ['L', 61, 64], ['L', 61, 72], ['C', 61, 76, 64, 78, 73, 78], ...peana(PEANA)),
		`M37.5 63L37.5 59${perfil}${nuca}${cuello}Z`,
		torno([50, 60], ['L', 64.5, 60], ['Q', 68, 60, 68, 63.5], ['Q', 68, 67, 64.5, 67], ['L', 50, 67])
	],
	lineas: `${filetePeana(PEANA)}M20 50.5H27`,
	marcas: `M61 23.5${nuca}H65.5V43C65.5 35 63 29 57.5 25.5Z${circulo(44.5, 33.5, 3)}`,
	// La silueta que se ve en el tablero, sin juntas, como la del rey: las
	// partes con medio contorno más por los lados y por arriba, y la peana en
	// la línea base. Sin el ojo, que a 14 px mediría menos de un píxel.
	figura:
		'M50 88H24Q22 88 22 86V79C22 77.2 23.2 76 25 76C34 76 37 74.7 37 72V69H35.5Q30 69 30 63.5Q30 58 35.5 58' +
		'C35.5 57 35.1 56.3 33.9 56.3L25.2 57C20.8 57.2 18 54.6 18 51V48C18 45.2 18.8 44.1 21.8 41.9' +
		'C26.8 37.9 30.6 34.6 33.6 31.6C36.6 28.6 38.1 25.2 41.1 23.7C43.1 22.7 44.6 22.6 45.5 22.3' +
		'C46.1 20.8 49.9 16.1 52.9 15.1A2 2 0 0 1 55.2 16C56.7 18.5 57.5 20.2 57.9 21.7L61 21.5' +
		'C67.2 22.8 74 32.5 74 43C74 47.2 73.4 51.5 72.4 55.2C71.7 57.7 70.9 60.3 70 62.5V63.5Q70 69 64.5 69H63V72' +
		'C63 74.7 66 76 75 76C76.8 76 78 77.2 78 79V86Q78 88 76 88Z'
}
