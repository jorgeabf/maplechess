import { describe, expect, it } from 'vitest'
import { clockSummary, clockTimeClasses, gameClock, MIN_READINGS, sideReadings } from '../../src/lib/chess/clock'
import { formatDuration } from '../../src/lib/format'

/**
 * Relojes de una partida a partir de los de cada color, alternando blancas y
 * negras como en games.clocks.
 */
function clocks(white: (number | '-')[], black: (number | '-')[]): string {
	const plies: (number | '-')[] = []
	for (let i = 0; i < Math.max(white.length, black.length); i++) {
		if (i < white.length) plies.push(white[i])
		if (i < black.length) plies.push(black[i])
	}
	return plies.join(' ')
}

/** 90 minutos que bajan de `step` en `step` segundos por jugada. */
const falling = (moves: number, step: number, start = 5400) => Array.from({ length: moves }, (_, i) => start - i * step)
const steady = (moves: number) => Array.from({ length: moves }, () => 5400)

describe('sideReadings', () => {
	it('separa las lecturas de cada color con su número de jugada y salta las que faltan', () => {
		const text = clocks([5400, '-', 5300], [5390, 5380])
		expect(sideReadings(text, 'white')).toEqual([
			{ move: 1, seconds: 5400 },
			{ move: 3, seconds: 5300 }
		])
		expect(sideReadings(text, 'black')).toEqual([
			{ move: 1, seconds: 5390 },
			{ move: 2, seconds: 5380 }
		])
	})
})

describe('gameClock', () => {
	it('encuentra la jugada en la que baja del 5 % de su tiempo', () => {
		// 5400 − 150 × (n − 1) < 270 a partir de la jugada 36.
		const clock = gameClock(clocks(falling(40, 150), steady(40)), 'white')
		expect(clock).toMatchObject({ initial: 5400, troubleMove: 36 })
		expect(gameClock(clocks(falling(40, 150), steady(40)), 'black')).toMatchObject({ troubleMove: null })
	})

	it('no cuenta una lectura suelta absurda ni un 0 al poner el reloj en marcha', () => {
		const white = steady(30)
		white[0] = 0
		white[20] = 3
		expect(gameClock(clocks(white, steady(30)), 'white')).toMatchObject({ initial: 5400, troubleMove: null })
	})

	it('mide cuánto le queda tras la jugada 15', () => {
		expect(gameClock(clocks(falling(30, 100), steady(30)), 'white')?.afterOpening).toBeCloseTo(4000 / 5400)
		// Con incremento puede tener más que al empezar: como mucho, todo.
		expect(gameClock(clocks(falling(30, -10), steady(30)), 'white')?.afterOpening).toBe(1)
		expect(gameClock(clocks(steady(12), steady(12)), 'white')?.afterOpening).toBeNull()
	})

	it(`con menos de ${MIN_READINGS} lecturas no se fía`, () => {
		expect(gameClock(clocks(steady(MIN_READINGS - 1), steady(MIN_READINGS - 1)), 'white')).toBeNull()
	})
})

describe('clockSummary', () => {
	const game = (white: number[], result: string) => ({ clocks: clocks(white, steady(white.length)), result, date: null })

	it('cuenta los apuros, cuándo empiezan y cómo le va con y sin ellos', () => {
		const summary = clockSummary(
			[
				game(falling(40, 150), '0-1'), // apuro en la 36
				game(falling(40, 200), '1/2-1/2'), // en la 27
				game(falling(50, 120), '1-0'), // en la 44
				game(steady(40), '1-0'),
				game(steady(40), '1-0'),
				{ clocks: null, result: '1-0', date: null }
			],
			'white'
		)
		expect(summary).toMatchObject({
			games: 5,
			initial: 5400,
			trouble: 3,
			troubleMove: 36,
			phases: { early: 1, middle: 1, late: 1 },
			withTrouble: { games: 3, wins: 1, draws: 1, losses: 1 },
			withoutTrouble: { games: 2, wins: 2, draws: 0, losses: 0 }
		})
	})

	it('sin partidas con reloj no hay nada que resumir', () => {
		expect(clockSummary([{ clocks: null, result: '1-0', date: null }], 'white')).toMatchObject({
			games: 0,
			troubleMove: null,
			afterOpening: null
		})
	})
})

describe('clockTimeClasses', () => {
	it('cuenta las partidas con reloj de cada ritmo, de más a menos', () => {
		const withClock = clocks(steady(20), steady(20))
		const games = [
			{ clocks: withClock, timeClass: 'blitz' as const },
			{ clocks: withClock, timeClass: 'standard' as const },
			{ clocks: withClock, timeClass: 'blitz' as const },
			{ clocks: null, timeClass: 'standard' as const },
			{ clocks: withClock, timeClass: null }
		]
		expect(clockTimeClasses(games, 'white')).toEqual([
			{ timeClass: 'blitz', games: 2 },
			{ timeClass: 'standard', games: 1 }
		])
	})
})

describe('formatDuration', () => {
	it('da minutos y segundos y, desde 10 minutos, minutos enteros', () => {
		expect(formatDuration(270)).toBe('4 min 30 s')
		expect(formatDuration(45)).toBe('45 s')
		expect(formatDuration(120)).toBe('2 min')
		expect(formatDuration(2970)).toBe('50 min')
	})
})
