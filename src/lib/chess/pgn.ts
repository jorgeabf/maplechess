// Lectura de PGN de las fuentes: cabeceras normalizadas, validación de la
// línea principal y apertura.
import { INITIAL_EPD } from 'chessops/fen'
import { makePgn, parseComment, parsePgn, startingPosition, type Game, type PgnNodeData } from 'chessops/pgn'
import { parseSan } from 'chessops/san'
import { validDate } from '../dates'
import { lookupOpening, OPENING_MAX_PLY, positionKey, type Opening } from './eco'
import { standardUci } from './uci'

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*'

/** Medias jugadas que se guardan en opening_moves (20 jugadas): hasta ahí llega el repertorio. */
export const OPENING_MOVES_PLIES = 40

export interface ParsedGame {
	game: Game<PgnNodeData>
	/** 0 si la fuente no indica ronda. */
	round: number
	/** null si la fuente no indica tablero. */
	board: number | null
	/** YYYY-MM-DD, o null si la fecha está incompleta. */
	date: string | null
	white: string
	black: string
	result: GameResult
	/** Medias jugadas legales de la línea principal. */
	plyCount: number
	/** Índice (desde 0) de la primera jugada ilegal de la línea principal, si la hay. */
	illegalAt?: number
	opening?: Opening
	/**
	 * Primeras OPENING_MOVES_PLIES medias jugadas legales en UCI estándar,
	 * separadas por espacios. null sin jugadas o si parte de un FEN.
	 */
	openingMoves: string | null
	/**
	 * Segundos que le quedan a quien mueve tras cada media jugada legal (del
	 * comentario [%clk]), separados por espacios; '-' donde falta. null si la
	 * partida no trae ningún reloj.
	 */
	clocks: string | null
}

/** Parsea un fichero PGN con una o varias partidas. */
export function parseGames(pgnText: string): ParsedGame[] {
	return parsePgn(separateGames(pgnText)).map(readGame)
}

