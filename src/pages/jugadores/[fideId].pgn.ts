import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { exportGameIds, gamesPgn } from '../../lib/db/games'
import { getPlayer } from '../../lib/db/players'
import { gameFilters, positiveInt } from '../../lib/params'
import { notFound, pgnResponse } from '../../lib/pgn-response'

// Partidas de un jugador, con los mismos filtros que su ficha.
export const GET: APIRoute = async ({ params, url }) => {
	const fideId = positiveInt(params.fideId)
	const player = fideId === null ? null : await getPlayer(env.DB, fideId)
	if (fideId === null || !player) return notFound('Jugador no encontrado')

	const { color, result, eco, timeClass, tournamentId } = gameFilters(url.searchParams)
	const ownResult = result === 'win' || result === 'draw' || result === 'loss' ? result : ''
	const ids = await exportGameIds(env.DB, { fideId, color, result: ownResult, eco, timeClass, tournamentId })
	return pgnResponse(gamesPgn(env.DB, ids), player.name)
}
