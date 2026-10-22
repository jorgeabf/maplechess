import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { exportGameIds, gamesPgn } from '../../lib/db/games'
import { getTournament } from '../../lib/db/tournaments'
import { positiveInt } from '../../lib/params'
import { notFound, pgnResponse } from '../../lib/pgn-response'

// Todas las partidas de un torneo.
export const GET: APIRoute = async ({ params }) => {
	const id = positiveInt(params.id)
	const tournament = id === null ? null : await getTournament(env.DB, id)
	if (!tournament) return notFound('Torneo no encontrado')
	const ids = await exportGameIds(env.DB, { tournamentId: tournament.id }, 'round')
	return pgnResponse(gamesPgn(env.DB, ids), tournament.name)
}
