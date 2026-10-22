// Respuesta HTTP de descarga de PGN.
import { fileSlug } from './format'

/**
 * Las partidas, separadas por la línea en blanco que pide el estándar: cada
 * una sin espacios al final y con su salto de línea.
 */
async function* separated(pgns: Iterable<string> | AsyncIterable<string>): AsyncGenerator<string> {
	let first = true
	for await (const pgn of pgns) {
		yield `${first ? '' : '\n'}${pgn.trimEnd()}\n`
		first = false
	}
}

/**
 * Descarga de las partidas `pgns` a medida que llegan (gamesPgn las lee por
 * lotes), sin juntarlas antes en memoria. Si algo falla a mitad, el 200 ya ha
 * salido y el archivo queda cortado: el error queda en el registro.
 */
export function pgnResponse(pgns: Iterable<string> | AsyncIterable<string>, name: string): Response {
	const chunks = separated(pgns)
	const encoder = new TextEncoder()
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { value, done } = await chunks.next()
				if (done) controller.close()
				else controller.enqueue(encoder.encode(value))
			} catch (error) {
				console.error('Descarga PGN cortada:', name, error)
				controller.error(error)
			}
		},
		async cancel() {
			await chunks.return(undefined)
		}
	})
	return new Response(body, {
		headers: {
			'Content-Type': 'application/x-chess-pgn; charset=utf-8',
			'Content-Disposition': `attachment; filename="${fileSlug(name)}.pgn"`,
			'Cache-Control': 'public, max-age=300'
		}
	})
}

export function notFound(message = 'No encontrado'): Response {
	return new Response(message, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
