// Rectificación y limitación de datos (tabla rectificaciones, migración 0014).
//
// Cada fila corrige, o deja vacío mientras se comprueba, un dato de una persona
// en un torneo: su FIDE ID, su nombre, su título o su ELO en todo el torneo o
// en una ronda; el resultado de su partida de una ronda, o que esa partida no
// se guarde. Se aplica al escribir (repo.ts), después de quitar el año de los
// menores y antes de la retirada, así que las siguientes lecturas de la fuente
// la respetan.
//
// A la persona se la busca tal como la lee la ingesta de la fuente, antes de
// rectificar: así una fila que le cambia el FIDE ID no impide que casen las
// demás suyas. Por eso se aplica releyendo el torneo y no sobre lo guardado,
// que ya está rectificado.
import { setPgnResult, setPgnTags, type GameResult } from '../lib/chess/pgn'
import { nameKey, publicName } from './nombres'

export type RectifiedField = 'fide_id' | 'nombre' | 'titulo' | 'elo' | 'resultado' | 'oculta'

/** Una fila de la tabla: a quién (como lo lee la ingesta de la fuente) y qué cambia. */
export interface Rectification {
	id: number
	fideId: number | null
	name: string | null
	/** null: todo el torneo; si no, sólo su partida de esa ronda. */
	round: number | null
	field: RectifiedField
	/** El valor nuevo, como texto; null lo deja vacío. */
	value: string | null
}

/** Un jugador, con lo que lo identifica: su FIDE ID y su nombre. */
interface Player {
	fideId: number | null
	name: string
}

/** Lo que cambia de un jugador: sólo los datos rectificados (undefined, sin tocar). */
interface PlayerChanges {
	fideId?: number | null
	name?: string
	title?: string | null
	rating?: number | null
}

/** ¿Es este jugador el de la fila? Con FIDE ID y con nombre, los dos tienen que casar. */
function isTarget(row: Rectification, player: Player): boolean {
	return (
		(row.fideId === null || row.fideId === player.fideId) &&
		(row.name === null || nameKey(row.name) === nameKey(player.name))
	)
}

/**
 * Filas que tocan a ese jugador: las de todo el torneo y, en una partida, las
 * de su ronda (`round`; null para un participante). Ordenadas para aplicarlas
 * una tras otra: primero las del torneo y después las de la ronda, cada grupo
 * por id, así que gana la más concreta y, a igualdad, la más nueva.
 */
function rowsFor(rows: Rectification[], player: Player, round: number | null): Rectification[] {
	return rows
		.filter((r) => (r.round === null || r.round === round) && isTarget(r, player))
		.sort((a, b) => Number(a.round !== null) - Number(b.round !== null) || a.id - b.id)
}

function playerChanges(rows: Rectification[]): PlayerChanges {
	const changes: PlayerChanges = {}
	for (const row of rows) {
		if (row.field === 'fide_id') changes.fideId = row.value === null ? null : Number(row.value)
		else if (row.field === 'nombre' && row.value !== null) changes.name = row.value
		else if (row.field === 'titulo') changes.title = row.value
		else if (row.field === 'elo') changes.rating = row.value === null ? null : Number(row.value)
	}
	return changes
}

/** El participante rectificado. Apunta en `hits` las filas que casan. */
export function rectifyParticipant<T extends Player & { title: string | null; rating: number | null }>(
	player: T,
	rows: Rectification[],
	hits: Set<number>,
	year?: number
): T {
	if (rows.length === 0) return player
	const own = rowsFor(rows, player, null)
	for (const row of own) hits.add(row.id)
	const changes = playerChanges(own)
	return {
		...player,
		fideId: changes.fideId === undefined ? player.fideId : changes.fideId,
		name: changes.name === undefined ? player.name : publicName(changes.name, year),
		title: changes.title === undefined ? player.title : changes.title,
		rating: changes.rating === undefined ? player.rating : changes.rating
	}
}

/** Lo que rectifyGame necesita de una partida (GameRow, o una guardada). */
interface RectifiableGame {
	round: number
	whiteName: string
	blackName: string
	whiteFideId: number | null
	blackFideId: number | null
	whiteElo: number | null
	blackElo: number | null
	result: string
	pgn: string
}

/** Las cabeceras del PGN de un jugador que cambian con `changes`. */
function playerTags(color: 'White' | 'Black', changes: PlayerChanges, name: string | undefined) {
	const tags: Record<string, string | null> = {}
	if (name !== undefined) tags[color] = name
	if (changes.fideId !== undefined) tags[`${color}FideId`] = changes.fideId === null ? null : String(changes.fideId)
	if (changes.title !== undefined) tags[`${color}Title`] = changes.title
	if (changes.rating !== undefined) tags[`${color}Elo`] = changes.rating === null ? null : String(changes.rating)
	return tags
}

/**
 * La partida rectificada, en las columnas y en las cabeceras del PGN; null si
 * no se guarda (una fila 'oculta'). Apunta en `hits` las filas que casan.
 */
export function rectifyGame<T extends RectifiableGame>(
	game: T,
	rows: Rectification[],
	hits: Set<number>,
	year?: number
): T | null {
	if (rows.length === 0) return game
	const whiteRows = rowsFor(rows, { fideId: game.whiteFideId, name: game.whiteName }, game.round)
	const blackRows = rowsFor(rows, { fideId: game.blackFideId, name: game.blackName }, game.round)
	for (const row of [...whiteRows, ...blackRows]) hits.add(row.id)
	const gameRows = [...whiteRows, ...blackRows].sort((a, b) => a.id - b.id)
	if (gameRows.some((r) => r.field === 'oculta')) return null

	const white = playerChanges(whiteRows)
	const black = playerChanges(blackRows)
	const whiteName = white.name === undefined ? undefined : publicName(white.name, year)
	const blackName = black.name === undefined ? undefined : publicName(black.name, year)
	const result = gameRows.filter((r) => r.field === 'resultado').at(-1)?.value as GameResult | undefined
	const tags = { ...playerTags('White', white, whiteName), ...playerTags('Black', black, blackName) }
	if (Object.keys(tags).length === 0 && result === undefined) return game

	const pgn = setPgnTags(game.pgn, tags)
	return {
		...game,
		whiteName: whiteName ?? game.whiteName,
		blackName: blackName ?? game.blackName,
		whiteFideId: white.fideId === undefined ? game.whiteFideId : white.fideId,
		blackFideId: black.fideId === undefined ? game.blackFideId : black.fideId,
		whiteElo: white.rating === undefined ? game.whiteElo : white.rating,
		blackElo: black.rating === undefined ? game.blackElo : black.rating,
		result: result ?? game.result,
		pgn: result === undefined ? pgn : setPgnResult(pgn, result)
	}
}

/**
 * Qué filas tiene que apuntar como aplicadas (o no) una escritura, y cómo: la
 * hora a las que casan y NULL a las que no. Las de participantes responden
 * de las de todo el torneo; las de partidas, de las de ronda y, sólo si casan,
 * de las del torneo (una persona puede no tener partidas).
 */
export function appliedRows(
	rows: Rectification[],
	hits: ReadonlySet<number>,
	writes: 'participantes' | 'partidas'
): { checked: number[]; hits: number[] } {
	const checked = rows
		.filter((r) => (writes === 'participantes' ? r.round === null : r.round !== null || hits.has(r.id)))
		.map((r) => r.id)
	return { checked, hits: checked.filter((id) => hits.has(id)) }
}
