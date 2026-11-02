// El título y el ELO de unos jugadores de la lista FIDE española (getRatings),
// para el ranking de la web del club Eguidazu (eguidazu.com), que así no lee
// los perfiles de la FIDE. Sin nombre, año ni sexo. Cada ritmo, null si no
// tiene ELO; su `inactivo`, de la marca de la FIDE, o null si no se sabe. Los
// que no están en la lista (otra federación, retirados) no salen. Hasta 100
// por petición.
//
// 503 si la importación FIDE da la alarma (caducada o con fallos, como en
// /api/estado). La lista cambia una vez al mes: caché pública de una hora, y el
// 503 sin caché.
//
//   GET /api/elo?fide=2200000,2200001
//   →  {"lista":"2026-11","jugadores":[{"fide":2200000,"titulo":"FM","estandar":{"elo":2286,"inactivo":false},
//        "rapido":{"elo":2263,"inactivo":false},"relampago":null}]}
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { badRequest, listParam } from '../../lib/api'
import { getRatings, type Rating } from '../../lib/db/players'
import { isAlarm, loadHealth } from '../../lib/salud'

export const MAX_PLAYERS = 100

const elo = (r: Rating | null) => (r === null ? null : { elo: r.rating, inactivo: r.inactive })

export const GET: APIRoute = async ({ url }) => {
	const ids = listParam(url.searchParams, 'fide', MAX_PLAYERS, /^[1-9]\d{0,9}$/)
	if ('error' in ids) return badRequest(ids.error)
	const [runs, ratings] = await Promise.all([loadHealth(env.DB), getRatings(env.DB, ids.values.map(Number))])
	if (isAlarm(runs.fide)) {
		return Response.json({ fide: runs.fide }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
	}
	return Response.json(
		{
			lista: ratings.list,
			jugadores: ratings.players.map((p) => ({
				fide: p.fideId,
				titulo: p.title,
				estandar: elo(p.std),
				rapido: elo(p.rapid),
				relampago: elo(p.blitz)
			}))
		},
		{ headers: { 'Cache-Control': 'public, max-age=3600' } }
	)
}
