// Escrituras de la ingesta en D1.
//
// D1 admite 100 parámetros por sentencia, así que las filas se mandan como un
// único parámetro JSON y se insertan con INSERT … SELECT … FROM json_each(?).
// Cada parámetro puede ocupar hasta 2 MB: los lotes se cortan por tamaño.
import { normalizeName } from '../lib/chess/names'
import { setPgnTags } from '../lib/chess/pgn'
import { madridYear } from '../lib/dates'
import { withoutHomonymYear } from '../lib/format'
import { lichessUrl } from '../lib/licenses'
import type { FidePlayer } from './fide/parse'
import type { DerivedColumns, GameRow, Participant, TournamentContext } from './games'
import type { Pairing, PairedPlayer, StandingsPage, TournamentPlayer, TournamentType } from './info64/parse'
import {
	anonymizePgn,
	isRetired,
	nameKey,
	publicName,
	RETIRED_NAME,
	withoutHiddenYear,
	yearKey,
	type HiddenYears,
	type Retired
} from './nombres'
import { appliedRows, rectifyGame, rectifyParticipant, type Rectification } from './rectificaciones'

const MAX_JSON_BYTES = 1_000_000

/**
 * Personas que han pedido que se las retire (tabla retiradas). Es pequeña: se
 * lee entera en cada escritura que la necesita.
 */
export async function loadRetired(db: D1Database): Promise<Retired> {
	const { results } = await db
		.prepare('SELECT fide_id AS fideId, nombre FROM retiradas')
		.all<{ fideId: number | null; nombre: string }>()
	return {
		ids: new Set(results.flatMap((r) => (r.fideId === null ? [] : [r.fideId]))),
		names: new Set(results.map((r) => nameKey(r.nombre)))
	}
}

/**
 * Quien ha pedido ocultar su año (tabla ocultaciones), con su nombre y su año
 * de la ficha para reconocerle sin FIDE ID. Es pequeña: se lee entera en cada
 * escritura que la necesita, como la de retiradas.
 */
export async function loadHiddenYears(db: D1Database): Promise<HiddenYears> {
	const { results } = await db
		.prepare(
			`SELECT o.fide_id AS fideId, p.name, p.birth_year AS birthYear
			FROM ocultaciones o LEFT JOIN players p ON p.fide_id = o.fide_id
			WHERE o.campo = 'anio'`
		)
		.all<{ fideId: number; name: string | null; birthYear: number | null }>()
	return {
		ids: new Set(results.map((r) => r.fideId)),
		names: new Set(
			results.flatMap((r) => (r.name !== null && r.birthYear !== null ? [yearKey(r.name, r.birthYear)] : []))
		)
	}
}

/**
 * Rectificaciones del torneo (tabla rectificaciones, por su clave natural).
 * Casi nunca hay ninguna: es una lectura del índice por escritura.
 */
export async function loadRectifications(db: D1Database, tournamentId: number): Promise<Rectification[]> {
	const { results } = await db
		.prepare(
			`SELECT r.id, r.fide_id AS fideId, r.nombre AS name, r.ronda AS round, r.campo AS field, r.valor AS value
			FROM tournaments t JOIN rectificaciones r ON r.source = t.source AND r.source_key = t.source_key
			WHERE t.id = ?1`
		)
		.bind(tournamentId)
		.all<Rectification>()
	return results
}

/**
 * Apunta en `aplicada` lo que ha aplicado una escritura (appliedRows): `at` en
 * las filas que casan y NULL en las demás que le tocaba aplicar, que es la
 * alarma de /api/estado. Va en el mismo batch que la escritura.
 */
function markApplied(db: D1Database, applied: { checked: number[]; hits: number[] }, at: string): D1PreparedStatement[] {
	if (applied.checked.length === 0) return []
	return [
		db
			.prepare(
				`UPDATE rectificaciones SET aplicada = CASE WHEN id IN (SELECT value FROM json_each(?2)) THEN ?1 END
				WHERE id IN (SELECT value FROM json_each(?3))`
			)
			.bind(at, JSON.stringify(applied.hits), JSON.stringify(applied.checked))
	]
}

/** Parte las filas en lotes cuyo JSON no pase de maxBytes. */
export function chunkByJsonSize<T>(rows: T[], maxBytes = MAX_JSON_BYTES): string[] {
	return [...jsonChunks(rows, maxBytes)]
}

/** Los lotes de chunkByJsonSize de uno en uno, para no tenerlos todos en memoria a la vez. */
export function* jsonChunks<T>(rows: Iterable<T>, maxBytes = MAX_JSON_BYTES): Generator<string> {
	const encoder = new TextEncoder()
	let current: string[] = []
	let size = 2
	for (const row of rows) {
		const json = JSON.stringify(row)
		const bytes = encoder.encode(json).length + 1
		if (current.length > 0 && size + bytes > maxBytes) {
			yield `[${current.join(',')}]`
			current = []
			size = 2
		}
		current.push(json)
		size += bytes
	}
	if (current.length > 0) yield `[${current.join(',')}]`
}

export interface TournamentInput {
	source: string
	key: string
	type: TournamentType
	name: string
	city: string | null
	startDate: string | null
	endDate: string | null
	timeControl: string | null
	url: string
	syncedAt: string
}

/**
 * Guarda el torneo y devuelve su id. Una lectura que no trae la ciudad, las
 * fechas o el ritmo (la página cambió o vino a medias) no borra los guardados.
 */
export async function upsertTournament(db: D1Database, t: TournamentInput): Promise<number> {
	const row = await db
		.prepare(
			`INSERT INTO tournaments (source, source_key, type, name, city, start_date, end_date, time_control, url, synced_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
			ON CONFLICT (source, source_key) DO UPDATE SET
				type = excluded.type,
				name = excluded.name,
				city = coalesce(excluded.city, tournaments.city),
				start_date = coalesce(excluded.start_date, tournaments.start_date),
				end_date = coalesce(excluded.end_date, tournaments.end_date),
				time_control = coalesce(excluded.time_control, tournaments.time_control),
				url = excluded.url,
				synced_at = excluded.synced_at
			RETURNING id`
		)
		.bind(t.source, t.key, t.type, t.name, t.city, t.startDate, t.endDate, t.timeControl, t.url, t.syncedAt)
		.first<{ id: number }>()
	if (!row) throw new Error(`No se pudo guardar el torneo ${t.source}/${t.key}`)
	return row.id
}

/**
 * Sustituye los participantes del torneo (el ranking inicial puede cambiar
 * entre lecturas). Los nombres, sin el año de los menores ni el de quien ha
 * pedido ocultarlo; los datos, rectificados (rectificaciones.ts), y los
 * retirados, anonimizados (nombres.ts). Una lista vacía no borra la guardada:
 * es una página que cambió o vino a medias (un torneo aún sin inscritos no
 * tiene nada guardado).
 * Devuelve false si se ha conservado una lista guardada, para avisar.
 */
