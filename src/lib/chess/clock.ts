// El reloj en las partidas de un jugador: si suele apurarse de tiempo, cuándo
// y cómo le va entonces. Lee games.clocks, los segundos que le quedan a quien
// mueve tras cada media jugada ('-' sin lectura); de ahí se toma la mitad de
// un color.
import { addGame, emptyStats, type Color, type Stats } from './repertoire'
import { TIME_CLASSES, type TimeClass } from './timecontrol'

/**
 * Por debajo de esta fracción de su tiempo inicial, un jugador va apurado:
 * 4½ minutos en un 90+30. Medido en 2.500 partidas a estándar de las fuentes,
 * baja de ahí el 31 % de los jugadores; del 10 %, el 41 % (y el 59 % en las
 * partidas largas), demasiado común para distinguir a nadie.
 */
export const TROUBLE_SHARE = 0.05
/** Lecturas mínimas de un color para fiarse del reloj de una partida. */
export const MIN_READINGS = 10
/** Jugada tras la que se mira cuánto tiempo le queda: lo que gasta en la apertura. */
export const OPENING_MOVE = 15
/** Partidas con reloj mínimas para resumir algo. */
export const MIN_CLOCK_GAMES = 5

export interface ClockReading {
	/** Número de jugada (1, 2, 3…). */
	move: number
	/** Segundos que le quedan tras ella. */
	seconds: number
}

/** Lecturas del reloj de un color, en orden. */
export function sideReadings(clocks: string, color: Color): ClockReading[] {
	const values = clocks.split(' ')
	const readings: ClockReading[] = []
	for (let ply = color === 'white' ? 0 : 1; ply < values.length; ply += 2) {
		const seconds = Number(values[ply])
		if (values[ply] !== '-' && Number.isFinite(seconds)) readings.push({ move: Math.floor(ply / 2) + 1, seconds })
	}
	return readings
}

export interface GameClock {
	/** Tiempo de partida: la mayor de sus tres primeras lecturas (ya con el incremento). */
	initial: number
	/** Primera jugada con menos de TROUBLE_SHARE de su tiempo inicial; null si nunca bajó. */
	troubleMove: number | null
	/** Fracción de su tiempo que le queda tras la jugada OPENING_MOVE; null si no llegó o falta la lectura. */
	afterOpening: number | null
}

/**
 * El reloj de un color en una partida, o null si tiene pocas lecturas. Un
 * reloj DGT da a veces una lectura suelta absurda (un 0:00:00 al ponerlo en
 * marcha, un salto): el tiempo de partida es la mayor de las tres primeras, y
 * el apuro tiene que seguir en la lectura siguiente para contar.
 */
export function gameClock(clocks: string, color: Color): GameClock | null {
	const readings = sideReadings(clocks, color)
	if (readings.length < MIN_READINGS) return null
	const initial = Math.max(...readings.slice(0, 3).map((r) => r.seconds))
	if (initial <= 0) return null
	const limit = initial * TROUBLE_SHARE
	const trouble = readings.findIndex((r, i) => r.seconds < limit && (readings[i + 1]?.seconds ?? Infinity) < limit)
	const opening = readings.find((r) => r.move === OPENING_MOVE)
	return {
		initial,
		troubleMove: trouble === -1 ? null : readings[trouble].move,
		afterOpening: opening ? Math.min(opening.seconds / initial, 1) : null
	}
}

export interface ClockSummary {
	/** Partidas con reloj fiable de su color. */
	games: number
	/** Mediana del tiempo de partida, en segundos; null sin partidas. */
	initial: number | null
	/** En cuántas bajó de TROUBLE_SHARE de su tiempo. */
	trouble: number
	/** Jugada mediana en la que empezó el apuro; null si no hubo. */
	troubleMove: number | null
	/** Cuándo empezó: antes de la jugada 30, de la 30 a la 40 y después. */
	phases: { early: number; middle: number; late: number }
	/** Sus resultados con apuro y sin él. */
	withTrouble: Stats
	withoutTrouble: Stats
	/** Mediana de la fracción de tiempo que le queda tras la jugada OPENING_MOVE. */
	afterOpening: number | null
}

/**
 * Partidas con reloj fiable de cada ritmo, de más a menos (a igualdad, en el
 * orden de TIME_CLASSES). Apurarse no significa lo mismo a estándar que a
 * blitz, donde bajar del 10 % es lo normal: el resumen no mezcla ritmos.
 */
export function clockTimeClasses(
	games: { clocks: string | null; timeClass: TimeClass | null }[],
	color: Color
): { timeClass: TimeClass; games: number }[] {
	const counts = new Map<TimeClass, number>()
	for (const game of games) {
		if (game.timeClass && game.clocks && gameClock(game.clocks, color)) {
			counts.set(game.timeClass, (counts.get(game.timeClass) ?? 0) + 1)
		}
	}
	return TIME_CLASSES.filter((t) => counts.has(t))
		.map((t) => ({ timeClass: t, games: counts.get(t)! }))
		.sort((a, b) => b.games - a.games)
}

function median(values: number[]): number | null {
	if (values.length === 0) return null
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Resume el reloj de un jugador que lleva `color` en sus partidas. */
export function clockSummary(
	games: { clocks: string | null; result: string; date: string | null }[],
	color: Color
): ClockSummary {
	const summary: ClockSummary = {
		games: 0,
		initial: null,
		trouble: 0,
		troubleMove: null,
		phases: { early: 0, middle: 0, late: 0 },
		withTrouble: emptyStats(),
		withoutTrouble: emptyStats(),
		afterOpening: null
	}
	const troubleMoves: number[] = []
	const afterOpening: number[] = []
	const initials: number[] = []
	for (const game of games) {
		const clock = game.clocks ? gameClock(game.clocks, color) : null
		if (!clock) continue
		summary.games++
		initials.push(clock.initial)
		if (clock.afterOpening !== null) afterOpening.push(clock.afterOpening)
		if (clock.troubleMove === null) {
			addGame(summary.withoutTrouble, game, color)
			continue
		}
		summary.trouble++
		troubleMoves.push(clock.troubleMove)
		addGame(summary.withTrouble, game, color)
		if (clock.troubleMove < 30) summary.phases.early++
		else if (clock.troubleMove <= 40) summary.phases.middle++
		else summary.phases.late++
	}
	const move = median(troubleMoves)
	summary.troubleMove = move === null ? null : Math.round(move)
	summary.afterOpening = median(afterOpening)
	summary.initial = median(initials)
	return summary
}
