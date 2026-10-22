// Repertorio de un jugador: en una posición, qué jugadas se han hecho en sus
// partidas, con cuántas partidas, qué resultado (para él) y cuándo fue la
// última vez.
//
// Las partidas llegan con sus primeras jugadas en UCI (games.opening_moves) y
// se repiten aquí con chessops. Se compara por posición y no por orden de
// jugadas, para que las transposiciones (1.d4 Nf6 2.c4 e6 y 1.c4 e6 2.d4 Nf6)
// caigan en el mismo sitio.
import { Chess, equalsIgnoreMoves, normalizeMove, type Position } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { makeSan } from 'chessops/san'
import { parseUci } from 'chessops/util'
import { outcomeFor } from '../format'
import { lookupOpening, positionKey, type Opening } from './eco'
import { OPENING_MOVES_PLIES } from './pgn'
import { standardUci } from './uci'

export type Color = 'white' | 'black'

/** Jugada de la secuencia que llega en la URL. */
export interface LineMove {
	/** UCI estándar (el enroque como e1g1). */
	uci: string
	san: string
	/** Media jugada (1 = primera de las blancas). */
	ply: number
}

export interface Line {
	moves: LineMove[]
	/** Posición tras la última jugada. */
	position: Chess
	fen: string
	/** Apertura con nombre más profunda de la secuencia. */
	opening?: Opening
}

/**
 * Lee la secuencia de la URL: jugadas UCI separadas por espacios, como en
 * opening_moves ("e2e4 c7c5 g1f3", que en la URL va como e2e4+c7c5+g1f3);
 * también se aceptan comas, como en las URLs de lichess. Se queda con la
 * parte legal y, como mucho, con OPENING_MOVES_PLIES jugadas: más allá no hay
 * datos.
 */
export function parseLine(param: string | null | undefined): Line {
	const position = Chess.default()
	const moves: LineMove[] = []
	let opening: Opening | undefined
	for (const token of (param ?? '').trim().split(/[\s,]+/)) {
		if (moves.length >= OPENING_MOVES_PLIES) break
		const parsed = parseUci(token)
		if (!parsed) break
		const move = normalizeMove(position, parsed)
		if (!position.isLegal(move)) break
		const uci = standardUci(position, move)
		const san = makeSan(position, move)
		position.play(move)
		moves.push({ uci, san, ply: moves.length + 1 })
		opening = lookupOpening(position) ?? opening
	}
	return { moves, position, fen: makeFen(position.toSetup()), opening }
}

/** Partida del jugador tal como sale de la consulta del repertorio. */
export interface RepertoireGame {
	id: number
	date: string | null
	result: string
	/** games.opening_moves: UCI separado por espacios. */
	openingMoves: string
}

/** Recuento de partidas; ganadas, tablas y perdidas desde el punto de vista del jugador. */
export interface Stats {
	/** Incluye las que no han terminado ('*'), que no suman resultado. */
	games: number
	wins: number
	draws: number
	losses: number
	/** Fecha más reciente (YYYY-MM-DD). */
	lastDate: string | null
}

export interface MoveStats extends Stats {
	uci: string
	san: string
}

/** Partida que pasa por la posición. */
export interface PositionGame {
	id: number
	date: string | null
	/** Media jugada en la que llega a la posición: el visor la abre con #j{ply}. */
	ply: number
}

export interface Exploration {
	/** Todas las partidas que pasan por la posición. */
	total: Stats
	/** Jugadas desde la posición, de la más jugada a la menos. */
	moves: MoveStats[]
	/** Partidas que terminan en la posición (antes del límite de jugadas guardadas). */
	ended: Stats | null
	/** Las partidas de `total`, de la más reciente a la más antigua. */
	games: PositionGame[]
}

export const emptyStats = (): Stats => ({ games: 0, wins: 0, draws: 0, losses: 0, lastDate: null })

/** Suma una partida del jugador (que lleva `color`) a la estadística. */
export function addGame(stats: Stats, game: Pick<RepertoireGame, 'result' | 'date'>, color: Color): void {
	stats.games++
	const outcome = outcomeFor(game.result, color)
	if (outcome === 'win') stats.wins++
	else if (outcome === 'draw') stats.draws++
	else if (outcome === 'loss') stats.losses++
	if (game.date && (!stats.lastDate || game.date > stats.lastDate)) stats.lastDate = game.date
}

