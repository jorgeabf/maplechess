// Extracción de datos de las páginas de info64.org.
//
// info64 no tiene API: se leen sus páginas HTML con HTMLRewriter (el parser en
// streaming del runtime de Workers). Se piden siempre en inglés (sin ?hl=),
// así que los textos fijos ("from", "There are no games.") son estables.
import { plausibleRating } from '../../lib/chess/rating'
import { validDate } from '../../lib/dates'
import type { RelatedTournament } from '../../lib/db/tournaments'

export type TournamentType = 'individual' | 'team'

export interface EventTournament {
	/** Ruta sin barra inicial: "slug" o "team/slug". Identifica el torneo. */
	key: string
	type: TournamentType
	name: string
	firstRound: string
	lastRound: string
}

export interface TournamentPlayer {
	/** Número del ranking inicial; en torneos por equipos, tablero dentro del equipo. */
	startRank: number
	/** Equipo (sólo en torneos por equipos). */
	team: string | null
	title: string | null
	name: string
	fed: string | null
	rating: number | null
	fideId: number | null
}

export interface TournamentPage {
	name: string
	city: string | null
	startDate: string | null
	endDate: string | null
	timeControl: string | null
	/** Enlaces a retransmisiones de lichess que cita la página (en enlaces o en texto). */
	broadcasts: string[]
	/**
	 * Ranking inicial. Vacío en torneos por equipos: su ranking es de equipos y
	 * las plantillas están en /listing (ver parseTeamListing).
	 */
	players: TournamentPlayer[]
	/**
	 * Las pestañas del grupo de torneos que crea el organizador, en su orden:
	 * las que llevan a un torneo de info64, sin repetir. Vacío sin grupo. Si
	 * se guardan lo decide relatedGroup.
	 */
	related: RelatedTournament[]
}

interface CalendarEvent {
	id: string
	title: string
	start: string
	url: string
	className: string
}

/** Título de una entrada del calendario sin la ronda ni la ciudad: "R.3 - Open (Ciudad)" → "Open". */
function eventName(title: string): string {
	return title.replace(/^R\.\s*\d+\s*-\s*/, '').replace(/\s*\([^()]*\)\s*$/, '').trim()
}

/**
 * Agrupa por torneo las entradas de /events.json (una por ronda). El título
 * llega como "R.3 - Nombre del torneo (Ciudad)".
 */
export function parseEvents(events: CalendarEvent[]): EventTournament[] {
	const byKey = new Map<string, EventTournament>()
	for (const event of events) {
		const key = event.url.replace(/^\/+|\/+$/g, '')
		if (!key) continue
		const day = event.start.slice(0, 10)
		const existing = byKey.get(key)
		if (existing) {
			if (day < existing.firstRound) existing.firstRound = day
			if (day > existing.lastRound) existing.lastRound = day
			continue
		}
		byKey.set(key, {
			key,
			type: event.className === 'team' ? 'team' : 'individual',
			name: eventName(event.title),
			firstRound: day,
			lastRound: day
		})
	}
	return [...byKey.values()]
}

/** Siguiente ronda de un torneo individual según el calendario. */
export interface UpcomingRound {
	key: string
	name: string
	round: number
	/** Hora local de España, 'YYYY-MM-DD HH:MM'. */
	startsAt: string
}

/**
 * La primera ronda de cada torneo individual que empieza después de `now`
 * (hora local, 'YYYY-MM-DD HH:MM'). El número sale del título ("R.3 - …").
 * Los torneos por equipos no entran: info64 no publica quién juega en cada
 * tablero hasta el encuentro.
 */
