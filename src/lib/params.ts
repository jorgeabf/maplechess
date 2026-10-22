// Lectura y validación de los filtros que llegan en la URL (formularios GET).
import { OPENING_MOVES_PLIES } from './chess/pgn'
import { TIME_CLASSES, type TimeClass } from './chess/timecontrol'
import { prefixTerms, type Color } from './db/fts'
import { RANKING_CATEGORIES, TITLES, type PlayerFilters, type RankingCategory } from './db/players'
import type { TournamentFilters } from './db/tournaments'

/**
 * Entero positivo de la URL (un parámetro o el ID de la ruta), o null. Hasta
 * Number.MAX_SAFE_INTEGER: con uno mayor, la página 10¹⁸ desbordaba el OFFSET
 * de SQLite (un 500).
 */
export function positiveInt(value: string | null | undefined): number | null {
	const n = Number.parseInt(value ?? '', 10)
	return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * Número de página (desde 1) del parámetro `p`. Las búsquedas de partidas y
 * jugadores lo dejan en la última de las suyas (searchPage); la ficha, los
 * torneos y el repertorio llegan hasta el final.
 */
export function pageParam(value: string | null): number {
	return positiveInt(value) ?? 1
}

function text(params: URLSearchParams, name: string, max = 80): string {
	return (params.get(name) ?? '').trim().slice(0, max)
}

function int(params: URLSearchParams, name: string): number | null {
	return positiveInt(params.get(name))
}

function isoDay(params: URLSearchParams, name: string): string {
	const value = text(params, name, 10)
	return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
	return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Parámetro `ritmo`: standard, rapid o blitz; null si no viene o no vale. */
function timeClass(params: URLSearchParams): TimeClass | null {
	const value = text(params, 'ritmo')
	return (TIME_CLASSES as readonly string[]).includes(value) ? (value as TimeClass) : null
}

export function playerFilters(params: URLSearchParams): PlayerFilters {
	return {
		q: text(params, 'q'),
		title: oneOf(text(params, 'titulo'), ['', ...TITLES], ''),
		sex: oneOf(text(params, 'sexo'), ['', 'M', 'F'], ''),
		minElo: int(params, 'elo_min'),
		maxElo: int(params, 'elo_max'),
		withGames: params.get('con_partidas') === '1',
		active: params.get('activos') === '1',
		page: pageParam(params.get('p'))
	}
}

/** Parámetro `categoria` del ranking de /jugadores; '' (absoluto) si no viene o no vale. */
export function rankingCategory(params: URLSearchParams): RankingCategory {
	return oneOf(text(params, 'categoria'), RANKING_CATEGORIES, '')
}

const COLORS: readonly Color[] = ['any', 'white', 'black']
const RESULTS = ['', 'win', 'draw', 'loss', '1-0', '0-1', '1/2-1/2'] as const

export interface GameSearch {
	player: string
	opponent: string
	color: Color
	result: (typeof RESULTS)[number]
	eco: string
	from: string
	to: string
	timeClass: TimeClass | null
	tournamentId: number | null
	page: number
}

export function gameFilters(params: URLSearchParams): GameSearch {
	return {
		player: text(params, 'jugador'),
		opponent: text(params, 'rival'),
		color: oneOf(text(params, 'color'), COLORS, 'any'),
		result: oneOf(text(params, 'resultado'), RESULTS, ''),
		eco: /^[A-Ea-e](\d{1,2})?$/.test(text(params, 'eco')) ? text(params, 'eco').toUpperCase() : '',
		from: isoDay(params, 'desde'),
		to: isoDay(params, 'hasta'),
		timeClass: timeClass(params),
		tournamentId: int(params, 'torneo'),
		page: pageParam(params.get('p'))
	}
}

/** Periodos del repertorio: años hacia atrás; '' son todas las partidas. */
export const REPERTOIRE_PERIODS = ['2', '5', ''] as const

export interface RepertoireSearch {
	color: 'white' | 'black'
	period: (typeof REPERTOIRE_PERIODS)[number]
	timeClass: TimeClass | null
	/** ELO del rival en la partida. */
	minElo: number | null
	maxElo: number | null
	/** Jugadas en UCI separadas por espacios; parseLine se queda con la parte legal. */
	moves: string
	page: number
}

export function repertoireParams(params: URLSearchParams): RepertoireSearch {
	return {
		color: oneOf(text(params, 'color'), ['white', 'black'], 'white'),
		period: oneOf(text(params, 'periodo'), REPERTOIRE_PERIODS, ''),
		timeClass: timeClass(params),
		minElo: int(params, 'elo_min'),
		maxElo: int(params, 'elo_max'),
		// Cada media jugada ocupa como mucho 5 caracteres más el separador.
		moves: text(params, 'jugadas', OPENING_MOVES_PLIES * 6),
		page: pageParam(params.get('p'))
	}
}

/**
 * Dossier para preparar una partida contra un jugador que lleva `rivalColor`.
 * El color del dossier es el del rival. Sin color, el dossier abre con el de
 * vuestra partida si estáis emparejados o, si no, con blancas. El que se pide
 * va siempre en la URL, también blancas: si no, el de vuestra partida pisaría
 * el del botón que se ha pulsado.
 */
export function dossierHref(fideId: number, rivalColor?: 'white' | 'black'): string {
	return `/jugadores/${fideId}/preparar${rivalColor ? `?color=${rivalColor}` : ''}`
}

/**
 * Enlace a una partida. Con `color`, el tablero se abre desde ese lado: desde
 * la ficha, el dossier o el repertorio, el del jugador, como /partida/black en
 * lichess. Blancas no va en la URL. Con `ply`, en esa media jugada de la línea
 * principal (#j, ver GameTree).
 */
export function gameHref(id: number, color?: 'white' | 'black', ply?: number): string {
	return `/partidas/${id}${color === 'black' ? '?color=black' : ''}${ply ? `#j${ply}` : ''}`
}

/** Listas desde las que se abre una partida. */
export type BackKind = 'search' | 'tournament' | 'player' | 'dossier' | 'repertoire'

const BACK_ROUTES: [RegExp, BackKind][] = [
	[/^\/partidas$/, 'search'],
	[/^\/torneos\/\d+$/, 'tournament'],
	[/^\/jugadores\/(\d+)$/, 'player'],
	[/^\/jugadores\/(\d+)\/preparar$/, 'dossier'],
	[/^\/jugadores\/(\d+)\/repertorio$/, 'repertoire']
]

/**
 * Lista de la que se llega a una partida (cabecera Referer), para volver a
 * ella: la búsqueda, un torneo, una ficha, un dossier o un repertorio, con el
 * FIDE ID del jugador en las tres últimas. Sólo de esta web, y `href` es la
 * ruta sin el origen. Desde otra partida, la portada o fuera, null.
 */
export function backTarget(
	referer: string | null,
	here: URL
): { href: string; kind: BackKind; fideId: number | null } | null {
	if (!referer) return null
	let from: URL
	try {
		from = new URL(referer)
	} catch {
		return null
	}
	if (from.origin !== here.origin) return null
	for (const [pattern, kind] of BACK_ROUTES) {
		const match = pattern.exec(from.pathname)
		if (match) return { href: from.pathname + from.search, kind, fideId: match[1] ? Number(match[1]) : null }
	}
	return null
}

/** Ronda de la página del torneo (`ronda`): 0 son las partidas sin ronda; null, todas. */
export function roundParam(params: URLSearchParams): number | null {
	const value = text(params, 'ronda')
	return /^\d{1,3}$/.test(value) ? Number(value) : null
}

/** Lado del tablero que pide el enlace a una partida, o null si no lo pide. */
export function boardColor(params: URLSearchParams): 'white' | 'black' | null {
	const value = text(params, 'color')
	return value === 'white' || value === 'black' ? value : null
}

export function tournamentFilters(params: URLSearchParams): TournamentFilters {
	const upcoming = params.get('cuando') === 'proximos'
	return {
		q: text(params, 'q'),
		upcoming,
		// Los que aún no han empezado no tienen partidas.
		withGames: !upcoming && params.get('con_partidas') === '1',
		from: isoDay(params, 'desde'),
		to: isoDay(params, 'hasta'),
		type: tournamentType(params),
		page: pageParam(params.get('p'))
	}
}

/** Modalidad de /torneos (`modalidad`): individual o equipos; null, las dos. */
function tournamentType(params: URLSearchParams): TournamentFilters['type'] {
	const value = text(params, 'modalidad')
	return value === 'individual' ? 'individual' : value === 'equipos' ? 'team' : null
}

/** Misma URL con otra página (o con otros parámetros). */
export function withParams(url: URL, changes: Record<string, string | number | null>): string {
	const next = new URL(url)
	for (const [key, value] of Object.entries(changes)) {
		if (value === null || value === '') next.searchParams.delete(key)
		else next.searchParams.set(key, String(value))
	}
	return `${next.pathname}${next.search}`
}

/**
 * ¿Lanza /partidas una búsqueda? Se decide con los filtros ya leídos, no con
 * el texto de la URL: "?eco=zz" o "?jugador=-" no filtran nada. El color, el
 * ritmo y el resultado sólo afinan: solos recorrerían todas las partidas
 * (time_class y result no tienen índice, y el color sin nombre no filtra).
 */
export function gameSearchKind(f: Omit<GameSearch, 'page'>): 'search' | 'refine' | 'empty' {
	if (prefixTerms(f.player) || prefixTerms(f.opponent) || f.eco || f.from || f.to || f.tournamentId) return 'search'
	return f.color !== 'any' || f.timeClass || f.result ? 'refine' : 'empty'
}

/**
 * ¿Lanza /jugadores una búsqueda? Con los filtros ya leídos: "?q=-" no busca
 * nada. «Sólo con partidas» sólo afina: sola recorrería todos los jugadores.
 */
export function isPlayerSearch(f: PlayerFilters): boolean {
	return Boolean(prefixTerms(f.q) || f.title || f.sex || f.minElo || f.maxElo)
}
