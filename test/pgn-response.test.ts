import { describe, expect, it, vi } from 'vitest'
import { pgnResponse } from '../src/lib/pgn-response'

const PGNS = ['[Event "A"]\n\n1. e4 e5 1-0\n', '[Event "B"]\n\n1. d4 d5 *\n\n', '[Event "C"]\n\n1. c4 0-1']

async function* slowly(pgns: string[]): AsyncGenerator<string> {
	for (const pgn of pgns) yield pgn
}

describe('pgnResponse', () => {
	it('separa las partidas con una línea en blanco, como antes de enviarlas por trozos', async () => {
		const joined = PGNS.map((p) => p.trimEnd() + '\n').join('\n')
		expect(await pgnResponse(PGNS, 'x').text()).toBe(joined)
		expect(await pgnResponse(slowly(PGNS), 'x').text()).toBe(joined)
	})

	it('las envía a medida que llegan, sin Content-Length', async () => {
		const response = pgnResponse(slowly(PGNS), 'Martínez López')
		expect(response.headers.get('Content-Length')).toBeNull()
		expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="martinez-lopez.pgn"')
		const reader = response.body!.getReader()
		let chunks = 0
		while (!(await reader.read()).done) chunks++
		expect(chunks).toBe(PGNS.length)
	})

	it('un fallo a mitad corta la descarga y queda en el registro', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})
		async function* failing(): AsyncGenerator<string> {
			yield PGNS[0]
			throw new Error('D1 no responde')
		}
		await expect(pgnResponse(failing(), 'x').text()).rejects.toThrow('D1 no responde')
		expect(error).toHaveBeenCalledOnce()
		error.mockRestore()
	})
})