export function parseUpcomingRounds(events: CalendarEvent[], now: string): UpcomingRound[] {
	const byKey = new Map<string, UpcomingRound>()
	for (const event of events) {
		if (event.className === 'team') continue
		const key = event.url.replace(/^\/+|\/+$/g, '')
		const round = toInt(/^R\.\s*(\d+)/.exec(event.title)?.[1] ?? '')
		const startsAt = event.start.slice(0, 16).replace('T', ' ')
		if (!key || !round || startsAt <= now) continue
		const existing = byKey.get(key)
		if (existing && existing.startsAt <= startsAt) continue
		byKey.set(key, { key, name: eventName(event.title), round, startsAt })
	}
	return [...byKey.values()]
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
}

/**
 * HTMLRewriter entrega el texto tal cual está en el HTML, con sus entidades.
 * Una numérica fuera de Unicode (&#99999999;) o el NUL se quedan como texto:
 * String.fromCodePoint lanzaría y el torneo no se leería nunca.
 */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
			return code >= 1 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? entity
	})
}

/**
 * La página no tiene la forma que esperan los parsers: info64 ha cambiado su
 * HTML, o la página vino rota. Reintentar no lo arregla (ver info64/sync.ts).
 */
export class PageFormatError extends Error {}

function clean(text: string): string {
	return decodeEntities(text).replace(/\s+/g, ' ').trim()
}

function toInt(text: string): number | null {
	const value = Number.parseInt(text, 10)
	return Number.isFinite(value) && value > 0 ? value : null
}

/** Ejecuta el rewriter sobre el HTML y consume la salida para que se disparen los handlers. */
async function run(rewriter: HTMLRewriter, html: string): Promise<void> {
	await rewriter.transform(new Response(html)).arrayBuffer()
}

type PlayerField = 'startRank' | 'title' | 'name' | 'fed' | 'rating' | 'fideId'
type PlayerCells = Record<PlayerField, string>

// Clases de las celdas de jugador: son las mismas en el ranking inicial de los
// torneos individuales y en las plantillas de los torneos por equipos.
const PLAYER_CELLS: Record<string, PlayerField> = {
	playerstartrank: 'startRank',
	playertitle: 'title',
	playername: 'name',
	playerfederation: 'fed',
	playerfiderat: 'rating',
	playerfideratid: 'fideId'
}

function emptyCells(): PlayerCells {
	return { startRank: '', title: '', name: '', fed: '', rating: '', fideId: '' }
}

/** Acumula el texto de las celdas de jugador de las tablas `scope` en la fila actual. */
function collectPlayerCells(rewriter: HTMLRewriter, scope: string, currentRow: () => PlayerCells | undefined): void {
	for (const [cls, field] of Object.entries(PLAYER_CELLS)) {
		rewriter.on(`${scope} tbody td.${cls}`, {
			text(chunk) {
				const row = currentRow()
				if (row) row[field] += chunk.text
			}
		})
	}
}

function toPlayers(rows: PlayerCells[], team: string | null): TournamentPlayer[] {
	return (
		rows
			.map((row) => ({
				startRank: toInt(clean(row.startRank)) ?? 0,
				team,
				title: clean(row.title) || null,
				name: clean(row.name),
				fed: clean(row.fed) || null,
				rating: plausibleRating(toInt(clean(row.rating))),
				fideId: toInt(clean(row.fideId))
			}))
			// Las filas de un ranking de equipos no tienen celdas de jugador.
			.filter((p) => p.name && p.startRank > 0)
	)
}

