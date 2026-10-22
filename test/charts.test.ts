import { describe, expect, it } from 'vitest'
import { areaPath, linearScale, linePath, minorLabels, niceTicks } from '../src/lib/charts'
import { annotatedScore } from '../src/lib/chess/uci'

describe('gráficos', () => {
	it('escala linealmente, también al revés', () => {
		const y = linearScale(-1, 1, 100, 0)
		expect([y(-1), y(0), y(1)]).toEqual([100, 50, 0])
	})

	it('corta la línea en los huecos', () => {
		expect(linePath([{ x: 0, y: 1 }, { x: 1, y: 2 }, null, { x: 3, y: 4.256 }])).toBe('M0 1L1 2M3 4.26')
	})

	it('cierra el área contra la base', () => {
		expect(areaPath([{ x: 0.5, y: 40 }, { x: 1.5, y: 60 }], 100)).toBe('M0.5 100L0.5 40L1.5 60L1.5 100Z')
		expect(areaPath([], 100)).toBe('')
	})

	it('elige marcas redondas', () => {
		expect(niceTicks(1487, 1554)).toEqual([1500, 1520, 1540])
		expect(niceTicks(1800, 2400)).toEqual([1800, 2000, 2200, 2400])
		expect(niceTicks(1500, 1500)).toEqual([1500])
	})

	it('marca como menores las etiquetas que sobran', () => {
		// Con 6 o menos, ninguna; con 12 años, uno de cada dos; con 13, uno de cada tres.
		expect(minorLabels(6, 6)).toEqual([false, false, false, false, false, false])
		expect(minorLabels(12, 6).filter((minor) => !minor)).toHaveLength(6)
		expect(minorLabels(12, 6).slice(0, 3)).toEqual([false, true, false])
		expect(minorLabels(13, 6).filter((minor) => !minor)).toHaveLength(5)
		expect(minorLabels(0, 6)).toEqual([])
	})
})

describe('annotatedScore', () => {
	it('pasa %eval a puntuación', () => {
		expect(annotatedScore({ cp: 35 })).toEqual({ cp: 35 })
		expect(annotatedScore({ mate: -3 })).toEqual({ mate: -3 })
	})
})
