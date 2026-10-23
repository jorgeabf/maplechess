// Torneos cuya participación revela un dato de salud (tabla torneos_sensibles,
// migración 0012): no se guardan. Se marcan a mano; aquí sólo se reconocen por
// el nombre los que lo parecen, para apuntarlos y revisarlos (ver CLAUDE.md,
// «Torneos sensibles»).
import { stripDiacritics } from '../lib/chess/names'

/**
 * Palabras de los nombres de esos torneos, también en inglés (las
 * retransmisiones de lichess, los mundiales que se juegan en España), catalán y
 * gallego: quién los organiza (la FEDC de ciegos, la FEDS de sordos, la ICCD,
 * la IPCA…), quién juega (sordos, ciegos…) o qué torneo es (inclusivo,
 * adaptado). También los que se juegan en una prisión, que revelan un dato
 * penal (art. 10 RGPD). Sobre el nombre sin tildes y en minúsculas. Sólo
 * propone: lo que no lo es («Blitz solidario…») se revisa y se marca con un 0.
 */
const SENSITIVE_WORDS = new RegExp(
	`\\b(${[
		'cieg[oa]s?|cegos|cecs|invidentes?|invidents|baja vision|deficien\\w*|blind|visually impaired',
		'sord\\w*|xord[oa]s|deaf',
		'discapaci\\w*|disab\\w*|diversi[td]a[dt] funcional|inclusi[uv]\\w*|inclusion|adaptad[oa]s?|wheelchair',
		'paral[iy]mpic\\w*|paralisis|sindrome|down|autis\\w*|asperger|tdah|salud mental|braille|special olympics',
		'fedc|feds|feddi|feddf|fedpc|iccd|ibca|ipca',
		'penitenciari\\w*|prision|carcel'
	].join('|')})\\b`
)

/** La ONCE, en mayúsculas: en minúsculas es un número. */
const ONCE = /\bONCE\b/

/** ¿Parece, por el nombre, un torneo que revela un dato de salud? */
export function looksSensitive(name: string): boolean {
	return ONCE.test(name) || SENSITIVE_WORDS.test(stripDiacritics(name).toLowerCase())
}