/** Página principal del torneo: datos generales y ranking inicial. */
export async function parseTournamentPage(html: string): Promise<TournamentPage> {
	let name = ''
	let h1Done = false
	let datesText = ''
	const dates: string[] = []
	let currentDate: string | null = null
	let timeControl = ''
	const rows: PlayerCells[] = []
	// Texto y destinos de enlace del bloque de información, donde los
	// organizadores ponen las retransmisiones (como enlace o como texto suelto).
	let extraInfo = ''
	// Pestañas del grupo, encima del título: un enlace por torneo, también al propio.
	const tabs: { href: string; label: string }[] = []

	const rewriter = new HTMLRewriter()
		.on('#tournament-selection-nav a[href]', {
			element(el) {
				tabs.push({ href: el.getAttribute('href') ?? '', label: '' })
			},
			text(chunk) {
				const tab = tabs.at(-1)
				if (tab) tab.label += chunk.text
			}
		})
		.on('#extra-information', {
			text(chunk) {
				// Un espacio entre nodos de texto: si no, "url<br>Texto" quedaría pegado.
				extraInfo += chunk.lastInTextNode ? `${chunk.text} ` : chunk.text
			}
		})
		.on('#extra-information a[href]', {
			element(el) {
				extraInfo += ` ${el.getAttribute('href')} `
			}
		})
		.on('h1', {
			text(chunk) {
				if (h1Done) return
				name += chunk.text
				if (chunk.lastInTextNode) h1Done = true
			}
		})
		.on('#dates', {
			text(chunk) {
				datesText += chunk.text
			}
		})
		.on('#dates .mommentdate', {
			element(el) {
				currentDate = ''
				el.onEndTag(() => {
					if (currentDate !== null) dates.push(currentDate.trim())
					currentDate = null
				})
			},
			text(chunk) {
				if (currentDate !== null) currentDate += chunk.text
			}
		})
		.on('.rateofplay', {
			text(chunk) {
				timeControl += chunk.text
			}
		})
		.on('#initial-ranking-table tbody tr', {
			element() {
				rows.push(emptyCells())
			}
		})
	collectPlayerCells(rewriter, '#initial-ranking-table', () => rows.at(-1))

	await run(rewriter, html)

	// Todas las páginas de torneo tienen título, aunque aún no tengan inscritos.
	if (!clean(name)) throw new PageFormatError('info64: la página del torneo no tiene título (h1)')
	const city = /^(.*?),\s*from\b/.exec(clean(datesText))?.[1] ?? null
	const players = toPlayers(rows, null)

	return {
		name: clean(name),
		city: city || null,
		startDate: validDate(dates[0]),
		endDate: validDate(dates.at(-1)),
		timeControl: clean(timeControl) || null,
		broadcasts: findLichessBroadcasts(decodeEntities(extraInfo)),
		players,
		related: relatedTournaments(tabs)
	}
}

