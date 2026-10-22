// ELO verosímiles. Algunas fuentes ponen otros números en la columna o la
// cabecera del ELO FIDE: en producción hay valores de 1 a 20 en torneos de
// menores, un 118 en un blitz y hasta un 4296.

/** Suelo de la lista FIDE entre 2012 y 2024 (desde marzo de 2024 es 1400). */
export const MIN_RATING = 1000
/** Por encima de cualquier ELO FIDE de la historia (el récord es 2882). */
export const MAX_RATING = 3000

/** El ELO si es verosímil; si no, null. */
export function plausibleRating(value: number | null | undefined): number | null {
	return value != null && value >= MIN_RATING && value <= MAX_RATING ? value : null
}