const HEADER_LINE = /^\s*\[[A-Za-z0-9][A-Za-z0-9_+#=:-]*\s+"/
const HEADER_AFTER_RESULT = /(1-0|0-1|1\/2-1\/2|\*)[ \t]*(?=\[[A-Za-z0-9][A-Za-z0-9_+#=:-]*\s+")/g

/**
 * El estándar PGN separa las partidas con una línea en blanco, y chessops sólo
 * cierra una partida al encontrarla. info64 no respeta el formato: pega las
 * cabeceras de la siguiente partida justo debajo del resultado, y a veces en
 * la misma línea ("37. 0-1[Event ..."). Sin separar, esas cabeceras se leerían
 * como jugadas. Se normaliza en dos pasos:
 * 1. lo que sigue al marcador de fin de partida pasa a la línea siguiente;
 * 2. se inserta una línea en blanco antes de una cabecera que sigue a jugadas.
 */
export function separateGames(pgnText: string): string {
	const out: string[] = []
	let previousIsMovetext = false
	for (const line of pgnText.replace(HEADER_AFTER_RESULT, '$1\n').split(/\r\n?|\n/)) {
		const isHeader = HEADER_LINE.test(line)
		if (isHeader && previousIsMovetext) out.push('')
		out.push(line)
		previousIsMovetext = !isHeader && line.trim() !== ''
	}
	return out.join('\n')
}

function readGame(game: Game<PgnNodeData>): ParsedGame {
	const h = game.headers
	const { round, board } = parseRound(h.get('Round'), h.get('Board'))
	const replay = replayMainline(game)
	return {
		game,
		round,
		board,
		date: parsePgnDate(h.get('Date')),
		white: (h.get('White') ?? '').trim() || '?',
		black: (h.get('Black') ?? '').trim() || '?',
		result: parseResult(h.get('Result')),
		...replay
	}
}

/**
 * info64 y Vega escriben la ronda como "ronda.tablero" ("3.12"); otras fuentes
 * usan "3" y una cabecera Board aparte.
 */
export function parseRound(
	roundTag: string | undefined,
	boardTag?: string
): { round: number; board: number | null } {
	const match = /^\s*(\d+)(?:\.(\d+))?/.exec(roundTag ?? '')
	const round = match ? Number(match[1]) : 0
	const boardFromTag = /^\s*(\d+)\s*$/.exec(boardTag ?? '')
	const board = boardFromTag ? Number(boardFromTag[1]) : match?.[2] ? Number(match[2]) : null
	return { round, board }
}

/** "2026.08.28" → "2026-08-28"; las fechas con "??" o que no son un día verosímil (validDate) se descartan. */
export function parsePgnDate(tag: string | undefined): string | null {
	const match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(tag?.trim() ?? '')
	if (!match) return null
	const [, y, m, d] = match
	return validDate(`${y}-${m}-${d}`)
}

/** chessops ya normaliza la cabecera al leerla: cualquier otro valor («½-½» incluido) llega como "*". */
function parseResult(tag: string | undefined): GameResult {
	const value = tag?.trim()
	return value === '1-0' || value === '0-1' || value === '1/2-1/2' ? value : '*'
}

/** Segundos del comentario [%clk] de una jugada, o null si no lo tiene. */
function clockOf(node: PgnNodeData): number | null {
	for (const comment of node.comments ?? []) {
		const clock = parseComment(comment).clock
		if (clock !== undefined) return Math.round(clock)
	}
	return null
}

/**
 * Juega la línea principal para contar jugadas legales, nombrar la apertura
 * (la posición con nombre más profunda de los primeros plies) y sacar las
 * primeras jugadas en UCI y los relojes.
 */
function replayMainline(
	game: Game<PgnNodeData>
): Pick<ParsedGame, 'plyCount' | 'illegalAt' | 'opening' | 'openingMoves' | 'clocks'> {
	const start = startingPosition(game.headers)
	if (start.isErr) return { plyCount: 0, illegalAt: 0, openingMoves: null, clocks: null }
	const pos = start.value
	// Desde una posición distinta de la inicial (ajedrez 960, finales) no tiene
	// sentido nombrar la apertura ni meter la partida en el repertorio. Algunas
	// fuentes ponen la cabecera FEN también con la posición inicial.
	const fromStart = positionKey(pos) === INITIAL_EPD
	let opening: Opening | undefined
	const moves: string[] = []
	const clocks: (number | null)[] = []
	let ply = 0
	let illegalAt: number | undefined
	for (const node of game.moves.mainline()) {
		const move = parseSan(pos, node.san)
		if (!move) {
			illegalAt = ply
			break
		}
		if (fromStart && ply < OPENING_MOVES_PLIES) moves.push(standardUci(pos, move))
		clocks.push(clockOf(node))
		pos.play(move)
		ply++
		if (fromStart && ply <= OPENING_MAX_PLY) opening = lookupOpening(pos) ?? opening
	}
	return {
		plyCount: ply,
		illegalAt,
		opening,
		openingMoves: moves.length > 0 ? moves.join(' ') : null,
		clocks: clocks.some((c) => c !== null) ? clocks.map((c) => c ?? '-').join(' ') : null
	}
}

/**
 * Serializa la partida añadiendo o sustituyendo cabeceras. Los valores
 * undefined o vacíos no se escriben (queda la cabecera original, si la hay);
 * las de `remove` se quitan.
 */
export function writeGame(
	game: Game<PgnNodeData>,
	headers: Record<string, string | number | null | undefined>,
	remove: string[] = []
): string {
	const merged = new Map(game.headers)
	for (const key of remove) merged.delete(key)
	for (const [key, value] of Object.entries(headers)) {
		if (value === undefined || value === null || value === '') continue
		merged.set(key, String(value))
	}
	return makePgn({ ...game, headers: merged })
}

/** Las cabeceras del principio del texto, una por línea. */
const HEADER_BLOCK = /^(?:\[.*\]\r?\n)*/

/** Línea de la cabecera `tag` con su valor escapado (\" y \\). */
function tagLine(tag: string, value: string): string {
	return `[${tag} "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
}

/**
 * Cambia cabeceras del texto de un PGN ya escrito, sin volver a serializarlo:
 * con un valor, la línea se sustituye o, si no estaba, se añade tras las
 * demás; con null, se quita. El resto del texto queda igual, byte a byte.
 */
export function setPgnTags(pgn: string, tags: Record<string, string | null>): string {
	let text = pgn
	for (const [tag, value] of Object.entries(tags)) {
		const line = `^\\[${tag} "(?:[^"\\\\]|\\\\.)*"\\]`
		if (value === null) {
			text = text.replace(new RegExp(`${line}\\r?\\n`, 'gm'), '')
			continue
		}
		const current = new RegExp(`${line}(?=\\r?$)`, 'm')
		if (current.test(text)) {
			text = text.replace(current, () => tagLine(tag, value))
			continue
		}
		const end = HEADER_BLOCK.exec(text)?.[0].length ?? 0
		const eol = text.slice(0, end).endsWith('\r\n') ? '\r\n' : '\n'
		text = text.slice(0, end) + tagLine(tag, value) + eol + text.slice(end)
	}
	return text
}

/**
 * Cambia el resultado del texto de un PGN ya escrito: la cabecera Result y la
 * marca del final de las jugadas. El resto queda igual, byte a byte.
 */
export function setPgnResult(pgn: string, result: GameResult): string {
	return setPgnTags(pgn, { Result: result }).replace(/(?:1-0|0-1|1\/2-1\/2|\*)(\s*)$/, (_, space: string) => result + space)
}
