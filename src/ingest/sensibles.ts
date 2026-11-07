// Torneos cuya participación revela un dato de salud o un dato penal (tabla
// torneos_sensibles, migración 0012): no se guardan. Se marcan a mano; aquí sólo
// se reconocen los que lo parecen, para apuntarlos y revisarlos (ver CLAUDE.md,
// «Torneos sensibles»).
import { stripDiacritics } from '../lib/chess/names'

/**
 * Palabras del nombre o la ciudad de esos torneos, también en inglés (las
 * retransmisiones de lichess, los mundiales que se juegan en España), catalán y
 * gallego: quién los organiza (la FEDC de ciegos, la FEDS de sordos, la ICCD,
 * la IPCA…), quién juega (sordos, ciegos…) o qué torneo es (inclusivo o
 * parainclusivo, adaptado). También los que se juegan en una prisión, que revelan
 * un dato penal (art. 10 RGPD), además en euskera; sin sufijos libres en «cárcel»
 * (Carcelén, Càrcer) ni en «preso» (Prešov), y sin «interno», que es el torneo
 * interno de un club. Sobre el texto sin tildes y en minúsculas. Sólo propone: lo
 * que no lo es («Blitz solidario…») se revisa y se marca con un 0.
 */
const SENSITIVE_WORDS = new RegExp(
	`\\b(${[
		'cieg[oa]s?|cegos|cecs|invidentes?|invidents|baja vision|deficien\\w*|blind|visually impaired',
		'sord\\w*|xord[oa]s|deaf',
		'discapaci\\w*|disab\\w*|diversi[td]a[dt] funcional|(?:para)?inclusi[uv]\\w*|inclusion|adaptad[oa]s?|wheelchair',
		'paral[iy]mpic\\w*|paralisis|sindrome|down|autis\\w*|asperger|tdah|salud mental|braille|special olympics',
		'fedc|feds|feddi|feddf|fedpc|iccd|ibca|ipca',
		'penitenciari\\w*|penitentiar\\w*|prisi?on\\w*|carcel(?:es|ari\\w*)?|carcer(?:e|ari\\w*)',
		'preso(?:s|ns|ner\\w*|ak|ek\\w*|en\\w*|ndegi\\w*)?|reclus(?:[oa]s?|ion\\w*|ori\\w*)?|espetxe\\w*|kartzel\\w*',
		'inmates?|jails?|correctional\\w*|incarcerat\\w*|presidios?|penal(?:es)?|privad[oa]s? de (?:la )?libertad'
	].join('|')})\\b`
)

/** La ONCE, en mayúsculas: en minúsculas es un número. */
const ONCE = /\bONCE\b/

/**
 * «A la ciega» (en catalán, «a la cega») es jugar sin ver el tablero: no dice
 * nada de quien juega. Se quita antes de buscar, así que «a la ciega para
 * ciegos» sigue contando.
 */
const BLINDFOLD = /\ba la (ciega|cega)\b/g

const telling = (text: string) =>
	ONCE.test(text) || SENSITIVE_WORDS.test(stripDiacritics(text).toLowerCase().replace(BLINDFOLD, ''))

/**
 * ¿Parece un torneo que revela un dato de salud o penal? Por su nombre o por su
 * ciudad, donde el organizador puede escribir el local («Centro Penitenciario…»).
 */
export function looksSensitive(name: string, city?: string | null): boolean {
	return telling(name) || (!!city && telling(city))
}