/** Puntuación del jugador de 0 a 1 sobre las partidas terminadas; null si no hay ninguna. */
export function score(stats: Pick<Stats, 'wins' | 'draws' | 'losses'>): number | null {
	const decided = stats.wins + stats.draws + stats.losses
	return decided ? (stats.wins + stats.draws / 2) / decided : null
}

/**
 * Media jugada en la que la partida pasa por primera vez por `target`, o null.
 * Las capturas sólo quitan piezas (la promoción cambia una por otra): cuando
 * quedan menos piezas que en la posición buscada, ya no se puede llegar a ella
 * y se deja de repetir la partida.
 */
function findPosition(moves: string[], target: Position, pieces: number): number | null {
	const pos = Chess.default()
	for (let ply = 0; ; ply++) {
		if (pos.board.occupied.size() < pieces) return null
		if (equalsIgnoreMoves(pos, target)) return ply
		const parsed = ply < moves.length ? parseUci(moves[ply]) : undefined
		if (!parsed) return null
		// Las jugadas vienen de la ingesta, que ya comprobó que eran legales.
		pos.play(normalizeMove(pos, parsed))
	}
}

/** Jugadas y partidas del jugador (que lleva `color`) en la posición `target`. */
export function explore(games: RepertoireGame[], target: Position, color: Color): Exploration {
	const pieces = target.board.occupied.size()
	const total = emptyStats()
	const byMove = new Map<string, Stats>()
	let ended: Stats | null = null
	const reached: PositionGame[] = []

	for (const game of games) {
		const moves = game.openingMoves.split(' ')
		const ply = findPosition(moves, target, pieces)
		if (ply === null) continue
		addGame(total, game, color)
		reached.push({ id: game.id, date: game.date, ply })
		const next = moves[ply]
		if (next) {
			let stats = byMove.get(next)
			if (!stats) byMove.set(next, (stats = emptyStats()))
			addGame(stats, game, color)
		} else if (moves.length < OPENING_MOVES_PLIES) {
			// La línea es más corta que el límite: la partida acaba aquí.
			addGame((ended ??= emptyStats()), game, color)
		}
	}

	const moves = [...byMove].map(([uci, stats]): MoveStats => {
		const move = normalizeMove(target, parseUci(uci)!)
		return { uci, san: makeSan(target, move), ...stats }
	})
	moves.sort(
		(a, b) => b.games - a.games || (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || a.san.localeCompare(b.san)
	)
	reached.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id - a.id)

	return { total, moves, ended, games: reached }
}

export interface PositionNode {
	/** Partidas que pasan por la posición. */
	stats: Stats
	/** Jugadas desde la posición (UCI): sus partidas y la clave de la posición a la que llevan. */
	moves: Map<string, { stats: Stats; child: string }>
}

/**
 * Todas las posiciones de las primeras `maxPly` medias jugadas, en una sola
 * pasada por las partidas (explore las repite para cada posición que se
 * consulta). Como en explore, una partida cuenta una vez en cada posición: la
 * primera vez que pasa por ella.
 */
export function indexPositions(games: RepertoireGame[], color: Color, maxPly = 24): Map<string, PositionNode> {
	const index = new Map<string, PositionNode>()
	for (const game of games) {
		const moves = game.openingMoves.split(' ')
		const limit = Math.min(maxPly, moves.length)
		const pos = Chess.default()
		const seen = new Set<string>()
		let key = positionKey(pos)
		for (let ply = 0; ; ply++) {
			const firstVisit = !seen.has(key)
			seen.add(key)
			let node = index.get(key)
			if (!node) index.set(key, (node = { stats: emptyStats(), moves: new Map() }))
			if (firstVisit) addGame(node.stats, game, color)
			const parsed = ply < limit ? parseUci(moves[ply]) : undefined
			if (!parsed) break
			pos.play(normalizeMove(pos, parsed))
			const child = positionKey(pos)
			if (firstVisit) {
				let edge = node.moves.get(moves[ply])
				if (!edge) node.moves.set(moves[ply], (edge = { stats: emptyStats(), child }))
				addGame(edge.stats, game, color)
			}
			key = child
		}
	}
	return index
}
