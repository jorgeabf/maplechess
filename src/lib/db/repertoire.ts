// Partidas de un jugador con un color: las leen el repertorio y el dossier.
import type { Color, RepertoireGame } from '../chess/repertoire'
import type { TimeClass } from '../chess/timecontrol'

export interface PlayerGame {
	id: number
	date: string | null
	result: string
	/** null si no tiene jugadas o empieza desde un FEN: no entra en el repertorio. */
	openingMoves: string | null
	opening: string | null
	timeClass: TimeClass | null
	/** ELO del jugador y del rival en esa partida. */
	ownElo: number | null
	opponentElo: number | null
	/** Relojes (games.clocks); sólo si se piden, si no null. */
	clocks: string | null
}

export interface PlayerGamesFilter {
	/** Desde esta fecha (YYYY-MM-DD). */
	from?: string | null
	timeClass?: TimeClass | null
	/** ELO del rival en la partida. */
	minOpponentElo?: number | null
	maxOpponentElo?: number | null
}

/**
 * Partidas del jugador con un color. D1 factura una fila por partida, las
 * entradas recorridas de games_white o games_black; los filtros y las
 * columnas de la tabla no añaden coste, y el PGN no se toca. Los relojes sólo
 * los usa el dossier: con `clocks` se leen, y si no, no se transfieren.
 */
export async function getPlayerGames(
	db: D1Database,
	fideId: number,
	color: Color,
	f: PlayerGamesFilter = {},
	{ clocks = false }: { clocks?: boolean } = {}
): Promise<PlayerGame[]> {
	const [own, opponent] = color === 'white' ? ['white', 'black'] : ['black', 'white']
	const where = [`${own}_fide_id = ?1`]
	const params: unknown[] = [fideId]
	const p = (value: unknown) => {
		params.push(value)
		return `?${params.length}`
	}
	if (f.from) where.push(`date >= ${p(f.from)}`)
	if (f.timeClass) where.push(`time_class = ${p(f.timeClass)}`)
	if (f.minOpponentElo) where.push(`${opponent}_elo >= ${p(f.minOpponentElo)}`)
	if (f.maxOpponentElo) where.push(`${opponent}_elo <= ${p(f.maxOpponentElo)}`)
	const { results } = await db
		.prepare(
			`SELECT id, date, result, opening_moves AS openingMoves, opening, time_class AS timeClass,
				${own}_elo AS ownElo, ${opponent}_elo AS opponentElo, ${clocks ? 'clocks' : 'NULL AS clocks'}
			FROM games WHERE ${where.join(' AND ')}`
		)
		.bind(...params)
		.all<PlayerGame>()
	return results
}

/** Las que entran en el repertorio: con jugadas desde la posición inicial. */
export function repertoireGames(games: PlayerGame[]): RepertoireGame[] {
	return games.filter((g): g is PlayerGame & { openingMoves: string } => g.openingMoves !== null)
}
