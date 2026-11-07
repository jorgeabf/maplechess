// Caballo: la cabeza no es de torno, es un perfil dibujado que mira a la
// izquierda, como en los diagramas, con la crin en mechones.
import { Y_PLINTO, doble, junta, libre } from './comun.mjs'

const cuerpo =
	// Pecho y cuello por delante, hasta la garganta.
	'M28.6 75.1C28.8 72.4 31 69.8 34.6 66.1C38.2 62.2 44.4 58 47.3 52.8Q47.6 52.3 47.1 52.7' +
	// Quijada y mentón.
	'C45.6 54.2 43.4 55.2 40.6 55.9C36 57 30.6 58.9 27 61.4' +
	'C25.2 62.6 23.2 63.6 21 63.4C18.9 63.2 17.4 61.8 17.2 59.8L15.8 59' +
	// Belfo.
	'C13.5 58.8 11.5 56.9 11.1 54.1C10.7 51.2 11.8 48.9 13.3 46.7' +
	// Perfil de la cara hasta la frente.
	'C17.8 43.2 21.8 39 24.6 33.9C26.2 30.9 28.4 28.4 31.4 26.5L33.6 26.3L36.8 23.6' +
	// Orejas.
	'C36.4 20.4 37.6 17 39.6 14.1C42.2 16.6 44 19.6 44.8 22.5C45.4 20.2 46.4 18.3 48 16.4C49.8 18.3 50.8 20.4 51 22.3' +
	// Crin: tres mechones y el remate del cuello. Cada uno sigue la envolvente y
	// acaba en una punta que cae; las muescas, hondas y abiertas, porque el contorno
	// rellena las estrechas y a 32 px sólo queda ruido.
	'C58 20.6 67 23 73 31Q68 31 64.5 34C72 37 81 44 84 53Q79.6 51.6 74.5 54C79.4 57 84.2 61 84.4 67.4Q80.6 65.8 76.4 66' +
	'C78.2 69 77.4 72.8 74.6 75.9'
const base = 'L74.6 79.7L77 79.7L77 88.3L23 88.3L23 79.7L25.4 79.7L25.4 75.9Q25.4 75.1 26.2 75.1L28.6 75.1Z'
const ojo = 'M28.8 35.8C30 32.2 33.6 30.6 37.6 31.6C37.9 34.6 35.4 37.4 32.4 37.4C30.8 37.4 29.6 36.7 28.8 35.8Z'
// Tres pelos de la crin. En las blancas, finos: dan el aire de grabado en grande y
// a 32 px casi no se ven, porque ya se ve el contorno.
const pelos =
	'M63 35.2C60.4 33.4 57.8 33.4 55.8 34.8C58 34.4 60.4 34.8 63 35.2Z' +
	'M72.8 55C69.6 50.8 65.4 49.2 60.6 50C65 50.6 69 52.6 72.8 55Z' +
	'M74.8 66.6C73 62.6 69.8 60.4 66 60.2C69.4 61.4 72.4 63.6 74.8 66.6Z'
// En las negras, los pelos son lo único que dibuja la crin por dentro: con el
// doble de grueso, a 32 px a 1× dejan de empastarse.
const pelosNegra =
	'M64.4 35.8C61.4 32.6 57.8 32.2 54.8 34.6C57.8 34.8 60.8 35.2 64.4 35.8Z' +
	'M73.4 55.8C69.8 50.2 65 48 59.8 49C64.6 50.2 69 52.8 73.4 55.8Z' +
	'M75.4 67.4C73.4 62 69.6 59 65.4 59C69.2 60.8 72.4 63.8 75.4 67.4Z'
// En las negras, la mejilla es un creciente que no toca la garganta: a 32 px, en
// la columna 16 casi entero, y en grande no parece un paréntesis suelto.
const mejilla =
	'M47.8 31.2C52.8 33.2 54.8 37.6 54.8 42.2C54.8 45.4 53.8 48.4 51.9 51' +
	'C51.4 47.6 50.2 44.6 49.7 41.2C49.2 37.8 49 34.4 47.8 31.2Z'

export default {
	letra: 'N',
	partes: [cuerpo + base],
	lineas: [
		// La mejilla: de la garganta hacia la oreja. En las negras va en las marcas.
		doble('M47.6 52.3C51.2 48.2 52.2 42.6 50.8 37.4C50.2 35.4 49.2 33.6 47.8 32.2', ''),
		// La boca.
		libre('M18.4 56.6C20.8 56.2 23.4 55.6 25.6 54.4'),
		junta(Y_PLINTO, 25.4, 0, 3)
	],
	marcas: doble(ojo + pelos, ojo + pelosNegra + mejilla),
	// La silueta que se ve en el tablero, sin juntas ni ojo: el trazado con medio
	// contorno más, hasta la línea base.
	figura:
		// Las orejas.
		'M39.3 11.5C41.6 13.6 43.6 15.8 44.7 18C45.4 16.4 46.6 15 47.9 13.9C49.8 15.6 51.4 17.8 52.3 20.3' +
		// La crin.
		'C59 19.2 68.6 23 76.3 32.6Q71.4 32.2 68 33.7C74.6 37.6 83 45 86.5 55.3Q82 53.6 78.3 54.4' +
		'C82.8 58 86.2 63 86.1 69.9Q82.2 68 78.8 67.8C79.6 71 78.6 74 76.2 76.5' +
		// La base.
		'V78H78.6V90H21.3V78H23.7V75.6Q23.7 73.4 27.1 73.4' +
		// Pecho, garganta y quijada.
		'C28.6 69.6 33.6 64.6 41.3 57.5C36 58.8 30 61.4 24.5 64.5C20.6 65.8 16.2 64.6 15.5 60.7' +
		// Belfo y cara, hasta la oreja.
		'C11.8 59.6 9.4 57.2 9.4 52.8C9.4 48.8 11.6 45.8 15.4 42.7C19.6 39.2 23 33.8 26 28.8' +
		'C27.6 26.8 29.2 25.2 30.9 24.8L32.8 24.7L35 22.8C34.8 18.8 36.6 14.8 39.3 11.5Z'
}
