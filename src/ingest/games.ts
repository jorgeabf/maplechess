// Convierte las partidas leídas de una fuente en filas de la tabla games:
// quita las repetidas, identifica a los jugadores (FIDE ID, ELO, título)
// cruzando con los participantes del torneo y reescribe el PGN con esos datos
// en cabeceras.
import { matchName, normalizeName, type NameCandidate } from '../lib/chess/names'
import { writeGame, type ParsedGame } from '../lib/chess/pgn'
import { plausibleRating } from '../lib/chess/rating'
import { timeClassOf, type TimeClass } from '../lib/chess/timecontrol'
import { madridYear } from '../lib/dates'
import { publicName } from './nombres'

export interface Participant {
	name: string
	fideId: number | null
	rating: number | null
	title: string | null
}

export interface TournamentContext {
	name: string
	city: string | null
	startDate: string | null
	/** Ritmo tal como lo publica el torneo (texto libre). */
	timeControl: string | null
}

/**
 * Columnas que se derivan del PGN. Las calcula la ingesta y, para las partidas
 * ya guardadas, el reprocesado (reprocess.ts), con la misma función.
 */
export interface DerivedColumns {
	/** Primeras jugadas en UCI para el repertorio (ver ParsedGame.openingMoves). */
	openingMoves: string | null
	timeClass: TimeClass | null
	/** Relojes tras cada media jugada para el dossier (ver ParsedGame.clocks). */
	clocks: string | null
}

interface GameColumns {
	round: number
	board: number
	seq: number
	date: string | null
	whiteName: string
	blackName: string
	whiteFideId: number | null
	blackFideId: number | null
	whiteElo: number | null
	blackElo: number | null
	result: string
	eco: string | null
	opening: string | null
	plyCount: number
	pgn: string
}

export type GameRow = GameColumns & DerivedColumns

function headerInt(game: ParsedGame, tag: string): number | null {
	const value = Number.parseInt(game.game.headers.get(tag) ?? '', 10)
	return Number.isFinite(value) && value > 0 ? value : null
}

function headerText(game: ParsedGame, tag: string): string | null {
	const value = game.game.headers.get(tag)?.trim()
	return value && value !== '?' ? value : null
}

export function derivedColumns(game: ParsedGame, tournamentTimeControl: string | null): DerivedColumns {
	return {
		openingMoves: game.openingMoves,
		timeClass: timeClassOf(tournamentTimeControl, headerText(game, 'TimeControl')),
		clocks: game.clocks
	}
}

/**
 * Ronda y jugadores: las copias de una misma partida la comparten. El tablero
 * no entra porque algunas fuentes no lo dan y se numera por orden.
 */
function pairingKey(game: ParsedGame): string {
	return [game.round, normalizeName(game.white), normalizeName(game.black)].join('|')
}

interface Copy {
	game: ParsedGame
	/** Línea principal en SAN. */
	moves: string[]
	/** Comentarios (relojes, evaluaciones, notas) y símbolos de la línea principal. */
	annotations: number
}

function toCopy(game: ParsedGame): Copy {
	const moves: string[] = []
	let annotations = 0
	for (const node of game.game.moves.mainline()) {
		moves.push(node.san)
		annotations += (node.comments?.length ?? 0) + (node.nags?.length ?? 0)
	}
	return { game, moves, annotations }
}

/** ¿Es la línea `a` el principio de la `b`, o igual? Una partida sin jugadas es principio de todas. */
function isPrefix(a: string[], b: string[]): boolean {
	return a.length <= b.length && a.every((san, i) => san === b[i])
}

/**
 * Junta dos copias de la misma partida: se queda la de más jugadas y, a
 * igualdad, la más anotada. Si ésa no tiene resultado y la otra sí, toma el
 * de la otra (la grabación DGT puede acabar en "*" y el acta tener el resultado).
 */
function merge(a: Copy, b: Copy): Copy {
	const [best, other] =
		b.moves.length > a.moves.length || (b.moves.length === a.moves.length && b.annotations > a.annotations)
			? [b, a]
			: [a, b]
	if (best.game.result !== '*' || other.game.result === '*') return best
	const result = other.game.result
	const headers = new Map(best.game.game.headers).set('Result', result)
	return { ...best, game: { ...best.game, result, game: { ...best.game.game, headers } } }
}

/**
 * Una copia por partida. info64 a veces publica el PGN de un torneo con todas
 * las partidas dos veces, o una partida con y sin relojes, con y sin
 * resultado, cortada a las pocas jugadas o sólo con el resultado. Con la misma
 * ronda y los mismos jugadores, dos copias son la misma partida si la línea de
 * una es el principio de la de la otra; si las jugadas difieren, son partidas
 * distintas (desempates, encuentros a doble vuelta) y se conservan las dos,
 * salvo que una esté sin terminar y la otra terminada (ver abajo). Se mantiene
 * el orden de la primera aparición.
 */