export async function replaceParticipations(
	db: D1Database,
	tournamentId: number,
	players: TournamentPlayer[]
): Promise<boolean> {
	if (players.length === 0) {
		const stored = await db.prepare('SELECT 1 FROM participations WHERE tournament_id = ?1 LIMIT 1').bind(tournamentId).first()
		return stored === null
	}
	const year = madridYear(new Date())
	const retired = await loadRetired(db)
	const hiddenYears = await loadHiddenYears(db)
	const rectifications = await loadRectifications(db, tournamentId)
	const hits = new Set<number>()
	const rows = players.map((player) => {
		// La retirada y el año oculto, después: miran a quien es de verdad.
		const p = rectifyParticipant(player, rectifications, hits, year)
		if (isRetired(retired, p.fideId, p.name)) {
			return { ...p, name: RETIRED_NAME, nameNorm: normalizeName(RETIRED_NAME), fideId: null, title: null }
		}
		const name = withoutHiddenYear(hiddenYears, p.fideId, publicName(p.name, year))
		return { ...p, name, nameNorm: normalizeName(name) }
	})
	await db.batch([
		db.prepare('DELETE FROM participations WHERE tournament_id = ?1').bind(tournamentId),
		...chunkByJsonSize(rows).map((json) =>
			db
				.prepare(
					`INSERT INTO participations (tournament_id, team, start_rank, name, name_norm, fide_id, title, fed, rating)
					SELECT ?1,
						coalesce(json_extract(value, '$.team'), ''),
						json_extract(value, '$.startRank'),
						json_extract(value, '$.name'),
						json_extract(value, '$.nameNorm'),
						json_extract(value, '$.fideId'),
						json_extract(value, '$.title'),
						json_extract(value, '$.fed'),
						json_extract(value, '$.rating')
					FROM json_each(?2)
					WHERE true
					ON CONFLICT DO NOTHING`
				)
				.bind(tournamentId, json)
		),
		...markApplied(db, appliedRows(rectifications, hits, 'participantes'), new Date().toISOString())
	])
	return true
}

export async function loadParticipants(db: D1Database, tournamentId: number): Promise<Participant[]> {
	const { results } = await db
		.prepare(
			`SELECT name, fide_id AS fideId, rating, title
			FROM participations WHERE tournament_id = ?1 ORDER BY start_rank`
		)
		.bind(tournamentId)
		.all<Participant>()
	return results
}

/**
 * Sustituye la clasificación del torneo y apunta sus rondas, la ronda tras la
 * que va y sus desempates. Como con los participantes, una lectura sin puntos
 * (vacía, o de un torneo aún sin resultados, todos a 0) no borra la guardada.
 * En los individuales tampoco una con algún número que no esté entre los
 * participantes, porque el jugador sale de ahí: el nombre y el FIDE ID no se
 * repiten en standings, así que tampoco el año de los menores ni los
 * retirados. Devuelve false si se ha conservado una clasificación guardada o
 * la lectura no casa con los participantes, para avisar.
 */
export async function replaceStandings(
	db: D1Database,
	tournamentId: number,
	type: TournamentType,
	page: StandingsPage
): Promise<boolean> {
	if (!page.rows.some((r) => r.points > 0)) {
		const stored = await db.prepare('SELECT 1 FROM standings WHERE tournament_id = ?1 LIMIT 1').bind(tournamentId).first()
		return stored === null
	}
	const team = type === 'team'
	if (!team) {
		const ranks = [...new Set(page.rows.map((r) => r.startRank))]
		const known = await db
			.prepare(
				`SELECT count(*) AS n FROM participations
				WHERE tournament_id = ?1 AND team = '' AND start_rank IN (SELECT value FROM json_each(?2))`
			)
			.bind(tournamentId, JSON.stringify(ranks))
			.first<{ n: number }>()
		if ((known?.n ?? 0) < ranks.length) return false
	}
	const rows = page.rows.map((r) => ({
		pos: r.pos,
		startRank: r.startRank,
		name: team ? r.name : null,
		rating: team ? r.rating : null,
		points: r.points,
		tiebreaks: r.tiebreaks
	}))
	await db.batch([
		db.prepare('DELETE FROM standings WHERE tournament_id = ?1').bind(tournamentId),
		...chunkByJsonSize(rows).map((json) =>
			db
				.prepare(
					`INSERT INTO standings (tournament_id, pos, start_rank, name, rating, points, tiebreaks)
					SELECT ?1,
						json_extract(value, '$.pos'),
						json_extract(value, '$.startRank'),
						json_extract(value, '$.name'),
						json_extract(value, '$.rating'),
						json_extract(value, '$.points'),
						json_extract(value, '$.tiebreaks')
					FROM json_each(?2)
					WHERE true
					ON CONFLICT DO NOTHING`
				)
				.bind(tournamentId, json)
		),
		db
			.prepare('UPDATE tournaments SET rounds = coalesce(?2, rounds), standings_round = ?3, tiebreaks = ?4 WHERE id = ?1')
			.bind(tournamentId, page.rounds, page.round, JSON.stringify(page.tiebreaks))
	])
	return true
}

/** De dónde salen las partidas de un torneo. */
export interface GamesSource {
	/** 'info64', 'lichess'… */
	name: string
	/** Página de origen cuando no es la del propio torneo (p. ej. la retransmisión). */
	url: string | null
}

/**
 * Guarda las partidas del torneo en una sola transacción: upsert por
 * (ronda, tablero, seq) para conservar los id, borrado de las que la fuente
 * ya no publica y actualización del contador y la fuente del torneo. También
 * cuenta las que son de lichess (lichess_games, por sus cabeceras), para que la
 * página del torneo cite la licencia sin leer los PGN.
 *
 * Una lectura sin partidas, o con menos de la mitad de las guardadas, no se
 * guarda: es más probable una página vacía, cortada o con otra forma que un
 * organizador que retira medio torneo. Las guardadas se quedan, el torneo pasa
 * por revisado y devuelve false para avisar. Con `replace`, se guarda igual.
 *
 * Las rectificaciones (rectificaciones.ts), la retirada y el año oculto se
 * aplican aquí, después de cruzar y por ese orden: el cruce necesita el FIDE
 * ID y el nombre de la fuente para saber quién es quién, y la retirada y el
 * año oculto miran a quien es de verdad. Una partida oculta no se guarda, y se
 * borra si estaba.
 */
