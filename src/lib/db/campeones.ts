// Campeones de España (/torneos/campeones): de cada edición de la lista
// curada (lib/campeonatos.ts), su torneo y quien lo ganó.
import { CHAMPIONSHIPS, REVEALS, type Championship } from '../campeonatos'
import { madridDate } from '../dates'
import { minorsBornSince } from './players'

export interface Champion extends Championship {
	tournamentId: number
	tournamentName: string
	gamesCount: number
	/**
	 * Jugador, con su nombre de la lista FIDE si está en ella y, si no, con el
	 * de participante (los extranjeros, y los retirados como «Jugador
	 * retirado», sin FIDE ID); los dos ya van sin el año de los menores ni el de
	 * quien lo ha ocultado. O equipo, de la clasificación. Null si el jugador ya
	 * no está entre los participantes o si puede ser menor.
	 */
	name: string | null
	title: string | null
	fideId: number | null
	points: number
}

// Una sentencia por edición. El torneo, por su clave natural, si su
// clasificación es la final (como en standingsHeading: tras la última ronda o,
// si la fuente no dice tras cuál va, con el torneo terminado; ?6 es hoy). Su
// fila de la clasificación, recorriendo la clave de standings en orden hasta
// la primera o hasta la de su número inicial (?3): una fila, o tantas como el
// puesto de quien ganó si no es el primero. El jugador, por la clave de
// participations, y su nombre de la lista FIDE y su edad, por la de players:
// cada torneo trae el nombre a su manera («Jose Antonio» en uno y «Josep
// Anton» en otro, con el mismo FIDE ID). Si la categoría dice su sexo
// (?5), si lo ha ocultado, por el índice único de ocultaciones; si dice su
// edad, si ha ocultado el año, en la misma fila de players.
const CHAMPION = `SELECT t.id AS tournamentId, t.name AS tournamentName, t.games_count AS gamesCount, s.points,
		CASE WHEN t.type = 'team' THEN s.name ELSE coalesce(m.name, p.name) END AS name, p.title, p.fide_id AS fideId,
		m.birth_year >= ?4 AS minor,
		CASE ?5
			WHEN 'sexo' THEN EXISTS (SELECT 1 FROM ocultaciones o WHERE o.fide_id = p.fide_id AND o.campo = 'sexo')
			WHEN 'anio' THEN m.birth_year_hidden = 1
			ELSE 0
		END AS hidden
	FROM tournaments t
	JOIN standings s ON s.tournament_id = t.id
	LEFT JOIN participations p ON t.type = 'individual' AND p.tournament_id = t.id AND p.team = '' AND p.start_rank = s.start_rank
	LEFT JOIN players m ON m.fide_id = p.fide_id
	WHERE t.source = ?1 AND t.source_key = ?2
		AND CASE WHEN t.standings_round IS NOT NULL AND t.rounds IS NOT NULL THEN t.standings_round >= t.rounds ELSE t.end_date < ?6 END
		AND (?3 IS NULL OR s.start_rank = ?3)
	ORDER BY s.pos, s.start_rank LIMIT 1`

type Row = Omit<Champion, keyof Championship> & { minor: 0 | 1 | null; hidden: 0 | 1 | null }

/**
 * Los campeones de `championships`, en su orden. Sin las ediciones cuyo torneo
 * no está guardado o aún no tiene la clasificación final, ni la de quien ha
 * pedido ocultar lo que dice su categoría (tabla ocultaciones): el sexo en el
 * femenino y el año en veteranos. De quien puede ser menor (mayBeMinor), la
 * edición sin su nombre ni su ficha (decidido por Jorge el 25-oct-2026): la
 * lista no lo destaca, y sigue en la clasificación del torneo.
 */
export async function getChampions(
	db: D1Database,
	championships: readonly Championship[] = CHAMPIONSHIPS,
	today = madridDate(new Date())
): Promise<Champion[]> {
	if (championships.length === 0) return []
	const bornSince = minorsBornSince(Number(today.slice(0, 4)))
	const statement = db.prepare(CHAMPION)
	const results = await db.batch<Row>(
		championships.map((c) =>
			statement.bind(c.source, c.sourceKey, c.startRank ?? null, bornSince, REVEALS[c.category] ?? null, today)
		)
	)
	return championships.flatMap((championship, i) => {
		const row = results[i].results[0]
		if (!row || row.hidden) return []
		const { hidden: _hidden, minor, ...champion } = row
		return [{ ...championship, ...champion, ...(minor ? { name: null, title: null, fideId: null } : {}) }]
	})
}
