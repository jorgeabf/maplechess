// Peticiones a las fuentes. Los reintentos con espera los hace el Workflow
// (cada paso tiene su política), así que aquí sólo se identifica el cliente y
// se convierte cualquier respuesta no 2xx en error para que el paso se reintente.

// Sólo ASCII: los valores de cabecera HTTP no admiten otros caracteres.
const USER_AGENT = 'BuscadorPartidasAjedrez/0.1 (indexador; max 1 req/s)'

export class HttpError extends Error {
	constructor(
		readonly url: string,
		readonly status: number
	) {
		super(`HTTP ${status} en ${url}`)
	}
}

export async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers)
	headers.set('User-Agent', USER_AGENT)
	// info64 traduce sus textos según el idioma; los parsers esperan inglés.
	headers.set('Accept-Language', 'en')
	const response = await fetch(url, { ...init, headers })
	if (!response.ok) {
		await response.body?.cancel()
		throw new HttpError(url, response.status)
	}
	return response
}

export async function fetchText(url: string): Promise<string> {
	return (await fetchOk(url)).text()
}