export async function saveGames(
	db: D1Database,
	tournamentId: number,
	rows: GameRow[],
	checkedAt: string,
	source: GamesSource,
	{ replace = false }: { replace?: boolean } = {}
): Promise<boolean> {
	if (!replace) {
		const stored = await db
			.prepare('SELECT games_count AS n FROM tournaments WHERE id = ?1')
			.bind(tournamentId)
			.first<{ n: number }>()
		if (stored && stored.n > 0 && rows.length < stored.n / 2) {
			await markGamesChecked(db, tournamentId, checkedAt)
			return false
		}
	}
	const retired = await loadRetired(db)
	const hiddenYears = await loadHiddenYears(db)
	const rectifications = await loadRectifications(db, tournamentId)
	const hits = new Set<number>()
	const saved = rows.flatMap((row) => {
		const rectified = rectifyGame(row, rectifications, hits)
		return rectified ? [withoutHiddenYears(withoutRetired(rectified, retired), hiddenYears)] : []
	})
	// Sin partidas no hay fuente que mostrar.
	const sourceName = saved.length > 0 ? source.name : null
	const sourceUrl = saved.length > 0 ? source.url : null
	const lichessGames = saved.filter((game) => lichessUrl(game.pgn) !== null).length
	await db.batch([
		...chunkByJsonSize(saved).map((json) =>
			db
				.prepare(
					`INSERT INTO games (tournament_id, round, board, seq, date, white_name, black_name,
						white_fide_id, black_fide_id, white_elo, black_elo, result, eco, opening, ply_count, opening_moves,
						time_class, clocks, pgn, seen_at)
					SELECT ?1,
						json_extract(value, '$.round'),
						json_extract(value, '$.board'),
						json_extract(value, '$.seq'),
						json_extract(value, '$.date'),
						json_extract(value, '$.whiteName'),
						json_extract(value, '$.blackName'),
						json_extract(value, '$.whiteFideId'),
						json_extract(value, '$.blackFideId'),
						json_extract(value, '$.whiteElo'),
						json_extract(value, '$.blackElo'),
						json_extract(value, '$.result'),
						json_extract(value, '$.eco'),
						json_extract(value, '$.opening'),
						json_extract(value, '$.plyCount'),
						json_extract(value, '$.openingMoves'),
						json_extract(value, '$.timeClass'),
						json_extract(value, '$.clocks'),
						json_extract(value, '$.pgn'),
						?2
					FROM json_each(?3)
					WHERE true
					ON CONFLICT (tournament_id, round, board, seq) DO UPDATE SET
						date = excluded.date,
						white_name = excluded.white_name,
						black_name = excluded.black_name,
						white_fide_id = excluded.white_fide_id,
						black_fide_id = excluded.black_fide_id,
						white_elo = excluded.white_elo,
						black_elo = excluded.black_elo,
						result = excluded.result,
						eco = excluded.eco,
						opening = excluded.opening,
						ply_count = excluded.ply_count,
						opening_moves = excluded.opening_moves,
						time_class = excluded.time_class,
						clocks = excluded.clocks,
						pgn = excluded.pgn,
						seen_at = excluded.seen_at`
				)
				.bind(tournamentId, checkedAt, json)
		),
		db.prepare('DELETE FROM games WHERE tournament_id = ?1 AND seen_at <> ?2').bind(tournamentId, checkedAt),
		db
			.prepare(
				`UPDATE tournaments SET
					games_count = (SELECT count(*) FROM games WHERE tournament_id = ?1),
					games_checked_at = ?2,
					games_source = ?3,
					games_source_url = ?4,
					lichess_games = ?5
				WHERE id = ?1`
			)
			.bind(tournamentId, checkedAt, sourceName, sourceUrl, lichessGames),
		...markApplied(db, appliedRows(rectifications, hits, 'partidas'), checkedAt)
	])
	return true
}

/** Jugadores de una partida, en columnas y en el PGN. */
interface GamePlayers {
	whiteName: string
	blackName: string
	whiteFideId: number | null
	blackFideId: number | null
	pgn: string
}

/** La partida con los jugadores retirados anonimizados; la misma si no hay ninguno. */
export function withoutRetired<T extends GamePlayers>(game: T, retired: Retired): T {
	let result = game
	if (isRetired(retired, game.whiteFideId, game.whiteName)) {
		result = { ...result, whiteName: RETIRED_NAME, whiteFideId: null, pgn: anonymizePgn(result.pgn, 'White') }
	}
	if (isRetired(retired, game.blackFideId, game.blackName)) {
		result = { ...result, blackName: RETIRED_NAME, blackFideId: null, pgn: anonymizePgn(result.pgn, 'Black') }
	}
	return result
}

/**
 * La partida sin el año de homónimo de quien ha pedido ocultarlo, en la
 * columna y en la cabecera del PGN; la misma si no juega ninguno.
 */
export function withoutHiddenYears<T extends GamePlayers>(game: T, hidden: HiddenYears): T {
	let result = game
	const whiteName = withoutHiddenYear(hidden, game.whiteFideId, game.whiteName)
	if (whiteName !== game.whiteName) result = { ...result, whiteName, pgn: setPgnTags(result.pgn, { White: whiteName }) }
	const blackName = withoutHiddenYear(hidden, game.blackFideId, game.blackName)
	if (blackName !== game.blackName) result = { ...result, blackName, pgn: setPgnTags(result.pgn, { Black: blackName }) }
	return result
}

/** Da por revisadas las partidas del torneo sin tocarlas (la fuente no respondió, o la lectura no se guardó). */
export async function markGamesChecked(db: D1Database, tournamentId: number, checkedAt: string): Promise<void> {
	await db.prepare('UPDATE tournaments SET games_checked_at = ?2 WHERE id = ?1').bind(tournamentId, checkedAt).run()
}

export interface StoredGame {
	id: number
	tournamentId: number
	whiteName: string
	blackName: string
	pgn: string
	/** Ritmo del torneo, del que se deriva el de la partida. */
	timeControl: string | null
}

/** Partidas con id mayor que `after`, en orden de id (lotes del reprocesado). */
export async function loadGamesForReprocess(db: D1Database, after: number, limit: number): Promise<StoredGame[]> {
	const { results } = await db
		.prepare(
			`SELECT g.id, g.tournament_id AS tournamentId, g.white_name AS whiteName, g.black_name AS blackName, g.pgn,
				t.time_control AS timeControl
			FROM games g JOIN tournaments t ON t.id = g.tournament_id
			WHERE g.id > ?1 ORDER BY g.id LIMIT ?2`
		)
		.bind(after, limit)
		.all<StoredGame>()
	return results
}

/**
 * Cambia los nombres de las partidas indicadas, en las columnas y en el PGN.
 * El índice FTS sigue a las columnas por su trigger (games_au). Sin recuento:
 * meta.changes suma también las escrituras del trigger.
 */
export async function renameGames(
	db: D1Database,
	rows: { id: number; whiteName: string; blackName: string; pgn: string }[]
): Promise<void> {
	if (rows.length === 0) return
	await db.batch(
		chunkByJsonSize(rows).map((json) =>
			db
				.prepare(
					`UPDATE games SET
						white_name = json_extract(j.value, '$.whiteName'),
						black_name = json_extract(j.value, '$.blackName'),
						pgn = json_extract(j.value, '$.pgn')
					FROM json_each(?1) AS j
					WHERE games.id = json_extract(j.value, '$.id')
						AND (games.white_name IS NOT json_extract(j.value, '$.whiteName')
							OR games.black_name IS NOT json_extract(j.value, '$.blackName')
							OR games.pgn IS NOT json_extract(j.value, '$.pgn'))`
				)
				.bind(json)
		)
	)
}

/** Nombre de un participante, con la clave de su fila. */
export interface StoredParticipation {
	tournamentId: number
	team: string
	startRank: number
	name: string
	fideId: number | null
}

/**
 * Participantes cuyo nombre lleva un año de homónimo («…, Nombre 2009», «…,
 * Nombre 2009 I»). Recorre la tabla entera: sólo lo usa el reprocesado.
 */
