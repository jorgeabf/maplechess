// ELO y FIDE ID verosímiles. Algunas fuentes ponen otros números en la
// columna o la cabecera del ELO FIDE: en producción hay valores de 1 a 20 en
// torneos de menores, un 118 en un blitz y hasta un 4296. Y en la del FIDE ID,
// el número de una federación territorial (de 1 a 5 cifras, en torneos
// andaluces) o un «1» de relleno: cada uno haría una ficha que no es de nadie.

/** Suelo de la lista FIDE entre 2012 y 2024 (desde marzo de 2024 es 1400). */
export const MIN_RATING = 1000
/** Por encima de cualquier ELO FIDE de la historia (el récord es 2882). */
export const MAX_RATING = 3000

/** El ELO si es verosímil; si no, null. */
export function plausibleRating(value: number | null | undefined): number | null {
	return value != null && value >= MIN_RATING && value <= MAX_RATING ? value : null
}

/**
 * Por debajo no hay FIDE ID: ninguno de los 9 números menores probados en
 * ratings.fide.com tiene perfil, el 100013 (Argentina) sí, y la lista española
 * empieza en el 100234 (comprobado el 4-nov-2026).
 */
export const MIN_FIDE_ID = 100000

/** El FIDE ID si es verosímil; si no, null. */
export function plausibleFideId(value: number | null | undefined): number | null {
	return value != null && Number.isSafeInteger(value) && value >= MIN_FIDE_ID ? value : null
}
