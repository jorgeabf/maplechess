// Torneos de menores: no se guardan (ver CLAUDE.md, «Torneos de menores»).
// Son los de hasta Sub 14 y los escolares, que dicen la edad o el colegio de
// quien juega aunque su ficha no enseñe el año. Se reconocen sólo por el
// nombre (y su fecha, para los años de nacimiento), al importarlos; los
// guardados los borra el reprocesado.
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

/**
 * Los de niños: «Kids» y «para niños», también en gallego («para nenos», «para
 * rapaces»), catalán («per a nens», «per a infants») y euskera («Umeentzat»,
 * «Haurrentzat», «Txikientzat»: el «I Aiarako Txapelketa Umeentzat» se
 * colaba). «Santos Niños», una fiesta, no entra.
 */
const KIDS =
	'kids|para nin[oa]s|para nen[oa]s|para rapa(?:ces|zas)|per a (?:nen(?:s|es)|infants)|umeentzat|haurrentzat|txikientzat'

/**
 * Las categorías hasta infantil (Sub 14), también en catalán y gallego, y
 * pegadas a un número («ALEVIN2»). Cadete no: es Sub 16, y en inglés
 * («World Cadets») va con la edad.
 */
const CATEGORY = '(?:pre ?)?(?:benjamin(?:es)?|benjami|benxamin)|alevin(?:es)?|alevi|alebin|infantil(?:es|s)?'

/**
 * Los de un colegio o entre colegios (colegio, CEIP, IES, instituto,
 * ikastola…) y los escolares: los juegos escolares y el deporte en edad
 * escolar (JUDEX, Juegos Deportivos, Jocs Esportius, Xogade). También los
 * que no lo dicen con esas palabras: el «Torneig d'Escoles» de Xàtiva, de Sub
 * 8 a Sub 16 (en el slug, «torneig-descoles»); los interescolares en euskera
 * («Eskolarteko Xake Txapelketa», «Eskolartekoa»); y en gallego, el programa
 * «Xadrez nas Escolas» y el «Torneio das Escolas». Las escuelas de ajedrez
 * («Escuela», «Escola», «Escolas», «Eskola») son clubes, y no entran.
 */
const SCHOOL = [
	'colegios?|col ?legis?|ceips?|ies|institutos?|instituts?|college|schools?|ikastolak?|ikastetxeak?',
	'interescolar(?:es|s)?|intercentros|escolar(?:es|s)?|eskolarteko(?:a|ak)?',
	'torneig d ?escoles|nas escolas|torne(?:o|io) das escolas',
	'judex|xogade|juegos deportivos|jj ?dd|jocs esportius|xogos deportivos'
].join('|')

/** Sobre las palabras del nombre sin tildes, en minúsculas y separadas por un espacio. */
const MINORS = new RegExp(
	`(?:^| )(?:(?:${AGE})|(?:${CATEGORY})(?![a-z])|(?:${SCHOOL}|${KIDS})(?= |$))`
)

/**
 * Los «por edades» con todas las categorías juntas o por letras («Previa A»,
 * «Final D»), que son sobre todo de niños: también los grupos de adultos por
 * letra, porque la letra cambia de un año a otro (decidido el 25-oct-2026,
 * medido en producción). No los que dicen Sub 16 o Sub 18, cadete, juvenil o
 * veteranos (+50, +65, V50, S65, Supra 50).
 */
const BY_AGE = /(?:^| )por edades(?= |$)/
const OLDER =
	/(?:^| )(?:(?:sub|s|u) ?1[68]|cadetes?|juvenil(?:es)?|veteran[oa]s?|senior(?:s|es)?|mayores|supra ?\d*|[sv] ?(?:50|55|60|65|70|75))(?= |$)/
/** Sobre el nombre tal cual: sin el signo, «2025 +50» serían dos números. */
const PLUS_AGE = /\+\s?(?:50|55|60|65|70|75)(?!\d)/

/**
 * Los años de nacimiento seguidos del nombre, enteros o con sus dos últimas
 * cifras: el Circuito PROMOCHESS de Alicante nombra así sus categorías, sin
 * «Sub» («Cat. A (2019-2018-2017)», «Grupo B (2011, 2012 y 2013)», «Cat. A
 * (2017-18-19)», «Cat. B (2015-2016)»). La barra corta la serie: es la de una
 * temporada («2008/09», como las añade el archivo de Cantabria).
 */
function yearRuns(name: string): number[][] {
	const runs: number[][] = []
	let run: number[] = []
	for (const word of words(name.replaceAll('/', ' barra '))) {
		const last = run.at(-1)
		// «2011, 2012 y 2013», también en catalán y gallego («i», «e»).
		if ((word === 'y' || word === 'i' || word === 'e') && last !== undefined) continue
		const full = /^(?:19|20)\d\d$/.test(word)
		const year = full ? Number(word) : last !== undefined && /^\d\d$/.test(word) ? last - (last % 100) + Number(word) : null
		const step = run.length >= 2 ? run[1] - run[0] : null
		if (year !== null && last !== undefined && Math.abs(year - last) === 1 && (step === null || year - last === step)) {
			run.push(year)
			continue
		}
		if (run.length >= 2) runs.push(run)
		run = full ? [Number(word)] : []
	}
	if (run.length >= 2) runs.push(run)
	return runs
}

/**
 * ¿Es una categoría por años de nacimiento? Con el año del torneo, dos o más
 * años seguidos en los que el más joven tiene de 4 a 13 años: así una
 * temporada («Cto. de Madrid 2014-2015») no entra. Sin él (el slug de una
 * pasada con keys), sólo tres, porque una temporada son dos, y el más joven
 * nacido en 2000 o después. Entraría de más una temporada aplazada cuatro años
 * o más («Liga 2019-20» jugada en 2024): no hay ninguna en producción.
 */
function isBirthYearGroup(run: number[], year: number | null): boolean {
	const youngest = Math.max(...run)
	return year === null ? run.length >= 3 && youngest >= 2000 : youngest >= year - 13 && youngest <= year - 4
}

/**
 * ¿Es, por el nombre (o el slug de info64, que lleva las mismas palabras), un
 * torneo de menores? La fecha del torneo ('YYYY-MM-DD…'), si se sabe, sirve
 * para reconocer los años de nacimiento.
 */
export function isMinorsTournament(name: string, date?: string | null): boolean {
	const text = words(name).join(' ')
	const year = date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null
	return (
		FIDE_AGE.test(name) ||
		MINORS.test(text) ||
		(BY_AGE.test(text) && !OLDER.test(text) && !PLUS_AGE.test(name)) ||
		yearRuns(name).some((run) => isBirthYearGroup(run, year))
	)
}