export async function loadHomonymParticipations(db: D1Database): Promise<StoredParticipation[]> {
	const { results } = await db
		.prepare(
			`SELECT tournament_id AS tournamentId, team, start_rank AS startRank, name, fide_id AS fideId FROM participations
			WHERE name GLOB '*,* [0-9][0-9][0-9][0-9]' OR name GLOB '*,* [0-9][0-9][0-9][0-9] *'`
		)
		.all<StoredParticipation>()
	return results
}

/** Cambia el nombre de esos participantes (y su forma canónica). */
export async function renameParticipations(db: D1Database, rows: StoredParticipation[]): Promise<void> {
	if (rows.length === 0) return
	const withNorm = rows.map((r) => ({ ...r, nameNorm: normalizeName(r.name) }))
	await db.batch(
		chunkByJsonSize(withNorm).map((json) =>
			db
				.prepare(
					`UPDATE participations SET
						name = json_extract(j.value, '$.name'),
						name_norm = json_extract(j.value, '$.nameNorm')
					FROM json_each(?1) AS j
					WHERE participations.tournament_id = json_extract(j.value, '$.tournamentId')
						AND participations.team = json_extract(j.value, '$.team')
						AND participations.start_rank = json_extract(j.value, '$.startRank')
						AND participations.name IS NOT json_extract(j.value, '$.name')`
				)
				.bind(json)
		)
	)
}

/** Nombres de un emparejamiento, con la clave de su fila. */
export interface StoredPairing {
	tournamentId: number
	board: number
	whiteName: string
	blackName: string
}

/** Todos los emparejamientos guardados: son los de la próxima ronda, unos cientos. */
export async function loadPairingNames(db: D1Database): Promise<StoredPairing[]> {
	const { results } = await db
		.prepare(
			`SELECT tournament_id AS tournamentId, board, white_name AS whiteName, black_name AS blackName FROM pairings`
		)
		.all<StoredPairing>()
	return results
}

/** Cambia los nombres de esos emparejamientos. */
export async function renamePairings(db: D1Database, rows: StoredPairing[]): Promise<void> {
	if (rows.length === 0) return
	await db.batch(
		chunkByJsonSize(rows).map((json) =>
			db
				.prepare(
					`UPDATE pairings SET
						white_name = json_extract(j.value, '$.whiteName'),
						black_name = json_extract(j.value, '$.blackName')
					FROM json_each(?1) AS j
					WHERE pairings.tournament_id = json_extract(j.value, '$.tournamentId')
						AND pairings.board = json_extract(j.value, '$.board')
						AND (pairings.white_name IS NOT json_extract(j.value, '$.whiteName')
							OR pairings.black_name IS NOT json_extract(j.value, '$.blackName'))`
				)
				.bind(json)
		)
	)
}

// --- Retirada de datos: lo ya guardado (lo aplica reprocess.ts) ---

/** Borra de players a los retirados: sin fila no tienen ficha. Devuelve cuántos había. */
export async function deleteRetiredPlayers(db: D1Database): Promise<number> {
	// Sin recuento por meta.changes: suma también las escrituras del trigger del FTS.
	const { results } = await db.prepare('SELECT fide_id FROM players WHERE fide_id IN (SELECT fide_id FROM retiradas)').all()
	if (results.length > 0) await db.prepare('DELETE FROM players WHERE fide_id IN (SELECT fide_id FROM retiradas)').run()
	return results.length
}

/**
 * Anonimiza a los retirados en los participantes guardados: por FIDE ID y,
 * sin él, por `nameNorms` (las formas canónicas de sus nombres). Lo segundo
 * recorre la tabla entera: sólo lo usa el reprocesado. Devuelve cuántos cambian.
 */
export async function anonymizeRetiredParticipations(db: D1Database, nameNorms: string[]): Promise<number> {
	const [byId, byName] = await db.batch([
		db
			.prepare(
				`UPDATE participations SET name = ?1, name_norm = ?2, fide_id = NULL, title = NULL
				WHERE fide_id IN (SELECT fide_id FROM retiradas)`
			)
			.bind(RETIRED_NAME, normalizeName(RETIRED_NAME)),
		db
			.prepare(
				`UPDATE participations SET name = ?1, name_norm = ?2, title = NULL
				WHERE fide_id IS NULL AND name_norm IN (SELECT value FROM json_each(?3))`
			)
			.bind(RETIRED_NAME, normalizeName(RETIRED_NAME), JSON.stringify(nameNorms))
	])
	return byId.meta.changes + byName.meta.changes
}

/** Jugadores de una partida guardada, con su id. */
export interface StoredGamePlayers {
	id: number
	whiteName: string
	blackName: string
	whiteFideId: number | null
	blackFideId: number | null
	pgn: string
}

const GAME_PLAYERS = `id, white_name AS whiteName, black_name AS blackName,
	white_fide_id AS whiteFideId, black_fide_id AS blackFideId, pgn`

/**
 * Partidas en las que puede jugar alguien (un retirado, quien ha ocultado su
 * año): por sus FIDE ID (índices games_white y games_black) y, sin él, por las
 * palabras de su nombre en el FTS (`matches`, una consulta MATCH por persona).
 * Quién lo es de verdad lo decide quien llama (isRetired, withoutHiddenYear);
 * aquí sólo se buscan candidatas, sin repetir.
 */
export async function loadGameCandidates(
	db: D1Database,
	fideIds: number[],
	matches: string[]
): Promise<StoredGamePlayers[]> {
	const results = await db.batch<StoredGamePlayers>([
		db
			.prepare(
				`SELECT ${GAME_PLAYERS} FROM games WHERE white_fide_id IN (SELECT value FROM json_each(?1))
				UNION SELECT ${GAME_PLAYERS} FROM games WHERE black_fide_id IN (SELECT value FROM json_each(?1))`
			)
			.bind(JSON.stringify(fideIds)),
		...matches.map((match) =>
			db
				.prepare(
					`SELECT ${GAME_PLAYERS} FROM games
					WHERE id IN (SELECT rowid FROM games_fts WHERE games_fts MATCH ?1)
						AND (white_fide_id IS NULL OR black_fide_id IS NULL)`
				)
				.bind(match)
		)
	])
	const byId = new Map(results.flatMap((r) => r.results).map((g) => [g.id, g]))
	return [...byId.values()]
}

/**
 * Cambia los jugadores de las partidas indicadas: nombres, FIDE ID y PGN. El
 * índice FTS sigue a los nombres por su trigger (games_au).
 */
export async function updateGamePlayers(db: D1Database, rows: StoredGamePlayers[]): Promise<void> {
	if (rows.length === 0) return
	await db.batch(
		chunkByJsonSize(rows).map((json) =>
			db
				.prepare(
					`UPDATE games SET
						white_name = json_extract(j.value, '$.whiteName'),
						black_name = json_extract(j.value, '$.blackName'),
						white_fide_id = json_extract(j.value, '$.whiteFideId'),
						black_fide_id = json_extract(j.value, '$.blackFideId'),
						pgn = json_extract(j.value, '$.pgn')
					FROM json_each(?1) AS j
					WHERE games.id = json_extract(j.value, '$.id')`
				)
				.bind(json)
		)
	)
}

