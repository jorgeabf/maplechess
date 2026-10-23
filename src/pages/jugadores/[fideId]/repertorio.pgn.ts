import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { explore, parseLine } from '../../../lib/chess/repertoire'
import { addYears, isoDate } from '../../../lib/dates'
import { exportGameIds, gamesPgn } from '../../../lib/db/games'
import { getPlayer, MINOR_UNAVAILABLE } from '../../../lib/db/players'
import { getPlayerGames, repertoireGames } from '../../../lib/db/repertoire'
import { COLOR_NAME } from '../../../lib/format'
import { positiveInt, repertoireParams } from '../../../lib/params'
import { notFound, pgnResponse } from '../../../lib/pgn-response'

// Partidas del repertorio que pasan por una posición, con los mismos
// parámetros que la página del repertorio.
export const GET: APIRoute = async ({ params, url }) => {
	const fideId = positiveInt(params.fideId)
	const player = fideId === null ? null : await getPlayer(env.DB, fideId)
	if (fideId === null || !player) return notFound('Jugador no encontrado')
	// Un posible menor no tiene repertorio (CLAUDE.md, «Menores»).
	if (player.minor) return notFound(MINOR_UNAVAILABLE)

	const { color, period, timeClass, minElo, maxElo, moves } = repertoireParams(url.searchParams)
	const from = period ? addYears(isoDate(new Date()), -Number(period)) : null
	const games = repertoireGames(
		await getPlayerGames(env.DB, fideId, color, { from, timeClass, minOpponentElo: minElo, maxOpponentElo: maxElo })
	)
	const reached = explore(games, parseLine(moves).position, color).games
	const ids = await exportGameIds(env.DB, { ids: reached.map((g) => g.id) })
	return pgnResponse(gamesPgn(env.DB, ids), `${player.name} ${COLOR_NAME[color]}`)
}
