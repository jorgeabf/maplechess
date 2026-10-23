// Torneos de menores: no se guardan (ver CLAUDE.md, «Torneos de menores»).
// Son los de hasta Sub 14 y los escolares, que dicen la edad o el colegio de
// quien juega aunque su ficha no enseñe el año. Se reconocen sólo por el
// nombre, al importarlos; los guardados los borra el reprocesado.
import { words } from '../lib/chess/names'

/**
 * Hasta Sub 14: «Sub 08», «Sub-8», «SUB12», «Sub 12y14», «U12», y las formas
 * cortas de las categorías («S08», «S-12», «S1416», de S14 a S16) y las de la
 * FIDE («| O10», «| G12», «- G11»; desde 2026, con edades impares). Tras el
 * número no puede seguir otro: así no entran los topes de ELO («Sub 1400»,
 * «Sub2200»). La O y la G con una cifra van aparte (FIDE_AGE): «G8» suelto
 * también es un grupo.
 */
const AGE =
	'(?:sub|u|under) ?0?(?:6|7|8|9|10|11|12|13|14)(?:1[0-8]|0[6-9])?(?!\\d)' +
	'|s ?0?(?:6|8|10|12|14)(?:1[0-8]|0[68])?(?!\\d)' +
	'|[og]1[0-4](?!\\d)'

/**
 * Las de la FIDE con una cifra («FIDE World Championship 2030 - O7», «| G9»):
 * sólo al final del nombre y tras un guion o una barra, porque «Jornada de
 * Entrenamiento G8» es un grupo. Sobre el nombre tal cual, con sus signos.
 */
const FIDE_AGE = /(?:\s[-–]|\|)\s*[OG]0?[6-9]\s*$/i

/** Los de niños: «Kids» y «para niños» («Santos Niños», una fiesta, no entra). */
const KIDS = 'kids|para nin[oa]s'

/**
 * Las categorías hasta infantil (Sub 14), también en catalán y gallego, y
 * pegadas a un número («ALEVIN2»). Cadete no: es Sub 16, y en inglés
 * («World Cadets») va con la edad.
 */
const CATEGORY = '(?:pre ?)?(?:benjamin(?:es)?|benjami|benxamin)|alevin(?:es)?|alevi|alebin|infantil(?:es|s)?'

/**
 * Los de un colegio o entre colegios (colegio, CEIP, IES, instituto,
 * ikastola…) y los escolares: los juegos escolares y el deporte en edad
 * escolar (JUDEX, Juegos Deportivos, Jocs Esportius, Xogade). Las escuelas de
 * ajedrez («Escuela», «Escola», «Eskola») son clubes, y no entran.
 */
const SCHOOL = [
	'colegios?|col ?legis?|ceips?|ies|institutos?|instituts?|college|schools?|ikastolak?|ikastetxeak?',
	'interescolar(?:es|s)?|intercentros|escolar(?:es|s)?',
	'judex|xogade|juegos deportivos|jj ?dd|jocs esportius|xogos deportivos'
].join('|')

/** Sobre las palabras del nombre sin tildes, en minúsculas y separadas por un espacio. */
const MINORS = new RegExp(
	`(?:^| )(?:(?:${AGE})|(?:${CATEGORY})(?![a-z])|(?:${SCHOOL}|${KIDS})(?= |$))`
)

/** ¿Es, por el nombre (o el slug de info64, que lleva las mismas palabras), un torneo de menores? */
export function isMinorsTournament(name: string): boolean {
	return FIDE_AGE.test(name) || MINORS.test(words(name).join(' '))
}