/** Jugadores de un emparejamiento guardado, con la clave de su fila. */
export interface StoredPairingPlayers {
	tournamentId: number
	board: number
	whiteName: string
	blackName: string
	whiteFideId: number | null
	blackFideId: number | null
	whiteTitle: string | null
	blackTitle: string | null
}

/** Todos los emparejamientos guardados, con sus jugadores: son unos cientos. */
export async function loadPairingPlayers(db: D1Database): Promise<StoredPairingPlayers[]> {
	const { results } = await db
		.prepare(
			`SELECT tournament_id AS tournamentId, board, white_name AS whiteName, black_name AS blackName,
				white_fide_id AS whiteFideId, black_fide_id AS blackFideId, white_title AS whiteTitle, black_title AS blackTitle
			FROM pairings`
		)
		.all<StoredPairingPlayers>()
	return results
}

/** Cambia los jugadores de esos emparejamientos: nombres, FIDE ID y títulos. */
export async function updatePairingPlayers(db: D1Database, rows: StoredPairingPlayers[]): Promise<void> {
	if (rows.length === 0) return
	await db.batch(
		chunkByJsonSize(rows).map((json) =>
			db
				.prepare(
					`UPDATE pairings SET
						white_name = json_extract(j.value, '$.whiteName'),
						black_name = json_extract(j.value, '$.blackName'),
						white_fide_id = json_extract(j.value, '$.whiteFideId'),
						black_fide_id = json_extract(j.value, '$.blackFideId'),
						white_title = json_extract(j.value, '$.whiteTitle'),
						black_title = json_extract(j.value, '$.blackTitle')
					FROM json_each(?1) AS j
					WHERE pairings.tournament_id = json_extract(j.value, '$.tournamentId')
						AND pairings.board = json_extract(j.value, '$.board')`
				)
				.bind(json)
		)
	)
}

// --- Ocultar el sexo o el año: lo ya guardado (lo aplica reprocess.ts) ---

/**
 * Aplica la tabla ocultaciones a los jugadores guardados, como la importación
 * FIDE al escribir: el sexo pasa a NULL y el año se marca (el del nombre, en
 * applyHidden). Sólo cambia los que aún no lo tienen aplicado. Volver a
 * enseñarlos (si se borra una fila) es cosa de la importación siguiente: el
 * sexo sólo está en la lista.
 */
export async function applyHiddenFields(db: D1Database): Promise<{ sex: number; birthYear: number }> {
	const [sex, birthYear] = await db.batch([
		db.prepare(
			`UPDATE players SET sex = NULL
			WHERE fide_id IN (SELECT fide_id FROM ocultaciones WHERE campo = 'sexo') AND sex IS NOT NULL`
		),
		db.prepare(
			`UPDATE players SET birth_year_hidden = 1
			WHERE fide_id IN (SELECT fide_id FROM ocultaciones WHERE campo = 'anio') AND birth_year_hidden = 0`
		)
	])
	return { sex: sex.meta.changes, birthYear: birthYear.meta.changes }
}

/** Nombre de la ficha de un jugador. */
export interface StoredPlayerName {
	fideId: number
	name: string
}

/** Nombres de quien ha pedido ocultar su año: unos pocos, por la clave primaria. */
export async function loadHiddenYearPlayers(db: D1Database): Promise<StoredPlayerName[]> {
	const { results } = await db
		.prepare(
			`SELECT fide_id AS fideId, name FROM players
			WHERE fide_id IN (SELECT fide_id FROM ocultaciones WHERE campo = 'anio')`
		)
		.all<StoredPlayerName>()
	return results
}

/** Cambia el nombre de esas fichas. El índice FTS lo sigue por su trigger (players_au). */
export async function renamePlayers(db: D1Database, rows: StoredPlayerName[]): Promise<void> {
	if (rows.length === 0) return
	await db
		.prepare(
			`UPDATE players SET name = json_extract(j.value, '$.name')
			FROM json_each(?1) AS j
			WHERE players.fide_id = json_extract(j.value, '$.fideId') AND players.name IS NOT json_extract(j.value, '$.name')`
		)
		.bind(JSON.stringify(rows))
		.run()
}

// --- Torneos sensibles (tabla torneos_sensibles, migración 0012) ---

/** Claves de los torneos de esa fuente que no se guardan (excluido = 1). La tabla es pequeña. */
export async function loadExcluded(db: D1Database, source: string): Promise<Set<string>> {
	const { results } = await db
		.prepare('SELECT source_key AS key FROM torneos_sensibles WHERE source = ?1 AND excluido = 1')
		.bind(source)
		.all<{ key: string }>()
	return new Set(results.map((r) => r.key))
}

/** Torneo que parece sensible, para apuntarlo. */
export interface SensitiveCandidate {
	source: string
	key: string
	name: string
}

/**
 * Apunta esos torneos para revisarlos, sin decidir (excluido NULL). Uno ya
 * apuntado o revisado no cambia. Devuelve cuántos son nuevos.
 */
export async function proposeSensitive(db: D1Database, tournaments: SensitiveCandidate[]): Promise<number> {
	if (tournaments.length === 0) return 0
	const now = new Date().toISOString()
	const results = await db.batch(
		chunkByJsonSize(tournaments).map((json) =>
			db
				.prepare(
					`INSERT INTO torneos_sensibles (source, source_key, nombre, creado)
					SELECT json_extract(value, '$.source'), json_extract(value, '$.key'), json_extract(value, '$.name'), ?1
					FROM json_each(?2)
					WHERE true
					ON CONFLICT DO NOTHING`
				)
				.bind(now, json)
		)
	)
	return results.reduce((n, r) => n + r.meta.changes, 0)
}

const EXCLUDED_IDS = `SELECT t.id FROM torneos_sensibles s
	JOIN tournaments t ON t.source = s.source AND t.source_key = s.source_key
	WHERE s.excluido = 1`

/** Retransmisión de lichess, por su id de torneo, con un nombre para torneos_sensibles. */
export interface BroadcastKey {
	key: string
	name: string
}

/** Retransmisiones de lichess de los torneos marcados (excluido = 1) que aún están guardados. */
export interface ExcludedBroadcasts {
	/** Las que la pasada de lichess ha decidido de uno de ellos (lichess_tours): enlazadas, duplicadas o el propio. */
	tours: BroadcastKey[]
	/** Los enlaces de info64 de los que salen sus partidas (games_source_url), de torneo o de ronda. */
	links: { url: string; name: string }[]
}

export async function loadExcludedBroadcasts(db: D1Database): Promise<ExcludedBroadcasts> {
	const { results: tours } = await db
		.prepare(`SELECT tour_id AS key, name FROM lichess_tours WHERE tournament_id IN (${EXCLUDED_IDS})`)
		.all<BroadcastKey>()
	const { results: links } = await db
		.prepare(
			`SELECT games_source_url AS url, name FROM tournaments
			WHERE games_source = 'lichess' AND games_source_url IS NOT NULL AND id IN (${EXCLUDED_IDS})`
		)
		.all<{ url: string; name: string }>()
	return { tours, links }
}

