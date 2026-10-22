// Normalización y cruce de nombres de jugador.
//
// Las fuentes escriben el mismo nombre de formas distintas: info64 pone
// "Antón Guijarro, David" en el ranking y "Anton Guijarro,David" en el PGN
// (sin tildes y a veces sin espacio tras la coma). Para cruzarlos se compara
// una forma canónica: sin tildes, en minúsculas, "apellidos, nombre".

/** Quita tildes y diacríticos ("Núñez" → "Nunez"). */
export function stripDiacritics(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Palabras del nombre, sin tildes y en minúsculas. */
function words(text: string): string[] {
	return stripDiacritics(text)
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
}

/**
 * Forma canónica "apellidos, nombre". Separa por la primera coma; si no hay
 * coma devuelve las palabras tal cual.
 */
export function normalizeName(name: string): string {
	const comma = name.indexOf(',')
	if (comma === -1) return words(name).join(' ')
	const surnames = words(name.slice(0, comma)).join(' ')
	const given = words(name.slice(comma + 1)).join(' ')
	return given ? `${surnames}, ${given}` : surnames
}

export interface NameCandidate<T> {
	name: string
	value: T
}

/**
 * Busca a qué candidato corresponde un nombre. Prueba, en este orden:
 * 1. la misma forma canónica;
 * 2. las mismas palabras en otro orden ("Nombre Apellido" frente a "Apellido, Nombre");
 * 3. un único candidato cuyas palabras contienen todas las del nombre o
 *    viceversa (falta el segundo apellido o un segundo nombre).
 * Si un paso da más de un candidato, el cruce es ambiguo y no se asigna.
 */
export function matchName<T>(name: string, candidates: NameCandidate<T>[]): T | undefined {
	const target = normalizeName(name)
	const exact = candidates.filter((c) => normalizeName(c.name) === target)
	if (exact.length > 0) return exact.length === 1 ? exact[0].value : undefined

	const targetWords = words(name)
	if (targetWords.length === 0) return undefined
	const key = [...targetWords].sort().join(' ')
	const sameWords = candidates.filter((c) => [...words(c.name)].sort().join(' ') === key)
	if (sameWords.length > 0) return sameWords.length === 1 ? sameWords[0].value : undefined

	const targetSet = new Set(targetWords)
	const contained = candidates.filter((c) => {
		const set = new Set(words(c.name))
		const [small, large] = set.size <= targetSet.size ? [set, targetSet] : [targetSet, set]
		// Al menos dos palabras en común: con una sola ("Garcia") hay demasiados falsos positivos.
		return small.size >= 2 && [...small].every((w) => large.has(w))
	})
	return contained.length === 1 ? contained[0].value : undefined
}
