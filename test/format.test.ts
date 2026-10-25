import { describe, expect, it } from 'vitest'
import {
	displayName,
	formatCount,
	formatGames,
	formatLine,
	formatMonth,
	formatMove,
	formatRange,
	formatResults,
	homonymYear,
	withoutHomonymYear
} from '../src/lib/format'

// Nombres inventados.
describe('displayName', () => {
	it('el nombre delante de los apellidos', () => {
		expect(displayName('Pruebez Ensayo, Tomas')).toBe('Tomas Pruebez Ensayo')
		expect(displayName('Irreal, Otro')).toBe('Otro Irreal')
		expect(displayName('Inventado')).toBe('Inventado')
		expect(displayName('Ficticio,')).toBe('Ficticio')
	})

	it('el año de los homónimos FIDE, al final y entre paréntesis', () => {
		expect(displayName('Ejemplez Ejemplez, Jose Manuel 1971')).toBe('Jose Manuel Ejemplez Ejemplez (1971)')
		expect(displayName('Supuesto Supuesto, Ruben 1978 I')).toBe('Ruben Supuesto Supuesto (1978 I)')
		expect(displayName('Inventado, 1990')).toBe('Inventado (1990)')
	})

	it('otras cifras no son un año', () => {
		expect(displayName('Ficticio Ejemplez, Jose L. 4')).toBe('Jose L. 4 Ficticio Ejemplez')
	})
})

describe('withoutHomonymYear', () => {
	it('quita el año de los homónimos FIDE, con su letra', () => {
		expect(withoutHomonymYear('Inventado Ficticio, Nombre 2009')).toBe('Inventado Ficticio, Nombre')
		expect(withoutHomonymYear('Supuesto Irreal, Otro 2009 I')).toBe('Supuesto Irreal, Otro')
		expect(withoutHomonymYear('Inventado, 1990')).toBe('Inventado')
	})

	it('homonymYear da ese año, o null', () => {
		expect(homonymYear('Supuesto Irreal, Otro 2009 I')).toBe(2009)
		expect(homonymYear('Inventado, 1990')).toBe(1990)
		expect(homonymYear('Pruebez Ensayo, Tomas')).toBeNull()
		expect(homonymYear('Ficticio Ejemplez, Jose L. 4')).toBeNull()
		expect(homonymYear('Inventado')).toBeNull()
	})

	it('deja los demás nombres como están', () => {
		expect(withoutHomonymYear('Pruebez Ensayo, Tomas')).toBe('Pruebez Ensayo, Tomas')
		expect(withoutHomonymYear('Ficticio Ejemplez, Jose L. 4')).toBe('Ficticio Ejemplez, Jose L. 4')
		expect(withoutHomonymYear('Inventado')).toBe('Inventado')
	})
})

describe('formatCount', () => {
	it('singular sólo con 1', () => {
		expect(formatCount(1, 'jugador', 'jugadores')).toBe('1 jugador')
		expect(formatCount(0, 'jugador', 'jugadores')).toBe('0 jugadores')
		expect(formatCount(2, 'jugador', 'jugadores')).toBe('2 jugadores')
	})

	it('agrupa los miles como en es-ES', () => {
		expect(formatCount(12345, 'torneo', 'torneos')).toBe('12.345 torneos')
	})
})

describe('formatGames', () => {
	it('partida o partidas', () => {
		expect(formatGames(1)).toBe('1 partida')
		expect(formatGames(0)).toBe('0 partidas')
		expect(formatGames(12345)).toBe('12.345 partidas')
	})
})

describe('formatResults', () => {
	it('ganadas y perdidas en singular o plural; tablas, siempre en plural', () => {
		expect(formatResults({ wins: 5, draws: 3, losses: 1 })).toBe('5 ganadas, 3 tablas, 1 perdida')
		expect(formatResults({ wins: 1, draws: 1, losses: 0 })).toBe('1 ganada, 1 tablas, 0 perdidas')
		expect(formatResults({ wins: 12345, draws: 0, losses: 2 })).toBe('12.345 ganadas, 0 tablas, 2 perdidas')
	})
})

describe('formatMove', () => {
	it('punto tras el número con las blancas y puntos suspensivos con las negras', () => {
		expect(formatMove(1, 'e4')).toBe('1.e4')
		expect(formatMove(2, 'c5')).toBe('1…c5')
		expect(formatMove(45, 'Nxe5')).toBe('23.Nxe5')
		expect(formatMove(46, 'exf1=Q+')).toBe('23…exf1=Q+')
	})
})

describe('formatLine', () => {
	it('numera las jugadas de las blancas', () => {
		expect(
			formatLine([
				{ ply: 1, san: 'e4' },
				{ ply: 2, san: 'c5' },
				{ ply: 3, san: 'Nf3' }
			])
		).toBe('1.e4 c5 2.Nf3')
	})

	it('si empieza en una de las negras, también la numera', () => {
		expect(
			formatLine([
				{ ply: 68, san: 'Qxc3' },
				{ ply: 69, san: 'Qa4' },
				{ ply: 70, san: 'd4' }
			])
		).toBe('34…Qxc3 35.Qa4 d4')
	})

	it('sin jugadas, vacía', () => {
		expect(formatLine([])).toBe('')
	})
})

describe('formatMonth', () => {
	it('mes y año de una fecha ISO', () => {
		expect(formatMonth('2026-10-17T10:00:00.000Z')).toBe('octubre de 2026')
	})
})

describe('formatRange', () => {
	it('no repite el mes ni el año que comparten', () => {
		expect(formatRange('2026-09-16', '2026-09-27')).toBe('16–27 sept 2026')
		expect(formatRange('2026-08-29', '2026-09-04')).toBe('29 ago – 4 sept 2026')
		expect(formatRange('2025-12-28', '2026-01-03')).toBe('28 dic 2025 – 3 ene 2026')
	})

	it('un solo día, o sólo una de las dos fechas', () => {
		expect(formatRange('2026-10-18', '2026-10-18')).toBe('18 oct 2026')
		expect(formatRange('2026-10-18', null)).toBe('18 oct 2026')
		expect(formatRange(null, '2026-10-18')).toBe('18 oct 2026')
		expect(formatRange(null, null)).toBe('—')
	})

	it('si el fin va antes que el inicio, las dos enteras', () => {
		expect(formatRange('2026-10-18', '2026-10-01')).toBe('18 oct 2026 – 1 oct 2026')
	})
})