/**
 * Marca esas retransmisiones de lichess como no guardables (excluido = 1).
 * Una ya revisada como guardable (excluido = 0) no cambia. Devuelve cuántas
 * cambian.
 */
export async function excludeBroadcasts(db: D1Database, broadcasts: BroadcastKey[]): Promise<number> {
	if (broadcasts.length === 0) return 0
	const now = new Date().toISOString()
	const results = await db.batch(
		chunkByJsonSize(broadcasts).map((json) =>
			db
				.prepare(
					`INSERT INTO torneos_sensibles (source, source_key, nombre, excluido, creado)
					SELECT 'lichess', json_extract(value, '$.key'), json_extract(value, '$.name'), 1, ?1
					FROM json_each(?2)
					WHERE true
					ON CONFLICT (source, source_key) DO UPDATE SET excluido = 1 WHERE torneos_sensibles.excluido IS NULL`
				)
				.bind(now, json)
		)
	)
	return results.reduce((n, r) => n + r.meta.changes, 0)
}

/**
 * Borra los torneos guardados que no se guardan (excluido = 1). Sus partidas,
 * participantes, emparejamientos y clasificación se van en cascada, y las
 * retransmisiones de lichess que lo enlazaban se quedan sin torneo (lichess_tours).
 * Devuelve cuántos había.
 */
export async function deleteExcludedTournaments(db: D1Database): Promise<number> {
	// Sin recuento por meta.changes: suma también las cascadas y los triggers del FTS.
	const { results } = await db.prepare(EXCLUDED_IDS).all()
	if (results.length > 0) await db.prepare(`DELETE FROM tournaments WHERE id IN (${EXCLUDED_IDS})`).run()
	return results.length
}

/** Torneos por sentencia en deleteTournaments: unos 4.000 participantes y 400 partidas en cascada. */
const TOURNAMENTS_PER_DELETE = 100

/**
 * Borra esos torneos, con sus partidas, participantes, emparejamientos y
 * clasificación en cascada, de TOURNAMENTS_PER_DELETE en TOURNAMENTS_PER_DELETE:
 * miles a la vez serían una sola transacción enorme. Cada trozo es una
 * sentencia aparte, así que un reintento sólo repite los que quedan.
 */
export async function deleteTournaments(db: D1Database, ids: number[], size = TOURNAMENTS_PER_DELETE): Promise<void> {
	for (let i = 0; i < ids.length; i += size) {
		await db
			.prepare('DELETE FROM tournaments WHERE id IN (SELECT value FROM json_each(?1))')
			.bind(JSON.stringify(ids.slice(i, i + size)))
			.run()
	}
}

/**
 * Guarda las columnas derivadas de las partidas indicadas. Las que no cambian
 * no se reescriben (ni se facturan como filas escritas); devuelve cuántas cambian.
 */
export async function updateDerivedColumns(db: D1Database, rows: ({ id: number } & DerivedColumns)[]): Promise<number> {
	const results = await db.batch(
		chunkByJsonSize(rows).map((json) =>
			db
				.prepare(
					`UPDATE games SET
						opening_moves = json_extract(j.value, '$.openingMoves'),
						time_class = json_extract(j.value, '$.timeClass'),
						clocks = json_extract(j.value, '$.clocks')
					FROM json_each(?1) AS j
					WHERE games.id = json_extract(j.value, '$.id')
						AND (games.opening_moves IS NOT json_extract(j.value, '$.openingMoves')
							OR games.time_class IS NOT json_extract(j.value, '$.timeClass')
							OR games.clocks IS NOT json_extract(j.value, '$.clocks'))`
				)
				.bind(json)
		)
	)
	return results.reduce((n, r) => n + r.meta.changes, 0)
}

/**
 * Guarda las partidas de lichess de cada torneo (lichess_games), contadas en
 * todas las partidas guardadas: `counts` son pares [id del torneo, partidas]
 * y los torneos que no salen se quedan en 0. Como updateDerivedColumns, sólo
 * reescribe los que cambian; devuelve cuántos. Recorre la tabla de torneos.
 */
export async function saveLichessGames(db: D1Database, counts: [number, number][]): Promise<number> {
	const json = JSON.stringify(counts)
	const results = await db.batch([
		db
			.prepare(
				`UPDATE tournaments SET lichess_games = 0
				WHERE lichess_games <> 0 AND id NOT IN (SELECT json_extract(value, '$[0]') FROM json_each(?1))`
			)
			.bind(json),
		db
			.prepare(
				`UPDATE tournaments SET lichess_games = json_extract(j.value, '$[1]')
				FROM json_each(?1) AS j
				WHERE tournaments.id = json_extract(j.value, '$[0]')
					AND tournaments.lichess_games <> json_extract(j.value, '$[1]')`
			)
			.bind(json)
	])
	return results.reduce((n, r) => n + r.meta.changes, 0)
}

/** Si el jugador de la fila de json_each ha pedido ocultar `campo` (tabla ocultaciones). */
const hidden = (campo: 'sexo' | 'anio') =>
	`EXISTS (SELECT 1 FROM ocultaciones o WHERE o.fide_id = json_extract(value, '$.fideId') AND o.campo = '${campo}')`

/**
 * Las filas de upsertFidePlayers en el año `year`, de una en una, sin los
 * retirados. Los homónimos que aún llevan el año en el nombre traen también
 * el nombre sin él (bareName), por si lo han ocultado: unos 900 de 98.000.
 */
function* fideRows(players: FidePlayer[], year: number, retired: Retired) {
	for (const p of players) {
		if (retired.ids.has(p.fideId)) continue
		const name = publicName(p.name, year)
		const bareName = withoutHomonymYear(name)
		yield { ...p, name, ...(bareName === name ? {} : { bareName }), inactive: p.inactive ? 1 : 0 }
	}
}

/**
 * Guarda los jugadores de la lista FIDE del mes `period` ('YYYY-MM'). Si su
 * ELO venía de la lista de otro mes, el que tenían pasa a rating_std_prev; si
 * ya venía de ésta (un reintento, un force en el mismo mes), se conserva.
 * Los SET leen la fila de antes del UPDATE. A los homónimos que pueden ser
 * menores se les quita el año del nombre (publicName); lo recuperan en la
 * primera lista del año en que dejan de serlo. Los retirados no se guardan:
 * sin fila en players no tienen ficha, y la importación borra la que tuvieran.
 * A quien ha pedido ocultar el sexo o el año (tabla ocultaciones) se le guarda
 * el sexo NULL, y el año marcado en birth_year_hidden y fuera del nombre si es
 * un homónimo. Se mira en el SQL, por el índice único de la tabla, para no
 * cargar nada más en memoria: casi nadie está, y una búsqueda que no encuentra
 * nada no suma filas leídas.
 */
