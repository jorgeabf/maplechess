import { describe, expect, it } from 'vitest'
import { sourceUrl } from '../src/lib/urls'

describe('sourceUrl', () => {
	it('las páginas de info64 y lichess, por https', () => {
		for (const url of [
			'https://info64.org/ce-individual-absoluto-2025',
			'https://info64.org/ce-individual-absoluto-2025/3/12',
			'https://lichess.org/broadcast/campeonato/ronda-1/zK5CoVvF',
			'https://lichess.org/@evil.com'
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
			''
		])
			expect(sourceUrl(url), url).toBeNull()
		expect(sourceUrl(null)).toBeNull()
		expect(sourceUrl(undefined)).toBeNull()
	})
})
