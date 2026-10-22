import { describe, expect, it } from 'vitest'
import {
	classifyMinutes,
	parseTimeControlTag,
	parseTimeControlText,
	timeClassOf
} from '../../src/lib/chess/timecontrol'

describe('classifyMinutes', () => {
	it('aplica los límites FIDE: hasta 10 blitz, menos de 60 rápidas', () => {
		expect([5, 10, 10.5, 59, 60, 120].map(classifyMinutes)).toEqual([
			'blitz',
			'blitz',
			'rapid',
			'rapid',
			'standard',
			'standard'
		])
	})
})

describe('parseTimeControlText', () => {
	// Textos reales de info64, con los minutos FIDE (base + incremento en segundos).
	const cases: [string, number | null][] = [
		['90 minutes + 30 seconds per move', 120],
		['10 minutos + 3 segundos por movimiento', 13],
		['7 minuts + 3 segons d\'increment per jugada', 10],
		['Estandar: 60 min. + 30 seg. por jugada', 90],
		['Standard: 90 minutes with 30 second increment from move 1', 120],
		["10'+3''", 13],
		['90´ mas 30´´', 120],
		['90\'+30" para cada movimiento desde el inicio', 120],
		['90+30', 120],
		['30 + 30', 60],
		['Standard 60 + 30 seg/jugada', 90],
		['3 min + 2 sg / mov', 5],
		['45 mn + 5 sg.', 50],
		['50 mintos + 10 segundos por jugada', 60],
		['15 minutes finish', 15],
		['20', 20],
		['90min/40moves+30min/end+30sec per move from 1st', 150],
		['40/90 minutes, 30 minutes to finish + 30 seconds per move', 150],
		["100'/40 + 50'/20 + 15'/rest + 30''/move from 1st", 195],
		['1 hora y 30 minutos', 90],
		['minutos + 3 segundos por movimiento', null],
		['Sin reloj', null]
	]

	it.each(cases)('%s → %s', (text, minutes) => {
		expect(parseTimeControlText(text)).toBe(minutes)
	})
})

describe('parseTimeControlTag', () => {
	it('lee segundos, o minutos si la base es menor de 180', () => {
		expect(parseTimeControlTag('5400+30')).toBe(120)
		expect(parseTimeControlTag('180+2')).toBe(5)
		expect(parseTimeControlTag('30+30')).toBe(60)
		expect(parseTimeControlTag('60+30')).toBe(90)
	})

	it('suma los periodos', () => {
		expect(parseTimeControlTag('40/5400+30:1800+30')).toBe(150)
	})

	it('no entiende lo que no es un ritmo', () => {
		expect([null, '', '-', '?', '*60'].map(parseTimeControlTag)).toEqual([null, null, null, null, null])
	})
})

describe('timeClassOf', () => {
	it('prefiere el texto del torneo y, si no trae cifras, la cabecera del PGN', () => {
		expect(timeClassOf('30 minutes + 30 seconds per move', '600+5')).toBe('standard')
		expect(timeClassOf(null, '600+5')).toBe('rapid')
		expect(timeClassOf('Sin reloj', '180+2')).toBe('blitz')
	})

	it('sin cifras usa las palabras del texto', () => {
		expect(timeClassOf('Rápidas')).toBe('rapid')
		expect(timeClassOf('Torneo relámpago')).toBe('blitz')
		expect(timeClassOf('Clásicas')).toBe('standard')
		expect(timeClassOf('Sin reloj')).toBeNull()
		expect(timeClassOf(null)).toBeNull()
	})
})
