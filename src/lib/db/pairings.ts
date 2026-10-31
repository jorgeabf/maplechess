// Emparejamientos de las próximas rondas (tabla pairings; ver la migración
// 0004). Sólo cuentan las rondas que aún no han empezado: `now` es la hora
// local de España, en el mismo formato que starts_at.
import { madridDateTime } from '../dates'
import { topPerTournament } from './games'
import { hasDossierSql, minorsBornSince } from './players'

export interface PairingPlayer {
	name: string
	title: string | null
	fideId: number | null
	rating: number | null
	/** 1 si tiene dossier (hasDossierSql): sólo entonces se enlaza. */
	hasDossier: 0 | 1
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

/**
 * La mesa y sus dos jugadores, de la tabla pairings con alias `p` (ver
 * toRoundPairing). `bornSince` es el parámetro de hasDossierSql.
 */
const pairingColumns = (bornSince: string) => `p.board,
	p.white_name AS whiteName, p.white_title AS whiteTitle, p.white_fide_id AS whiteFideId, p.white_rating AS whiteRating,
	${hasDossierSql('p.white_fide_id', bornSince)} AS whiteHasDossier,
	p.black_name AS blackName, p.black_title AS blackTitle, p.black_fide_id AS blackFideId, p.black_rating AS blackRating,
	${hasDossierSql('p.black_fide_id', bornSince)} AS blackHasDossier`

/** Desde qué año de nacimiento se puede ser menor en el año de `now` (minorsBornSince). */
const bornSinceAt = (now: string) => minorsBornSince(Number(now.slice(0, 4)))

interface PairingRow {
	board: number
	whiteName: string
	whiteTitle: string | null
	whiteFideId: number | null
	whiteRating: number | null
	whiteHasDossier: 0 | 1
	blackName: string
	blackTitle: string | null
	blackFideId: number | null
	blackRating: number | null
	blackHasDossier: 0 | 1
}

function toRoundPairing(r: PairingRow): RoundPairing {
	return {
		board: r.board,
		white: {
			name: r.whiteName,
			title: r.whiteTitle,
			fideId: r.whiteFideId,
			rating: r.whiteRating,
			hasDossier: r.whiteHasDossier
		},
		black: {
			name: r.blackName,
			title: r.blackTitle,
			fideId: r.blackFideId,
			rating: r.blackRating,
			hasDossier: r.blackHasDossier
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
			`SELECT p.round, p.starts_at AS startsAt, ${pairingColumns('?3')}
			FROM pairings p WHERE p.tournament_id = ?1 AND p.starts_at > ?2 ORDER BY p.board`
		)
		.bind(tournamentId, now, bornSinceAt(now))
		.all<PairingRow & { round: number; startsAt: string }>()
	if (results.length === 0) return null
	return {
		round: results[0].round,
		startsAt: results[0].startsAt,
		pairings: results.map(toRoundPairing)
	}
}

/** Próxima ronda emparejada de un torneo de info64, sin los jugadores (/api/emparejamientos). */
export interface PairedRoundSummary {
	/** source_key: el slug de la URL de info64. */
	slug: string
	round: number
	/** 'YYYY-MM-DD HH:MM', hora local. */
	startsAt: string
	/** Filas de la ronda en pairings. */
	boards: number
}

/**
 * La próxima ronda de cada torneo, de las que aún no han empezado (la hora, en
 * ?1). Sólo hay una ronda por torneo (replacePairings la sustituye entera), así
 * que su número y su hora son los de cualquiera de sus mesas. Recorre pairings
 * entera, que es pequeña, y busca cada torneo por su clave primaria. Con JOIN,
 * el planificador recorría antes los torneos de info64 por el índice único de
 * (source, source_key): 8.830 filas en vez de 398, con 8.700 torneos y 360 mesas.
 */
export const PAIRED_ROUNDS_SQL = `SELECT t.source_key AS slug, r.round, r.startsAt, r.boards
	FROM (SELECT tournament_id, round, starts_at AS startsAt, count(*) AS boards
		FROM pairings WHERE starts_at > ?1 GROUP BY tournament_id) r
	CROSS JOIN tournaments t ON t.id = r.tournament_id
	WHERE t.source = 'info64'`

/**
 * La próxima ronda de cada torneo que ya está emparejada y aún no ha empezado,
 * con el criterio de getUpcomingRound, por hora y slug. Los torneos sensibles y
 * los de menores no están: la ingesta no los guarda.
 */
export async function getPairedRounds(db: D1Database, now = madridDateTime(new Date())): Promise<PairedRoundSummary[]> {
	const { results } = await db.prepare(PAIRED_ROUNDS_SQL).bind(now).all<PairedRoundSummary>()
	return results.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.slug.localeCompare(b.slug))
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
 * ese orden, y el año de hasDossierSql. Cada una entra por la clave primaria
 * de pairings.
 */
export const PAIRINGS_BY_KEY_SQL = `SELECT p.tournament_id AS tournamentId, t.name AS tournamentName, p.round,
		p.starts_at AS startsAt, ${pairingColumns('?2')}
	FROM json_each(?1) k
	JOIN pairings p ON p.tournament_id = k.value ->> 0 AND p.board = k.value ->> 1
	JOIN tournaments t ON t.id = p.tournament_id
	ORDER BY k.key`

/**
 * Las `limit` mesas de más nivel (ELO medio) de las próximas rondas de todos
 * los torneos, como mucho dos por torneo; las que tienen un jugador sin ELO no
 * entran. Recorre la tabla entera, que es pequeña (313 filas el 21-oct-2026:
 * una ronda por torneo, de los próximos 8 días), elige y sólo después lee las
 * elegidas: así hasDossierSql corre en ellas y no en todas.
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
		.bind(JSON.stringify(top.map((m) => [m.tournamentId, m.board])), bornSinceAt(now))
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
		p.${rival}_fide_id AS fideId, p.${rival}_rating AS rating, ${hasDossierSql(`p.${rival}_fide_id`, '?3')} AS hasDossier`
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
		.bind(fideId, now, bornSinceAt(now))
		.all<UpcomingGameRow>()
	return results.map(({ name, title, fideId: opponentId, rating, hasDossier, ...game }) => ({
		...game,
		opponent: { name, title, fideId: opponentId, rating, hasDossier }
	}))
}
