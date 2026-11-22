import { describe, expect, it } from 'vitest'
import {
	clip,
	DESCRIPTION_MAX,
	lastStartedTournament,
	playerDescription,
	playerTitle,
	tournamentDescription,
	type DescribedPlayer,
	type DescribedTournament
} from '../src/lib/descripciones'

const LONG = 'Torneo Internacional Abierto Inventado de Ajedrez Clásico Memorial Supuesto Irreal '.repeat(4).trim()
const chars = (text: string) => [...text].length

describe('clip', () => {
	it('deja lo que cabe y corta lo demás entre palabras, con «…»', () => {
		expect(clip('Open de Bilbao', 20)).toBe('Open de Bilbao')
		expect(clip('Open Inventado de Bilbao 2026', 25)).toBe('Open Inventado de Bilbao…')
		expect(chars(clip(LONG))).toBeLessThanOrEqual(DESCRIPTION_MAX)
	})

	it('si el corte cae justo antes de un espacio, se queda la última palabra entera', () => {
		expect(clip('aaaa bbbb cccc dddd', 15)).toBe('aaaa bbbb cccc…')
	})

	it('sin espacios, corta donde toca; sin partir un carácter de dos unidades', () => {
		expect(clip('x'.repeat(30), 10)).toBe(`${'x'.repeat(9)}…`)
		expect(clip('🏆'.repeat(30), 10)).toBe(`${'🏆'.repeat(9)}…`)
	})

	it('no deja una coma, un punto ni un conector antes de «…»', () => {
		expect(clip('Bilbao, Bizkaia, España', 17)).toBe('Bilbao, Bizkaia…')
		expect(clip('Open Inventado de Bilbao 2026', 20)).toBe('Open Inventado…')
		expect(clip('Memorial Inventado de la Villa de Bilbao', 24)).toBe('Memorial Inventado…')
	})
})

describe('tournamentDescription', () => {
	const open: DescribedTournament = {
		name: 'Open Inventado de Bilbao 2026',
		city: 'Bilbao',
		startDate: '2026-10-17',
		endDate: '2026-11-28',
		rounds: 7,
		facts: { size: '66 jugadores', titles: ['2 GM', '5 IM'], average: 2105 },
		standings: true
	}
	const describe_ = (t: Partial<DescribedTournament>) => tournamentDescription({ ...open, ...t })

	it('la ciudad, las fechas, las rondas, el resumen y qué hay en la página', () => {
		expect(describe_({})).toBe(
			'Bilbao, 17 oct – 28 nov 2026. 7 rondas · 66 jugadores, 2 GM, 5 IM · ELO medio 2105. Clasificación y partidas.'
		)
		expect(describe_({ standings: false, rounds: 1, facts: { size: '2 jugadores', titles: [], average: null } })).toBe(
			'Bilbao, 17 oct – 28 nov 2026. 1 ronda · 2 jugadores. Participantes y partidas.'
		)
	})

	it('sin un dato, sin su trozo', () => {
		expect(describe_({ city: null, rounds: null })).toBe(
			'17 oct – 28 nov 2026. 66 jugadores, 2 GM, 5 IM · ELO medio 2105. Clasificación y partidas.'
		)
		expect(describe_({ startDate: null, endDate: null, facts: null })).toBe(
			'Bilbao. 7 rondas. Clasificación y partidas.'
		)
		expect(describe_({ endDate: null, city: '  ', facts: null, rounds: null })).toBe(
			'17 oct 2026. Clasificación y partidas.'
		)
	})

	it('sin ningún dato, el nombre', () => {
		expect(describe_({ city: null, startDate: null, endDate: null, rounds: null, facts: null })).toBe(
			'Open Inventado de Bilbao 2026: clasificación y partidas.'
		)
		const long = describe_({ name: LONG, city: null, startDate: null, endDate: null, rounds: null, facts: null })
		expect(chars(long)).toBeLessThanOrEqual(DESCRIPTION_MAX)
		expect(long).toMatch(/^Torneo Internacional .*…$/)
	})

	it('una ciudad larguísima se recorta y lo demás se queda', () => {
		const text = describe_({ city: LONG })
		expect(chars(text)).toBeLessThanOrEqual(DESCRIPTION_MAX)
		expect(text).toMatch(/^Torneo Internacional .*…, 17 oct – 28 nov 2026\. 7 rondas · .* Clasificación y partidas\.$/)
		// Sin fechas, la ciudad recortada acaba la frase: sin punto tras «…».
		const alone = describe_({ city: LONG, startDate: null, endDate: null })
		expect(chars(alone)).toBeLessThanOrEqual(DESCRIPTION_MAX)
		expect(alone).toMatch(/^Torneo Internacional .*[^.]… 7 rondas · /)
	})

	it('con todo larguísimo, 160 como mucho', () => {
		const text = describe_({ city: LONG, facts: { size: LONG, titles: [], average: 2105 } })
		expect(chars(text)).toBeLessThanOrEqual(DESCRIPTION_MAX)
	})
})

