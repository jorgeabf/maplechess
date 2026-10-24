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
	// La silueta de las tres partes en un solo contorno, sin el ojo: a 14 px
	// mediría menos de un píxel.
	figura:
		'M50 88H26Q24 88 24 86V81C24 79.2 25.2 78 27 78C36 78 39 76 39 72V67H35.5Q32 67 32 63.5Q32 60 35.5 60H37.5V59' +
		`${perfil}${nuca}${cuello}V63.5Q68 67 64.5 67H61V72C61 76 64 78 73 78C74.8 78 76 79.2 76 81V86Q76 88 74 88Z`
}