export async function upsertFidePlayers(
	db: D1Database,
	players: FidePlayer[],
	period: string,
	seenAt: string
): Promise<void> {
	const retired = await loadRetired(db)
	// Sentencias sueltas y no un batch: un batch entero tiene 30 s como máximo.
	// Fila a fila y lote a lote: la lista entera en JSON pasa de 16 MB.
	for (const json of jsonChunks(fideRows(players, Number(period.slice(0, 4)), retired))) {
		await db
			.prepare(
				`INSERT INTO players (fide_id, name, sex, title, birth_year, birth_year_hidden, rating_std, rating_rapid, rating_blitz,
					inactive, seen_at, rating_list)
				SELECT json_extract(value, '$.fideId'),
					CASE WHEN json_extract(value, '$.bareName') IS NOT NULL AND ${hidden('anio')}
						THEN json_extract(value, '$.bareName') ELSE json_extract(value, '$.name') END,
					CASE WHEN ${hidden('sexo')} THEN NULL ELSE json_extract(value, '$.sex') END,
					json_extract(value, '$.title'),
					json_extract(value, '$.birthYear'),
					${hidden('anio')},
					json_extract(value, '$.ratingStd'),
					json_extract(value, '$.ratingRapid'),
					json_extract(value, '$.ratingBlitz'),
					json_extract(value, '$.inactive'),
					?1,
					?2
				FROM json_each(?3)
				WHERE true
				ON CONFLICT (fide_id) DO UPDATE SET
					name = excluded.name,
					sex = excluded.sex,
					title = excluded.title,
					birth_year = excluded.birth_year,
					birth_year_hidden = excluded.birth_year_hidden,
					rating_std_prev = CASE WHEN players.rating_list IS NOT excluded.rating_list
						THEN players.rating_std ELSE players.rating_std_prev END,
					rating_std = excluded.rating_std,
					rating_rapid = excluded.rating_rapid,
					rating_blitz = excluded.rating_blitz,
					inactive = excluded.inactive,
					seen_at = excluded.seen_at,
					rating_list = excluded.rating_list`
			)
			.bind(seenAt, period, json)
			.run()
	}
}

/**
 * Recalcula los totales de la portada. Recorre las tablas enteras, así que se
 * hace una vez al final de cada sincronización y no en cada visita.
 */
export async function refreshTotals(db: D1Database): Promise<void> {
	await db
		.prepare(
			`INSERT INTO site_totals (id, players, games, tournaments, updated_at)
			VALUES (1,
				(SELECT count(*) FROM players),
				(SELECT count(*) FROM games),
				(SELECT count(*) FROM tournaments),
				?1)
			ON CONFLICT (id) DO UPDATE SET
				players = excluded.players,
				games = excluded.games,
				tournaments = excluded.tournaments,
				updated_at = excluded.updated_at`
		)
		.bind(new Date().toISOString())
		.run()
}

/**
 * Sustituye los emparejamientos guardados del torneo por los de esta ronda.
 * Nombre, título, FIDE ID y ELO salen del participante con ese número del
 * ranking inicial, ya rectificado (rectificaciones.ts); si no lo hay, se queda
 * lo que trae la página de la ronda, con el nombre sin el año de los menores
 * ni el de quien ha pedido ocultarlo.
 * Si la ronda aún no está emparejada (sin filas), se borran los de otras
 * rondas y se conservan los de ésta: una página que vuelve vacía no los quita.
 */
export async function replacePairings(
	db: D1Database,
	tournamentId: number,
	round: number,
	startsAt: string | null,
	pairings: Pairing[]
): Promise<void> {
	if (pairings.length === 0) {
		await db.prepare('DELETE FROM pairings WHERE tournament_id = ?1 AND round <> ?2').bind(tournamentId, round).run()
		return
	}
	const year = madridYear(new Date())
	const retired = await loadRetired(db)
	const hiddenYears = await loadHiddenYears(db)
	// El nombre de la página sólo se usa si no hay participante con ese número;
	// el del participante ya está anonimizado si es un retirado, y sin el año
	// si lo ha ocultado. La página no da el FIDE ID: va por el nombre.
	const side = (p: PairedPlayer): PairedPlayer => ({
		...p,
		name: isRetired(retired, null, p.name) ? RETIRED_NAME : withoutHiddenYear(hiddenYears, null, publicName(p.name, year))
	})
	const rows = pairings.map((p) => ({ ...p, white: side(p.white), black: side(p.black) }))
	await db.batch([
		db.prepare('DELETE FROM pairings WHERE tournament_id = ?1').bind(tournamentId),
		...chunkByJsonSize(rows).map((json) =>
			db
				.prepare(
					`INSERT INTO pairings (tournament_id, round, board, starts_at,
						white_rank, white_name, white_title, white_fide_id, white_rating,
						black_rank, black_name, black_title, black_fide_id, black_rating)
					SELECT ?1, ?2, json_extract(j.value, '$.board'), ?3,
						json_extract(j.value, '$.white.startRank'),
						coalesce(w.name, json_extract(j.value, '$.white.name')),
						w.title, w.fide_id,
						coalesce(w.rating, json_extract(j.value, '$.white.rating')),
						json_extract(j.value, '$.black.startRank'),
						coalesce(b.name, json_extract(j.value, '$.black.name')),
						b.title, b.fide_id,
						coalesce(b.rating, json_extract(j.value, '$.black.rating'))
					FROM json_each(?4) AS j
					LEFT JOIN participations w ON w.tournament_id = ?1 AND w.team = ''
						AND w.start_rank = json_extract(j.value, '$.white.startRank')
					LEFT JOIN participations b ON b.tournament_id = ?1 AND b.team = ''
						AND b.start_rank = json_extract(j.value, '$.black.startRank')
					WHERE true
					ON CONFLICT DO NOTHING`
				)
				.bind(tournamentId, round, startsAt, json)
		)
	])
}

/** Borra los emparejamientos de las rondas que ya han empezado (`now` en hora local). */
export async function deletePastPairings(db: D1Database, now: string): Promise<void> {
	await db.prepare('DELETE FROM pairings WHERE starts_at IS NULL OR starts_at <= ?1').bind(now).run()
}

/** id de los torneos indicados que ya están guardados. */
export async function loadTournamentIds(db: D1Database, source: string, keys: string[]): Promise<Record<string, number>> {
	if (keys.length === 0) return {}
	const { results } = await db
		.prepare(
			`SELECT source_key AS key, id FROM tournaments
			WHERE source = ?1 AND source_key IN (SELECT value FROM json_each(?2))`
		)
		.bind(source, JSON.stringify(keys))
		.all<{ key: string; id: number }>()
	return Object.fromEntries(results.map((r) => [r.key, r.id]))
}

/**
 * Torneos guardados de la fuente que empiezan entre from y to (ambos
 * incluidos), sin los que aún no han empezado el día `today`.
 */
export async function loadTournamentsStarting(
	db: D1Database,
	source: string,
	from: string,
	to: string,
	today: string
): Promise<{ key: string; id: number; type: TournamentType }[]> {
	const { results } = await db
		.prepare(
			`SELECT source_key AS key, id, type FROM tournaments
			WHERE start_date BETWEEN ?2 AND ?3 AND start_date <= ?4 AND source = ?1
			ORDER BY start_date, id`
		)
		.bind(source, from, to, today)
		.all<{ key: string; id: number; type: TournamentType }>()
	return results
}

export interface CheckedTournament {
	key: string
	endDate: string | null
	gamesCheckedAt: string | null
}

