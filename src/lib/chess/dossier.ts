// Dossier para preparar una partida contra un jugador: sus líneas principales
// con un color, qué ha cambiado en su repertorio y cómo rinde según el ELO de
// sus rivales. Sale de las mismas partidas que lee el repertorio.
import { Chess, normalizeMove } from 'chessops/chess'
import { parseUci } from 'chessops/util'
import { addYears } from '../dates'
import { positionKey } from './eco'
import { addGame, emptyStats, type Color, type PositionNode, type Stats } from './repertoire'

/** Lo que el dossier necesita de cada partida (lo da getPlayerGames). */
export interface DossierGame {
	date: string | null
	result: string
	opening: string | null
	ownElo: number | null
	opponentElo: number | null
}

export interface MainLine {
	/** Jugadas en UCI desde la posición inicial. */
	moves: string[]
	/** Partidas que llegan a la posición final, por este orden de jugadas o por otro. */
	stats: Stats
}

export interface MainLineOptions {
	max: number
	/** Partidas mínimas de una jugada para seguirla. */
	minGames: number
	/** Parte mínima de las partidas de la posición que debe llevarse la jugada. */
	minShare: number
	maxPly: number
}

// Pensado para jugadores de club, con decenas de partidas por color y no
// cientos: con dos partidas una jugada ya es una costumbre.
const MAIN_LINES: MainLineOptions = { max: 6, minGames: 2, minShare: 0.2, maxPly: 16 }

/**
 * Líneas principales del índice de posiciones (indexPositions): desde la
 * posición inicial se siguen las jugadas que cumplen los mínimos, y una línea
 * acaba donde ninguna los cumple. Se ordenan por partidas y, a igualdad, por la
 * más reciente.
 */
export function mainLines(index: Map<string, PositionNode>): MainLine[] {
	const { max, minGames, minShare, maxPly } = MAIN_LINES
	const rootKey = positionKey(Chess.default())
	const root = index.get(rootKey)
	if (!root) return []
	const lines: MainLine[] = []
	// Posiciones en las que ya acaba una línea. A una misma se llega a veces por
	// dos órdenes de jugadas (1.d4 Nf6 2.c4 e6 y 1.c4 e6 2.d4 Nf6), y serían dos
	// líneas con las mismas partidas. Se queda la primera: las jugadas se
	// recorren de más a menos partidas, así que es el orden más repetido.
	const ends = new Set<string>()

	// `path` evita los ciclos por repetición (1.Nf3 Nf6 2.Ng1 Ng8 vuelve al principio).
	const walk = (key: string, node: PositionNode, moves: string[], path: Set<string>) => {
		const next =
			moves.length < maxPly
				? [...node.moves]
						.filter(
							([, edge]) =>
								edge.stats.games >= minGames && edge.stats.games >= minShare * node.stats.games && !path.has(edge.child)
						)
						.sort(([, a], [, b]) => b.stats.games - a.stats.games)
				: []
		if (next.length === 0) {
			if (moves.length > 0 && !ends.has(key)) {
				ends.add(key)
				lines.push({ moves, stats: node.stats })
			}
			return
		}
		for (const [uci, edge] of next) {
			const child = index.get(edge.child)
			if (child) walk(edge.child, child, [...moves, uci], new Set(path).add(edge.child))
		}
	}
	walk(rootKey, root, [], new Set([rootKey]))

	return lines
		.sort((a, b) => b.stats.games - a.stats.games || (b.stats.lastDate ?? '').localeCompare(a.stats.lastDate ?? ''))
		.slice(0, max)
}

/** "Sicilian Defense: Najdorf Variation, English Attack" → "Sicilian Defense". */
export function openingFamily(name: string): string {
	return name.split(':')[0].trim()
}

export interface OpeningShift {
	family: string
	/** Partidas en el último año y en los dos anteriores. */
	recent: number
	before: number
}

export interface RecentChanges {
	/** Primer día del último año. */
	since: string
	recentGames: number
	beforeGames: number
	/** Aperturas que juega en el último año y no jugó en los dos anteriores. */
	adopted: OpeningShift[]
	/** Aperturas habituales en los dos años anteriores que ha dejado de jugar. */
	dropped: OpeningShift[]
}

/** Partidas mínimas en cada periodo para comparar. */
const MIN_PERIOD_GAMES = 5

/**
 * Qué ha cambiado en su repertorio: aperturas (por familia) del último año
 * frente a los dos anteriores. null si alguno de los dos periodos tiene muy
 * pocas partidas para decir nada.
 */