export function uniqueGames(games: ParsedGame[]): ParsedGame[] {
	const kept: Copy[] = []
	const byPairing = new Map<string, number[]>()
	for (const game of games) {
		const copy = toCopy(game)
		const key = pairingKey(game)
		const indices = byPairing.get(key) ?? []
		const same = indices.find((i) => isPrefix(copy.moves, kept[i].moves) || isPrefix(kept[i].moves, copy.moves))
		if (same === undefined) {
			byPairing.set(key, [...indices, kept.length])
			kept.push(copy)
		} else {
			kept[same] = merge(kept[same], copy)
		}
	}

	// Una partida sin terminar ("*") con otras jugadas, junto a una terminada
	// de los mismos jugadores en la misma ronda, no es otra partida: es una
	// grabación fallida (un tablero DGT que recoge «1.d4 d5» antes de empezar) o
	// un tablero asignado a quien no era. La terminada es la del acta.
	const failed = new Set<number>()
	for (const indices of byPairing.values()) {
		if (!indices.some((i) => kept[i].game.result !== '*')) continue
		for (const i of indices) if (kept[i].game.result === '*') failed.add(i)
	}
	return kept.filter((_, i) => !failed.has(i)).map((c) => c.game)
}

export function buildGameRows(
	games: ParsedGame[],
	participants: Participant[],
	tournament: TournamentContext
): GameRow[] {
	const candidates: NameCandidate<Participant>[] = participants.map((p) => ({ name: p.name, value: p }))
	const boardsPerRound = new Map<number, number>()
	const seen = new Map<string, number>()
	const year = madridYear(new Date())

	return uniqueGames(games).map((game) => {
		// Sin tablero en la fuente: se numeran por orden dentro de la ronda.
		const nextBoard = (boardsPerRound.get(game.round) ?? 0) + 1
		boardsPerRound.set(game.round, nextBoard)
		const board = game.board ?? nextBoard
		// Partidas distintas con la misma ronda.tablero (desempates, encuentros
		// por equipos que numeran sus tableros desde 1): se conservan todas con
		// seq creciente en vez de pisarse.
		const key = `${game.round}.${board}`
		const seq = seen.get(key) ?? 0
		seen.set(key, seq + 1)

		// Se cruza con el nombre completo y se guarda sin el año de los menores
		// (nombres.ts), en la columna y en la cabecera del PGN.
		const white = matchName(game.white, candidates)
		const black = matchName(game.black, candidates)
		const whiteName = publicName(white?.name ?? game.white, year)
		const blackName = publicName(black?.name ?? game.black, year)
		const whiteFideId = headerInt(game, 'WhiteFideId') ?? white?.fideId ?? null
		const blackFideId = headerInt(game, 'BlackFideId') ?? black?.fideId ?? null
		// El de los participantes ya viene filtrado (info64/parse.ts).
		const whiteElo = plausibleRating(headerInt(game, 'WhiteElo')) ?? white?.rating ?? null
		const blackElo = plausibleRating(headerInt(game, 'BlackElo')) ?? black?.rating ?? null
		// Un ELO inverosímil de la fuente tampoco se queda en el PGN.
		const remove = [...(whiteElo === null ? ['WhiteElo'] : []), ...(blackElo === null ? ['BlackElo'] : [])]
		const eco = game.opening?.eco ?? headerText(game, 'ECO')
		const opening = game.opening?.name ?? headerText(game, 'Opening')
		const date = game.date ?? tournament.startDate

		const pgn = writeGame(
			game.game,
			{
				// El Event de algunas fuentes es un nombre interno ("ABSOLUTO_2025").
				Event: tournament.name,
				Site: headerText(game, 'Site') ?? tournament.city,
				Date: date?.replaceAll('-', '.'),
				White: whiteName,
				Black: blackName,
				WhiteTitle: headerText(game, 'WhiteTitle') ?? white?.title,
				BlackTitle: headerText(game, 'BlackTitle') ?? black?.title,
				WhiteElo: whiteElo,
				BlackElo: blackElo,
				WhiteFideId: whiteFideId,
				BlackFideId: blackFideId,
				ECO: eco,
				Opening: opening
			},
			remove
		)

		return {
			round: game.round,
			board,
			seq,
			date,
			whiteName,
			blackName,
			whiteFideId,
			blackFideId,
			whiteElo,
			blackElo,
			result: game.result,
			eco,
			opening,
			plyCount: game.plyCount,
			pgn,
			// Los pasos de Workflows lanzados antes de que existiera timeControl no lo traen.
			...derivedColumns(game, tournament.timeControl ?? null)
		}
	})
}
