// Los parámetros de los endpoints públicos de Eguidazu: las listas que se
// piden por lotes (/api/clasificaciones, /api/elo: «?info64=a,b,c») y el 400
// de un parámetro mal escrito (también /api/torneos).

/**
 * Los valores de `name`, sin repetir y en su orden, o un error si no hay
 * ninguno, si son más de `max` o si alguno no casa con `valid`.
 */
export function listParam(
	params: URLSearchParams,
	name: string,
	max: number,
	valid: RegExp
): { values: string[] } | { error: string } {
	const values = [
		...new Set(
			(params.get(name) ?? '')
				.split(',')
				.map((v) => v.trim())
				.filter(Boolean)
		)
	]
	if (values.length === 0) return { error: `Falta «${name}», una lista separada por comas.` }
	if (values.length > max) return { error: `Como mucho ${max} valores en «${name}».` }
	const wrong = values.find((v) => !valid.test(v))
	return wrong === undefined ? { values } : { error: `Valor no válido en «${name}»: ${wrong}` }
}

/** 400 con el error, con la caché por defecto (sin caché). */
export const badRequest = (error: string): Response => Response.json({ error }, { status: 400 })
