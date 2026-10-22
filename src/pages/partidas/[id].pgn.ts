import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { getGame } from '../../lib/db/games'
import { positiveInt } from '../../lib/params'
import { notFound, pgnResponse } from '../../lib/pgn-response'

// Una partida suelta.
export const GET: APIRoute = async ({ params }) => {
	const id = positiveInt(params.id)
	const game = id === null ? null : await getGame(env.DB, id)
	if (!game) return notFound('Partida no encontrada')
	return pgnResponse([game.pgn], `${game.whiteName} - ${game.blackName} ${game.date ?? ''}`)
}
