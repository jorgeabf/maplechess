// Emparejamientos de las próximas rondas (tabla pairings; ver la migración
// 0004). Sólo cuentan las rondas que aún no han empezado: `now` es la hora
// local de España, en el mismo formato que starts_at.
import { madridDateTime } from '../dates'
import { hasGamesSql, topPerTournament } from './games'

export interface PairingPlayer {
	name: string
	title: string | null
	fideId: number | null
	rating: number | null
	/** 1 si tiene partidas: sólo entonces se enlaza su dossier. */
	hasGames: 0 | 1
}

export interface RoundPairing {
	board: number
	white: PairingPlayer
	black: PairingPlayer
}

export interface PairedRound {
	round: number
	/** 'YYYY-MM-DD HH:MM', hora local. */
	startsAt: string
	pairings: RoundPairing[]
}

/** La mesa y sus dos jugadores, de la tabla pairings con alias `p` (ver toRoundPairing). */
const PAIRING_COLUMNS = `p.board,
	p.white_name AS whiteName, p.white_title AS whiteTitle, p.white_fide_id AS whiteFideId, p.white_rating AS whiteRating,
	${hasGamesSql('p.white_fide_id')} AS whiteHasGames,
	p.black_name AS blackName, p.black_title AS blackTitle, p.black_fide_id AS blackFideId, p.black_rating AS blackRating,
	${hasGamesSql('p.black_fide_id')} AS blackHasGames`

interface PairingRow {
	board: number
	whiteName: string
	whiteTitle: string | null
	whiteFideId: number | null
	whiteRating: number | null
	whiteHasGames: 0 | 1
	blackName: string
	blackTitle: string | null
	blackFideId: number | null
	blackRating: number | null
	blackHasGames: 0 | 1
}

function toRoundPairing(r: PairingRow): RoundPairing {
	return {
		board: r.board,
		white: {
			name: r.whiteName,
			title: r.whiteTitle,
			fideId: r.whiteFideId,
			rating: r.whiteRating,
			hasGames: r.whiteHasGames
		},
		black: {
			name: r.blackName,
			title: r.blackTitle,
			fideId: r.blackFideId,
			rating: r.blackRating,
			hasGames: r.blackHasGames
		}
	}
}

/** Próxima ronda emparejada del torneo, si aún no ha empezado. */
export async function getUpcomingRound(
	db: D1Database,
	tournamentId: number,
	now = madridDateTime(new Date())
): Promise<PairedRound | null> {
	const { results } = await db
		.prepare(
			`SELECT p.round, p.starts_at AS startsAt, ${PAIRING_COLUMNS}
			FROM pairings p WHERE p.tournament_id = ?1 AND p.starts_at > ?2 ORDER BY p.board`
		)
		.bind(tournamentId, now)
		.all<PairingRow & { round: number; startsAt: string }>()
	if (results.length === 0) return null
	return {
		round: results[0].round,
		startsAt: results[0].startsAt,
		pairings: results.map(toRoundPairing)
	}
}

/** Una mesa de la próxima ronda de cualquier torneo. */
export interface UpcomingPairing extends RoundPairing {
	tournamentId: number
	tournamentName: string
	round: number
	/** 'YYYY-MM-DD HH:MM', hora local. */
	startsAt: string
}

/**
 * Las mesas que se piden, por torneo y mesa (JSON de pares [torneo, mesa]), en
 * ese orden. Cada una entra por la clave primaria de pairings.
 */
export const PAIRINGS_BY_KEY_SQL = `SELECT p.tournament_id AS tournamentId, t.name AS tournamentName, p.round,
		p.starts_at AS startsAt, ${PAIRING_COLUMNS}
	FROM json_each(?1) k
	JOIN pairings p ON p.tournament_id = k.value ->> 0 AND p.board = k.value ->> 1
	JOIN tournaments t ON t.id = p.tournament_id
	ORDER BY k.key`

/**
 * Las `limit` mesas de más nivel (ELO medio) de las próximas rondas de todos
 * los torneos, como mucho dos por torneo; las que tienen un jugador sin ELO no
 * entran. Recorre la tabla entera, que es pequeña (313 filas el 21-oct-2026:
 * una ronda por torneo, de los próximos 8 días), elige y sólo después lee las
 * elegidas: así hasGamesSql corre en ellas y no en todas.
 */
export async function getTopUpcomingPairings(
	db: D1Database,
	limit = 8,
	now = madridDateTime(new Date())
): Promise<UpcomingPairing[]> {
	const { results } = await db
		.prepare('SELECT tournament_id AS tournamentId, board, white_rating + black_rating AS elo FROM pairings WHERE starts_at > ?1')
		.bind(now)
		.all<{ tournamentId: number; board: number; elo: number | null }>()
	const top = topPerTournament(results, limit)
	if (top.length === 0) return []
	const { results: rows } = await db
		.prepare(PAIRINGS_BY_KEY_SQL)
		.bind(JSON.stringify(top.map((m) => [m.tournamentId, m.board])))
		.all<PairingRow & Omit<UpcomingPairing, keyof RoundPairing>>()
	return rows.map(({ tournamentId, tournamentName, round, startsAt, ...row }) => ({
		tournamentId,
		tournamentName,
		round,
		startsAt,
		...toRoundPairing(row)
	}))
}

export interface UpcomingGame {
	tournamentId: number
	tournamentName: string
	round: number
	board: number
	startsAt: string
	/** Color del jugador. */
	color: 'white' | 'black'
	opponent: PairingPlayer
}

interface UpcomingGameRow extends Omit<UpcomingGame, 'opponent'>, PairingPlayer {}

/** Próximas partidas emparejadas del jugador, por orden de hora (puede jugar dos torneos a la vez). */
export async function getUpcomingGames(
	db: D1Database,
	fideId: number,
	now = madridDateTime(new Date())
): Promise<UpcomingGame[]> {
	const columns = (color: 'white' | 'black', rival: 'white' | 'black') =>
		`p.tournament_id AS tournamentId, t.name AS tournamentName, p.round, p.board, p.starts_at AS startsAt,
		'${color}' AS color, p.${rival}_name AS name, p.${rival}_title AS title,
		p.${rival}_fide_id AS fideId, p.${rival}_rating AS rating, ${hasGamesSql(`p.${rival}_fide_id`)} AS hasGames`
	// Una consulta por color: cada una recorre su índice parcial (pairings_white, pairings_black).
	const { results } = await db
		.prepare(
			`SELECT ${columns('white', 'black')}
			FROM pairings p JOIN tournaments t ON t.id = p.tournament_id
			WHERE p.white_fide_id = ?1 AND p.starts_at > ?2
			UNION ALL
			SELECT ${columns('black', 'white')}
			FROM pairings p JOIN tournaments t ON t.id = p.tournament_id
			WHERE p.black_fide_id = ?1 AND p.starts_at > ?2
			ORDER BY startsAt`
		)
		.bind(fideId, now)
		.all<UpcomingGameRow>()
	return results.map(({ name, title, fideId: opponentId, rating, hasGames, ...game }) => ({
		...game,
		opponent: { name, title, fideId: opponentId, rating, hasGames }
	}))
}
