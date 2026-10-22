import { describe, expect, it } from 'vitest'
import { parsePart, partName, sitemapIndex, sitemapParts, urlSet, xmlResponse } from '../src/lib/sitemap'

const site = new URL('https://maplechess.es')

describe('parsePart', () => {
	it('las páginas fijas y los trozos numerados desde 1', () => {
		expect(parsePart('paginas')).toEqual({ kind: 'paginas' })
		expect(parsePart('jugadores-1')).toEqual({ kind: 'jugadores', n: 1 })
		expect(parsePart('torneos-2')).toEqual({ kind: 'torneos', n: 2 })
		expect(parsePart('partidas-12')).toEqual({ kind: 'partidas', n: 12 })
		for (const name of ['paginas', 'jugadores-1', 'partidas-12']) expect(partName(parsePart(name)!)).toBe(name)
	})

	it('nada más', () => {
		for (const name of ['', 'partidas', 'partidas-0', 'partidas-01', 'partidas-1.xml', 'PARTIDAS-1', 'otros-1', 'paginas-1', 'partidas-1234567'])
			expect(parsePart(name), name).toBeNull()
		expect(parsePart(undefined)).toBeNull()
	})
})

describe('sitemapParts', () => {
	it('las páginas fijas y, de cada tipo, sus trozos', () => {
		expect(sitemapParts({ jugadores: 2, torneos: 1, partidas: 0 }).map(partName)).toEqual([
			'paginas',
			'jugadores-1',
			'jugadores-2',
			'torneos-1'
		])
	})
})

describe('XML', () => {
	it('el índice enlaza los trozos en el dominio', () => {
		expect(sitemapIndex([{ kind: 'paginas' }, { kind: 'partidas', n: 1 }], site)).toBe(
			'<?xml version="1.0" encoding="UTF-8"?>\n' +
				'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
				'<sitemap><loc>https://maplechess.es/sitemap/paginas.xml</loc></sitemap>\n' +
				'<sitemap><loc>https://maplechess.es/sitemap/partidas-1.xml</loc></sitemap>\n' +
				'</sitemapindex>\n'
		)
	})

	it('cada trozo da la URL canónica de sus páginas, escapada', () => {
		expect(urlSet(['/', '/acerca/', '/a&b'], site)).toBe(
			'<?xml version="1.0" encoding="UTF-8"?>\n' +
				'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
				'<url><loc>https://maplechess.es/</loc></url>\n' +
				'<url><loc>https://maplechess.es/acerca</loc></url>\n' +
				'<url><loc>https://maplechess.es/a&amp;b</loc></url>\n' +
				'</urlset>\n'
		)
		expect(urlSet([], site)).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>')
	})

	it('se sirve como XML y se puede guardar', () => {
		const res = xmlResponse('<urlset/>')
		expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
	})
})