// Una clave de torneo de info64, como la de EventTournament: «slug» o «team/slug».
const INFO64_KEY = /^(?:team\/)?[^/?#:\s]+$/

/**
 * Las pestañas que llevan a un torneo de info64, sin repetir, con el rótulo
 * limpio. El enlace se lee como la URL del calendario (parseEvents): sin el
 * dominio, la consulta, el ancla ni las barras de los extremos. Si se perdiera
 * la del propio torneo, relatedGroup no guardaría el grupo.
 */
function relatedTournaments(tabs: { href: string; label: string }[]): RelatedTournament[] {
	const byKey = new Map<string, RelatedTournament>()
	for (const tab of tabs) {
		const key = decodeEntities(tab.href)
			.trim()
			.replace(/[?#].*$/, '')
			.replace(/^(?:https?:)?\/\/(?:www\.)?info64\.org(?=\/|$)/i, '')
			.replace(/^\/+|\/+$/g, '')
		if (INFO64_KEY.test(key) && !byKey.has(key)) byKey.set(key, { key, label: clean(tab.label) })
	}
	return [...byKey.values()]
}

/**
 * El grupo que se guarda del torneo `key`: las pestañas de su página, si son
 * dos o más y una es la suya. Si no, null, y upsertTournament conserva el
 * guardado: una página que vino a medias o con otra forma no lo borra.
 */
export function relatedGroup(related: RelatedTournament[], key: string): RelatedTournament[] | null {
	return related.length >= 2 && related.some((r) => r.key === key) ? related : null
}

const LICHESS_BROADCAST = /https?:\/\/(?:www\.)?lichess\.org\/broadcast\/[^\s"'<>]+/g

/** URLs de retransmisiones de lichess que aparecen en un texto, sin repetir. */
export function findLichessBroadcasts(text: string): string[] {
	const urls = [...text.matchAll(LICHESS_BROADCAST)].map((m) => m[0].replace(/[.,;)]+$/, ''))
	return [...new Set(urls)]
}

/**
 * Página /listing de un torneo por equipos: una tabla por equipo
 * (id="team-ranking-{equipo}", con el nombre en el caption) y, en cada fila,
 * el tablero y las mismas celdas de jugador que el ranking individual.
 */
export async function parseTeamListing(html: string): Promise<TournamentPlayer[]> {
	const teams: { name: string; rows: PlayerCells[] }[] = []
	const table = 'table[id^="team-ranking-"]'
	const rewriter = new HTMLRewriter()
		.on(table, {
			element() {
				teams.push({ name: '', rows: [] })
			}
		})
		.on(`${table} caption`, {
			text(chunk) {
				const team = teams.at(-1)
				if (team) team.name += chunk.text
			}
		})
		.on(`${table} tbody tr`, {
			element() {
				teams.at(-1)?.rows.push(emptyCells())
			}
		})
	collectPlayerCells(rewriter, table, () => teams.at(-1)?.rows.at(-1))

	await run(rewriter, html)
	return teams.flatMap((team) => toPlayers(team.rows, clean(team.name) || null))
}

export interface StandingRow {
	/** Puesto en la clasificación. */
	pos: number
	/** Número del ranking inicial del jugador o del equipo. */
	startRank: number
	/** Jugador o equipo. */
	name: string
	points: number
	/** Valores de los desempates, en el orden de StandingsPage.tiebreaks. */
	tiebreaks: (number | null)[]
	/** ELO del jugador o, en los torneos por equipos, ELO medio del equipo. */
	rating: number | null
}

export interface StandingsPage {
	/** Ronda tras la que va la clasificación; null si la página no lo dice. */
	round: number | null
	/** Rondas del torneo; null si el menú no enlaza ninguna. */
	rounds: number | null
	/** Códigos de los desempates («BH», «BH/M1»…), en el orden de la tabla. */
	tiebreaks: string[]
	rows: StandingRow[]
}

type StandingField = 'pos' | 'startRank' | 'name' | 'points' | 'rating'

const STANDING_HEADERS: Record<string, StandingField> = {
	'Pos.': 'pos',
	'Ran.': 'startRank',
	Name: 'name',
	'Pts.': 'points',
	FIDE: 'rating',
	'Rating average': 'rating'
}

/** Cifra con decimales ("6.5", "2476"); null si la celda está vacía o no lo es. */
function toNumber(text: string): number | null {
	const value = Number(text)
	return text !== '' && Number.isFinite(value) ? value : null
}

/**
 * Página /standings, la clasificación. El título dice tras qué ronda va
 * ("Standings after the round 5"); sin resultados, y en los torneos por
 * equipos aunque hayan terminado, sólo "Standings". #standings-table tiene
 * una fila por jugador o por equipo, y sus columnas se localizan por la
 * cabecera, porque las clases se repiten: playerstartrank vale para el puesto,
 * el número inicial y los puntos. Los desempates, por la clase de sus celdas
 * (playertiebreak), porque su cabecera es el código, distinto en cada torneo.
 * Las rondas del torneo salen de los enlaces a cada una del menú. Devuelve
 * null si la página no tiene esa forma.
 */
export async function parseStandingsPage(html: string): Promise<StandingsPage | null> {
	const found = { heading: '', headingDone: false, table: false, rounds: 0 }
	const headers: string[] = []
	const rows: { cells: string[]; classes: string[] }[] = []

	await run(
		new HTMLRewriter()
			.on('#tournament-options-menu a[href]', {
				element(el) {
					const round = toInt(/\/(\d+)\/?$/.exec(el.getAttribute('href') ?? '')?.[1] ?? '')
					if (round && round > found.rounds) found.rounds = round
				}
			})
			.on('#standings h2', {
				text(chunk) {
					if (!found.headingDone) found.heading += chunk.text
				},
				element(el) {
					el.onEndTag(() => {
						found.headingDone = true
					})
				}
			})
			.on('#standings-table', {
				element() {
					found.table = true
				}
			})
			.on('#standings-table thead th', {
				element() {
					headers.push('')
				},
				text(chunk) {
					headers[headers.length - 1] += chunk.text
				}
			})
			.on('#standings-table tbody tr', {
				element() {
					rows.push({ cells: [], classes: [] })
				}
			})
			.on('#standings-table tbody td', {
				element(el) {
					const row = rows.at(-1)
					row?.cells.push('')
					row?.classes.push(el.getAttribute('class') ?? '')
				},
				text(chunk) {
					const cells = rows.at(-1)?.cells
					if (cells?.length) cells[cells.length - 1] += chunk.text
				}
			}),
		html
	)

	if (!found.table) return null
	const columns: Partial<Record<StandingField, number>> = {}
	for (const [i, header] of headers.map(clean).entries()) {
		const field = STANDING_HEADERS[header]
		if (field) columns[field] ??= i
	}
	const { pos, startRank, name, points, rating } = columns
	if (pos === undefined || startRank === undefined || name === undefined || points === undefined) return null
	// Las columnas de desempate con código: sin resultados, la cabecera va vacía.
	const tiebreakColumns = (rows[0]?.classes ?? []).flatMap((cls, i) =>
		cls.split(/\s+/).includes('playertiebreak') && clean(headers[i] ?? '') ? [i] : []
	)

	const cell = (cells: string[], i: number) => clean(cells[i] ?? '')
	const standings = rows.flatMap(({ cells }, i): StandingRow[] => {
		const row = {
			pos: toInt(cell(cells, pos)) ?? i + 1,
			startRank: toInt(cell(cells, startRank)) ?? 0,
			name: cell(cells, name),
			points: toNumber(cell(cells, points)) ?? 0,
			tiebreaks: tiebreakColumns.map((c) => toNumber(cell(cells, c))),
			rating: rating === undefined ? null : plausibleRating(toInt(cell(cells, rating)))
		}
		return row.name && row.startRank > 0 ? [row] : []
	})
	const round = /after the round\s+(\d+)/i.exec(clean(found.heading))?.[1]
	return {
		round: round ? Number(round) : null,
		rounds: found.rounds || null,
		tiebreaks: tiebreakColumns.map((c) => clean(headers[c])),
		rows: standings
	}
}

/**
 * Página /games: devuelve el PGN de todas las partidas, o null si el torneo no
 * tiene. Si la página no es ninguna de las dos cosas (error, cambio de diseño)
 * lanza un error en vez de dar el torneo por vacío.
 */
export async function parseGamesPage(html: string): Promise<string | null> {
	// En un objeto y no en variables sueltas: TypeScript no ve las asignaciones
	// hechas dentro de los handlers y estrecharía el tipo a null.
	const found = { textarea: false, pgn: '', noGames: false }

	await run(
		new HTMLRewriter()
			.on('textarea#pgnText', {
				element() {
					found.textarea = true
				},
				text(chunk) {
					found.pgn += chunk.text
				}
			})
			.on('.well', {
				text(chunk) {
					if (chunk.text.includes('There are no games')) found.noGames = true
				}
			}),
		html
	)

	if (found.pgn.trim()) return decodeEntities(found.pgn)
	if (found.textarea || found.noGames) return null
	throw new PageFormatError('info64: la página de partidas no tiene ni PGN ni el aviso "There are no games"')
}

export interface PairedPlayer {
	/** Número del ranking inicial: con él se cruza con los participantes. */
	startRank: number
	name: string
	rating: number | null
}

export interface Pairing {
	board: number
	white: PairedPlayer
	black: PairedPlayer
}

export interface RoundPage {
	round: number
	/** Hora local de España, 'YYYY-MM-DD HH:MM'; null si la página no da la hora. */
	startsAt: string | null
	/** Vacío si la ronda aún no está emparejada. Los descansos no cuentan. */
	pairings: Pairing[]
}

interface PlayerColumns {
	name?: number
	startRank?: number
	rating?: number
}

/** El título FIDE va delante del nombre ("FM Apellido Inventado, Nombre"). */
function withoutTitle(name: string): string {
	return name.replace(/^W?[GIFC]M\s+/, '')
}

/**
 * Página de una ronda (/{slug}/{n}): el título da la fecha y la hora
 * ("Pairings of round 2 - 2026-10-24 - 16:00") y #pairing-table, una fila por
 * tablero. Las columnas se localizan por la cabecera (Brd., White, Ran., FIDE…,
 * y lo mismo tras Black) por si un torneo oculta alguna. Devuelve null si la
 * página no tiene esa forma (cambio de diseño): no hay nada que reintentar.
 */
export async function parseRoundPage(html: string): Promise<RoundPage | null> {
	const found = { heading: '', headingDone: false, table: false }
	const headers: string[] = []
	const rows: string[][] = []

	await run(
		new HTMLRewriter()
			.on('#round h2', {
				text(chunk) {
					if (found.headingDone) return
					found.heading += chunk.text
				},
				element(el) {
					el.onEndTag(() => {
						found.headingDone = true
					})
				}
			})
			.on('#pairing-table', {
				element() {
					found.table = true
				}
			})
			.on('#pairing-table thead th', {
				element() {
					headers.push('')
				},
				text(chunk) {
					headers[headers.length - 1] += chunk.text
				}
			})
			.on('#pairing-table tbody tr', {
				element() {
					rows.push([])
				}
			})
			.on('#pairing-table tbody td', {
				element() {
					rows.at(-1)?.push('')
				},
				text(chunk) {
					const cells = rows.at(-1)
					if (cells?.length) cells[cells.length - 1] += chunk.text
				}
			}),
		html
	)

	const heading = /round\s+(\d+)\s*-\s*(\d{4}-\d{2}-\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/i.exec(clean(found.heading))
	if (!found.table || !heading) return null

	// Brd. primero; luego White y sus columnas, y Black y las suyas.
	let board: number | undefined
	const sides: Record<'white' | 'black', PlayerColumns> = { white: {}, black: {} }
	let side: PlayerColumns | undefined
	for (const [i, header] of headers.map(clean).entries()) {
		if (header === 'Brd.') board = i
		else if (header === 'White') side = sides.white
		else if (header === 'Black') side = sides.black
		if (!side) continue
		if (header === 'White' || header === 'Black') side.name = i
		else if (header === 'Ran.') side.startRank ??= i
		else if (header === 'FIDE') side.rating ??= i
	}
	const complete = (c: PlayerColumns) => c.name !== undefined && c.startRank !== undefined
	if (board === undefined || !complete(sides.white) || !complete(sides.black)) return null
	const boardColumn = board

	const player = (cells: string[], c: PlayerColumns): PairedPlayer | null => {
		const name = withoutTitle(clean(cells[c.name!] ?? ''))
		const startRank = toInt(clean(cells[c.startRank!] ?? ''))
		if (!name || !startRank) return null
		const rating = c.rating === undefined ? null : plausibleRating(toInt(clean(cells[c.rating] ?? '')))
		return { startRank, name, rating }
	}
	const pairings = rows.flatMap((cells): Pairing[] => {
		const number = toInt(clean(cells[boardColumn] ?? ''))
		const white = player(cells, sides.white)
		const black = player(cells, sides.black)
		// Un descanso o un jugador sin emparejar no tiene la mitad negra de la fila.
		return number && white && black ? [{ board: number, white, black }] : []
	})

	const [, round, day, hour, minute] = heading
	return {
		round: Number(round),
		startsAt: hour ? `${day} ${hour.padStart(2, '0')}:${minute}` : null,
		pairings
	}
}