/** Estado de sincronización de los torneos indicados (los que no existen no aparecen). */
export async function loadCheckedTournaments(
	db: D1Database,
	source: string,
	keys: string[]
): Promise<CheckedTournament[]> {
	if (keys.length === 0) return []
	const { results } = await db
		.prepare(
			`SELECT source_key AS key, end_date AS endDate, games_checked_at AS gamesCheckedAt
			FROM tournaments
			WHERE source = ?1 AND source_key IN (SELECT value FROM json_each(?2))`
		)
		.bind(source, JSON.stringify(keys))
		.all<CheckedTournament>()
	return results
}

export async function loadSyncState(db: D1Database, key: string): Promise<string | null> {
	const row = await db.prepare('SELECT value FROM sync_state WHERE key = ?1').bind(key).first<{ value: string }>()
	return row?.value ?? null
}

export async function saveSyncState(db: D1Database, key: string, value: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO sync_state (key, value, updated_at) VALUES (?1, ?2, ?3)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
		)
		.bind(key, value, new Date().toISOString())
		.run()
}

// --- Retransmisiones de lichess (lichess/sync.ts) ---

export type LichessTourStatus = 'sin_espanoles' | 'duplicado' | 'enlazado' | 'propio'

/** Lo decidido de una retransmisión (tabla lichess_tours). */
export interface LichessTour {
	tourId: string
	name: string
	url: string | null
	status: LichessTourStatus
	tournamentId: number | null
	espPlayers: number
	finished: boolean
}

export async function loadLichessTours(db: D1Database, tourIds: string[]): Promise<LichessTour[]> {
	if (tourIds.length === 0) return []
	const { results } = await db
		.prepare(
			`SELECT tour_id AS tourId, name, url, status, tournament_id AS tournamentId, esp_players AS espPlayers, finished
			FROM lichess_tours WHERE tour_id IN (SELECT value FROM json_each(?1))`
		)
		.bind(JSON.stringify(tourIds))
		.all<Omit<LichessTour, 'finished'> & { finished: number }>()
	return results.map((r) => ({ ...r, finished: r.finished === 1 }))
}

export async function saveLichessTour(db: D1Database, tour: LichessTour, checkedAt: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO lichess_tours (tour_id, name, url, status, tournament_id, esp_players, finished, checked_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
			ON CONFLICT (tour_id) DO UPDATE SET
				name = excluded.name,
				url = excluded.url,
				status = excluded.status,
				tournament_id = excluded.tournament_id,
				esp_players = excluded.esp_players,
				finished = excluded.finished,
				checked_at = excluded.checked_at`
		)
		.bind(
			tour.tourId,
			tour.name,
			tour.url,
			tour.status,
			tour.tournamentId,
			tour.espPlayers,
			Number(tour.finished),
			checkedAt
		)
		.run()
}

/** Retransmisiones de lichess que la sincronización de lichess ha enlazado a este torneo de info64. */
export async function loadLinkedBroadcasts(db: D1Database, tournamentId: number): Promise<string[]> {
	const { results } = await db
		.prepare(`SELECT url FROM lichess_tours
			WHERE tournament_id = ?1 AND status = 'enlazado' AND url IS NOT NULL ORDER BY tour_id`)
		.bind(tournamentId)
		.all<{ url: string }>()
	return results.map((r) => r.url)
}

/** De esos FIDE ID, los de jugadores españoles (los de la tabla players). */
export async function spanishFideIds(db: D1Database, fideIds: number[]): Promise<number[]> {
	if (fideIds.length === 0) return []
	const { results } = await db
		.prepare('SELECT fide_id AS fideId FROM players WHERE fide_id IN (SELECT value FROM json_each(?1))')
		.bind(JSON.stringify(fideIds))
		.all<{ fideId: number }>()
	return results.map((r) => r.fideId)
}

/** Torneo de info64 candidato a ser el de una retransmisión. */
export interface Info64Match {
	id: number
	/** Cuántos de los jugadores buscados están entre sus participantes. */
	overlap: number
	gamesSource: string | null
	gamesSourceUrl: string | null
}

/**
 * Torneo de info64 que se juega entre esas fechas (YYYY-MM-DD) con más de
 * esos jugadores entre sus participantes. Parte de las participaciones de esos
 * jugadores (índice participations_fide_id) y busca cada torneo por su id: el
 * CROSS JOIN fija ese orden, porque si no SQLite empieza por los doce mil
 * torneos de info64 (índice de source).
 */
export async function findInfo64Tournament(
	db: D1Database,
	fideIds: number[],
	from: string,
	to: string
): Promise<Info64Match | null> {
	if (fideIds.length === 0) return null
	return db
		.prepare(
			`SELECT t.id, m.overlap, t.games_source AS gamesSource, t.games_source_url AS gamesSourceUrl
			FROM (
				SELECT tournament_id, count(DISTINCT fide_id) AS overlap
				FROM participations
				WHERE fide_id IN (SELECT value FROM json_each(?1))
				GROUP BY tournament_id
			) AS m
			CROSS JOIN tournaments t ON t.id = m.tournament_id
			WHERE t.source = 'info64' AND t.start_date <= ?3 AND t.end_date >= ?2
			ORDER BY m.overlap DESC, t.id
			LIMIT 1`
		)
		.bind(JSON.stringify(fideIds), from, to)
		.first<Info64Match>()
}

/** Partida que se quiere guardar, para buscarla en otros torneos. */
export interface GameKey {
	white: number
	black: number
	date: string
}

/**
 * Índices (en `games`) de las partidas que ya están en otro torneo: los
 * mismos FIDE ID con los mismos colores y fechas a 3 días o menos. Busca por
 * el índice games_white.
 */
export async function gamesStoredElsewhere(
	db: D1Database,
	tournamentId: number | null,
	games: GameKey[]
): Promise<Set<number>> {
	if (games.length === 0) return new Set()
	const { results } = await db
		.prepare(
			`SELECT DISTINCT CAST(j.key AS INTEGER) AS i
			FROM json_each(?2) AS j
			JOIN games g ON g.white_fide_id = json_extract(j.value, '$.white')
				AND g.black_fide_id = json_extract(j.value, '$.black')
				AND g.date BETWEEN date(json_extract(j.value, '$.date'), '-3 days')
					AND date(json_extract(j.value, '$.date'), '+3 days')
			WHERE g.tournament_id IS NOT ?1`
		)
		.bind(tournamentId, JSON.stringify(games))
		.all<{ i: number }>()
	return new Set(results.map((r) => r.i))
}

/** Lo que buildGameRows necesita de un torneo guardado. */
export async function loadTournamentContext(db: D1Database, id: number): Promise<TournamentContext | null> {
	return db
		.prepare('SELECT name, city, start_date AS startDate, time_control AS timeControl FROM tournaments WHERE id = ?1')
		.bind(id)
		.first<TournamentContext>()
}

/** Borra un torneo propio de lichess; sus partidas y participantes se van en cascada. */
export async function deleteLichessTournament(db: D1Database, id: number): Promise<void> {
	await db.prepare(`DELETE FROM tournaments WHERE id = ?1 AND source = 'lichess'`).bind(id).run()
}
