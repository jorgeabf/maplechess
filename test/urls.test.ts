import { describe, expect, it } from 'vitest'
import { canonicalHref, sourceName, sourceUrl } from '../src/lib/urls'

describe('canonicalHref', () => {
	const site = new URL('https://maplechess.es')

	it('la ruta sobre el dominio, sin barra final salvo en la portada', () => {
		expect(canonicalHref('/', site)).toBe('https://maplechess.es/')
		expect(canonicalHref('/jugadores/2299999', site)).toBe('https://maplechess.es/jugadores/2299999')
		expect(canonicalHref('/acerca/', site)).toBe('https://maplechess.es/acerca')
		expect(canonicalHref('', site)).toBe('https://maplechess.es/')
	})

	it('siempre en el dominio, aunque la ruta parezca otro sitio', () => {
		expect(new URL(canonicalHref('//evil.com/x', site)).host).toBe('maplechess.es')
		expect(new URL(canonicalHref('/torneos?q=open', site)).search).toBe('')
	})
})

describe('sourceUrl', () => {
	it('las páginas de info64, lichess y la FCA, por https', () => {
		for (const url of [
			'https://info64.org/ce-individual-absoluto-2025',
			'https://info64.org/ce-individual-absoluto-2025/3/12',
			'https://lichess.org/broadcast/campeonato/ronda-1/zK5CoVvF',
			'https://lichess.org/@evil.com',
			'https://www.fcajedrez.es/partidas/index.html?pgn=/assets/partidas/2008/liga_2008.pgn'
		])
			expect(sourceUrl(url), url).toBe(url)
	})

	it('nada más: ni javascript:, ni otro esquema, ni otro sitio que lo imite', () => {
		for (const url of [
			'javascript:alert(1)',
			'JAVASCRIPT:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'http://lichess.org/broadcast/x',
			'https://lichess.org.evil.com/x',
			'https://lichess.org@evil.com/x',
			'https://evil.com/https://lichess.org/',
			'//lichess.org/x',
			' https://lichess.org/x',
			'https://info64.org',
			'https://www.fcajedrez.es.evil.com/x',
			'http://www.fcajedrez.es/partidas/',
			''
		])
			expect(sourceUrl(url), url).toBeNull()
		expect(sourceUrl(null)).toBeNull()
		expect(sourceUrl(undefined)).toBeNull()
	})
})

describe('sourceName', () => {
	it('la FCA, por su web; las demás, por su nombre', () => {
		expect(sourceName('fca')).toBe('fcajedrez.es')
		expect(sourceName('info64')).toBe('info64')
		expect(sourceName('lichess')).toBe('lichess')
	})
})