export function recentChanges(games: DossierGame[], today: string): RecentChanges | null {
	const since = addYears(today, -1)
	const beforeSince = addYears(today, -3)
	const families = new Map<string, OpeningShift>()
	let recentGames = 0
	let beforeGames = 0
	for (const game of games) {
		if (!game.date || game.date < beforeSince || !game.opening) continue
		const recent = game.date >= since
		if (recent) recentGames++
		else beforeGames++
		const family = openingFamily(game.opening)
		const shift = families.get(family) ?? { family, recent: 0, before: 0 }
		if (recent) shift.recent++
		else shift.before++
		families.set(family, shift)
	}
	if (recentGames < MIN_PERIOD_GAMES || beforeGames < MIN_PERIOD_GAMES) return null

	const shifts = [...families.values()]
	return {
		since,
		recentGames,
		beforeGames,
		adopted: shifts.filter((s) => s.recent >= 2 && s.before === 0).sort((a, b) => b.recent - a.recent),
		dropped: shifts
			.filter((s) => s.recent === 0 && s.before >= 3 && s.before >= 0.1 * beforeGames)
			.sort((a, b) => b.before - a.before)
	}
}

export type EloGap = 'stronger' | 'similar' | 'weaker' | 'unknown'

/** Puntos de diferencia a partir de los que un rival cuenta como más fuerte o más débil. */
export const ELO_GAP = 100

export function resultsByEloGap(games: DossierGame[], color: Color): Record<EloGap, Stats> {
	const groups: Record<EloGap, Stats> = {
		stronger: emptyStats(),
		similar: emptyStats(),
		weaker: emptyStats(),
		unknown: emptyStats()
	}
	for (const game of games) {
		const gap =
			game.ownElo === null || game.opponentElo === null ? null : game.opponentElo - game.ownElo
		const group: EloGap = gap === null ? 'unknown' : gap > ELO_GAP ? 'stronger' : gap < -ELO_GAP ? 'weaker' : 'similar'
		addGame(groups[group], game, color)
	}
	return groups
}

/** Jugada desde una posición, con sus partidas. */
export interface MoveCount {
	uci: string
	stats: Stats
}

/**
 * Dónde se separa una línea principal del rival de tu experiencia:
 * - known: has llegado al final de la línea;
 * - you-deviate: en una posición en la que te toca a ti sueles jugar otra cosa;
 * - new-for-you: en una posición en la que le toca a él juega algo que nunca te han jugado.
 */
export type CrossKind = 'known' | 'you-deviate' | 'new-for-you'

export interface CrossPoint {
	kind: CrossKind
	/** Jugadas de la línea hasta la posición en la que pasa (UCI). */
	moves: string[]
	/** Tus partidas en esa posición. */
	yours: Stats
	/** Su jugada en la línea desde esa posición (null en known). */
	lineMove: string | null
	/** you-deviate: tus jugadas allí, de la más jugada a la menos (como mucho 3). */
	yourMoves: MoveCount[]
	/** you-deviate: sus partidas tras tu jugada más habitual (null si nunca se la han jugado) y sus respuestas. */
	rivalAfter: { stats: Stats; replies: MoveCount[] } | null
}

const byGames = (node: PositionNode, limit = 3): MoveCount[] =>
	[...node.moves]
		.map(([uci, edge]) => ({ uci, stats: edge.stats }))
		.sort((a, b) => b.stats.games - a.stats.games || (b.stats.lastDate ?? '').localeCompare(a.stats.lastDate ?? ''))
		.slice(0, limit)

/**
 * Cruza una línea principal del rival (que lleva `rivalColor`) con tus
 * partidas con el otro color: recorre la línea mientras tú la conoces y se
 * para en el primer punto en el que no. null si no tienes partidas con ese color.
 */
export function crossReference(
	line: MainLine,
	yourIndex: Map<string, PositionNode>,
	rivalIndex: Map<string, PositionNode>,
	rivalColor: Color
): CrossPoint | null {
	const pos = Chess.default()
	for (let i = 0; ; i++) {
		const node = yourIndex.get(positionKey(pos))
		// Cada paso exige que tu índice tenga la jugada: sólo puede faltar la raíz.
		if (!node) return null
		const moves = line.moves.slice(0, i)
		const lineMove = line.moves[i]
		if (lineMove === undefined) {
			return { kind: 'known', moves, yours: node.stats, lineMove: null, yourMoves: [], rivalAfter: null }
		}
		if (pos.turn !== rivalColor) {
			const yourMoves = byGames(node)
			if (yourMoves[0]?.uci !== lineMove) {
				const after = yourMoves[0] ? rivalIndex.get(node.moves.get(yourMoves[0].uci)!.child) : undefined
				return {
					kind: 'you-deviate',
					moves,
					yours: node.stats,
					lineMove,
					yourMoves,
					rivalAfter: after ? { stats: after.stats, replies: byGames(after) } : null
				}
			}
		} else if (!node.moves.has(lineMove)) {
			return { kind: 'new-for-you', moves, yours: node.stats, lineMove, yourMoves: [], rivalAfter: null }
		}
		pos.play(normalizeMove(pos, parseUci(lineMove)!))
	}
}
