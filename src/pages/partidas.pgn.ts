import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { exportGameIds, gamesPgn } from '../lib/db/games'
import { gameFilters, gameSearchKind } from '../lib/params'
import { pgnResponse } from '../lib/pgn-response'

// PGN de una búsqueda de partidas: mismos parámetros que /partidas.
export const GET: APIRoute = async ({ url }) => {
	const { page: _page, ...filters } = gameFilters(url.searchParams)
	if (gameSearchKind(filters) !== 'search') {
		return new Response(
			'Indica un jugador, un rival, una apertura (ECO) o unas fechas: el color, el ritmo y el resultado sólo afinan la búsqueda.',
			{ status: 400 }
		)
	}
	const name = [filters.player, filters.opponent].filter(Boolean).join('-') || 'partidas'
	return pgnResponse(gamesPgn(env.DB, await exportGameIds(env.DB, filters)), name)
}
