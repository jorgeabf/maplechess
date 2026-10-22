import { describe, expect, it } from 'vitest'
import { FideListParser, parseHeader, parsePlayerLine, type FidePlayer } from '../../src/ingest/fide/parse'
import sample from '../fixtures/fide/players_list_sample.txt?raw'

const header = sample.split('\n')[0].replace(/\r$/, '')

/** Construye una línea de ancho fijo con las posiciones de la cabecera real. */
function line(values: Record<string, string>): string {
	const layout = parseHeader(header)
	let text = ''
	for (const [name, { start }] of layout) {
		text = text.padEnd(start, ' ') + (values[name] ?? '')
	}
	return text
}

describe('parseHeader', () => {
	it('lee las columnas de la cabecera, con "ID Number" como una sola', () => {
		const layout = parseHeader(header)
		expect(layout.get('ID Number')?.start).toBe(0)
		expect(layout.get('Name')?.start).toBe(15)
		expect(layout.get('Fed')?.start).toBe(76)
	})

	it('falla si falta una columna necesaria', () => {
		expect(() => parseHeader('ID Number      Name')).toThrow(/Fed/)
	})
})

describe('parsePlayerLine', () => {
	it('lee títulos, ratings y marcas', () => {
		const player = parsePlayerLine(
			line({
				'ID Number': '9227924',
				Name: 'Latat Nitudefi, Utuju',
				Fed: 'ESP',
				Sex: 'M',
				Tit: 'GM',
				SRtng: '2646',
				RRtng: '2600',
				BRtng: '0',
				'B-day': '1995',
				Flag: ''
			}),
			parseHeader(header)
		)
		expect(player).toEqual({
			fideId: 9227924,
			name: 'Latat Nitudefi, Utuju',
			fed: 'ESP',
			sex: 'M',
			title: 'GM',
			birthYear: 1995,
			ratingStd: 2646,
			ratingRapid: 2600,
			ratingBlitz: null,
			inactive: false
		})
	})

	it('usa el título femenino si no hay absoluto', () => {
		const player = parsePlayerLine(
			line({ 'ID Number': '1', Name: 'X, Y', Fed: 'ESP', Sex: 'F', WTit: 'WIM', Flag: 'wi' }),
			parseHeader(header)
		)
		expect(player).toMatchObject({ title: 'WIM', inactive: true })
	})
})

describe('FideListParser', () => {
	it('filtra la federación aunque los bytes lleguen partidos en trozos arbitrarios', () => {
		const players: FidePlayer[] = []
		const parser = new FideListParser('ESP', (p) => players.push(p))
		const bytes = new TextEncoder().encode(sample)
		for (let i = 0; i < bytes.length; i += 37) parser.push(bytes.subarray(i, i + 37))
		parser.end()

		const expected = sample.split('\n').filter((l) => l.slice(76, 79) === 'ESP').length
		expect(players).toHaveLength(expected)
		expect(players.every((p) => p.fed === 'ESP')).toBe(true)
		expect(players[0]).toMatchObject({ fideId: 9960119, name: 'Nevunenaman Lefop, Uzeba', ratingStd: 1800, birthYear: 1936, inactive: true })
		expect(players.find((p) => p.fideId === 97937734)?.title).toBeNull()
	})
})