describe('playerTitle', () => {
	it('el nombre delante, y más corto si no cabe con el nombre del sitio', () => {
		expect(playerTitle('David Anton Guijarro')).toBe('David Anton Guijarro: ELO y partidas de ajedrez')
		expect(playerTitle('Francisco Inventado Supuesto Irreal')).toBe('Francisco Inventado Supuesto Irreal: ELO y partidas')
	})

	it('completo hasta 52 caracteres, que son 65 con « · MapleChess»', () => {
		expect(playerTitle('Ana Supuesta Irreal Otros')).toBe('Ana Supuesta Irreal Otros: ELO y partidas de ajedrez')
		expect(playerTitle('Ana Supuesta Irreales Otros')).toBe('Ana Supuesta Irreales Otros: ELO y partidas')
	})
})

describe('playerDescription', () => {
	const gm: DescribedPlayer = {
		name: 'Otro Supuesto Irreal',
		fideId: 2299999,
		title: 'GM',
		ratingStd: 2650,
		ratingRapid: 2601,
		ratingBlitz: 2580,
		inFideList: true,
		minor: false,
		tournaments: 85,
		games: 12345,
		lastTournament: 'Open Inventado de Bilbao 2026'
	}
	const describe_ = (p: Partial<DescribedPlayer>) => playerDescription({ ...gm, ...p })
	const generic = 'Partidas y torneos de Otro Supuesto Irreal (FIDE 2299999).'

	it('el título, el ELO de cada ritmo, sus torneos y partidas y el último torneo', () => {
		expect(describe_({})).toBe(
			'GM · ELO FIDE: 2650 estándar, 2601 rápidas, 2580 blitz. 85 torneos y 12.345 partidas. ' +
				'Último torneo: Open Inventado de Bilbao 2026.'
		)
	})

	it('sin un dato, sin su trozo', () => {
		expect(describe_({ title: null, ratingRapid: null, ratingBlitz: null, games: 0, lastTournament: null })).toBe(
			'ELO FIDE: 2650 estándar. 85 torneos.'
		)
		expect(describe_({ ratingStd: null, ratingRapid: null, ratingBlitz: null, tournaments: 1, games: 1 })).toBe(
			'GM. 1 torneo y 1 partida. Último torneo: Open Inventado de Bilbao 2026.'
		)
	})

	it('fuera de la lista FIDE, sin «ELO FIDE»', () => {
		const text = describe_({ inFideList: false, title: null, ratingStd: 2105, ratingRapid: null, ratingBlitz: null })
		expect(text).toBe('ELO 2105. 85 torneos y 12.345 partidas. Último torneo: Open Inventado de Bilbao 2026.')
		expect(text).not.toContain('FIDE')
	})

	it('un posible menor y una ficha vacía, la de siempre', () => {
		expect(describe_({ minor: true })).toBe(generic)
		expect(describe_({ tournaments: 0, games: 0, lastTournament: null })).toBe(generic)
	})

	it('con nombres larguísimos, 160 como mucho, recortando el torneo y sin punto tras «…»', () => {
		const text = describe_({ lastTournament: LONG })
		expect(chars(text)).toBeLessThanOrEqual(DESCRIPTION_MAX)
		expect(text).toMatch(/^GM · ELO FIDE: .* Último torneo: Torneo Internacional .*[^.]…$/)
		expect(chars(describe_({ minor: true, name: LONG }))).toBeLessThanOrEqual(DESCRIPTION_MAX)
	})
})

describe('lastStartedTournament', () => {
	const t = (tournamentName: string, startDate: string | null, endDate: string | null = startDate) => ({
		tournamentName,
		startDate,
		endDate
	})

	it('el primero que ya ha empezado: no uno por empezar', () => {
		const today = '2026-11-22'
		const list = [t('Próximo', '2026-12-01'), t('En curso', '2026-11-20'), t('Viejo', '2025-05-01')]
		expect(lastStartedTournament(list, today)).toBe('En curso')
		expect(lastStartedTournament([t('Hoy', today)], today)).toBe('Hoy')
		expect(lastStartedTournament([t('Sin inicio', null, '2026-01-10')], today)).toBe('Sin inicio')
		expect(lastStartedTournament([t('Próximo', '2026-12-01'), t('Sin fechas', null)], today)).toBeNull()
	})
})
