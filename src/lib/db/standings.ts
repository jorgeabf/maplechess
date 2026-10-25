// Clasificación de un torneo (tabla standings; ver la migración 0011), tal
// como la publica la fuente.
import { madridYear } from '../dates'
import { hasDossierSql, minorsBornSince } from './players'

export interface StandingRow {
	pos: number
	/** Número del ranking inicial del jugador o del equipo. */
	startRank: number
	points: number
	/** Valores de los desempates, en el orden de Standings.tiebreaks. */
	tiebreaks: (number | null)[]
	/**
	 * Jugador, de sus datos como participante (sin el año de los menores, y
	 * «Jugador retirado» sin FIDE ID), o equipo. Null si el jugador ya no está
	 * entre los participantes.
	 */
	name: string | null
	/** ELO del jugador o ELO medio del equipo. */
	rating: number | null
	/** Los datos que siguen, sólo de los jugadores: en los equipos, null y 0. */
	fideId: number | null
	title: string | null
	fed: string | null
	/** 1 si tiene dossier (hasDossierSql): sólo entonces se enlaza. */
	hasDossier: 0 | 1
}

export interface Standings {
	/** Rondas del torneo; null si la fuente no las da. */
	rounds: number | null
	/** Ronda tras la que va; null si la fuente no lo dice (los torneos por equipos). */
	round: number | null
	/** Códigos de los desempates, en el orden de los valores de cada fila. */
	tiebreaks: string[]
	rows: StandingRow[]
}

// En el orden de la clave de standings: se recorre sin ordenar. Cada jugador
// se busca en participations por su clave; el LEFT JOIN fija ese orden de
// recorrido. ?2 es el año de hasDossierSql.
const PLAYER_ROWS = `SELECT s.pos, s.start_rank AS startRank, s.points, s.tiebreaks,
		pa.name, pa.rating, pa.fide_id AS fideId, pa.title, pa.fed, ${hasDossierSql('pa.fide_id', '?2')} AS hasDossier
	FROM standings s
	LEFT JOIN participations pa ON pa.tournament_id = s.tournament_id AND pa.team = '' AND pa.start_rank = s.start_rank
	WHERE s.tournament_id = ?1 ORDER BY s.pos, s.start_rank`

const TEAM_ROWS = `SELECT s.pos, s.start_rank AS startRank, s.points, s.tiebreaks,
		s.name, s.rating, NULL AS fideId, NULL AS title, NULL AS fed, 0 AS hasDossier
	FROM standings s WHERE s.tournament_id = ?1 ORDER BY s.pos, s.start_rank`

/** Clasificación del torneo, o null si no hay ninguna guardada. */
export async function getTournamentStandings(
	db: D1Database,
	id: number,
	type: 'individual' | 'team',
	year = madridYear(new Date())
): Promise<Standings | null> {
	const [meta, rows] = await db.batch<unknown>([
		db.prepare('SELECT rounds, standings_round AS round, tiebreaks FROM tournaments WHERE id = ?1').bind(id),
		type === 'team' ? db.prepare(TEAM_ROWS).bind(id) : db.prepare(PLAYER_ROWS).bind(id, minorsBornSince(year))
	])
	const info = meta.results[0] as { rounds: number | null; round: number | null; tiebreaks: string | null } | undefined
	const results = rows.results as (Omit<StandingRow, 'tiebreaks'> & { tiebreaks: string })[]
	if (!info || results.length === 0) return null
	return {
		rounds: info.rounds,
		round: info.round,
		tiebreaks: JSON.parse(info.tiebreaks ?? '[]') as string[],
		rows: results.map((r) => ({ ...r, tiebreaks: JSON.parse(r.tiebreaks) as (number | null)[] }))
	}
}

/**
 * ¿Es la clasificación final? Si va tras la última ronda o, si la fuente no
 * dice tras cuál va (los torneos por equipos) o cuántas tiene, si el torneo ya
 * ha terminado. La usan este título y la ficha del jugador.
 */
export function standingsOver(standings: Pick<Standings, 'round' | 'rounds'>, endDate: string | null, today: string): boolean {
	const { round, rounds } = standings
	return round !== null && rounds !== null ? round >= rounds : endDate !== null && endDate < today
}

/**
 * Lo que dice la ficha del jugador de su clasificación en un torneo. Si no es
 * la final (standingsOver), tras qué ronda va o, si la fuente no lo dice (los
 * torneos por equipos), que se está jugando, con un espacio duro entre
 * «ronda» y su número. Y sobre cuántas rondas van sus puntos: las del torneo
 * o, mientras se juega, las jugadas.
 */
export function standingProgress(
	standings: Pick<Standings, 'round' | 'rounds'>,
	endDate: string | null,
	today: string
): { note: string | null; played: number | null } {
	const { round, rounds } = standings
	const over = standingsOver(standings, endDate, today)
	return {
		note: over ? null : round === null ? 'en juego' : `tras la ronda ${round}`,
		played: (over ? rounds : null) ?? round
	}
}

/** Título de la clasificación: final (standingsOver) o la de la última ronda jugada. */
export function standingsHeading(
	standings: Pick<Standings, 'round' | 'rounds'>,
	endDate: string | null,
	today: string
): string {
	if (standingsOver(standings, endDate, today)) return 'Clasificación final'
	return standings.round === null ? 'Clasificación' : `Clasificación tras la ronda ${standings.round}`
}
