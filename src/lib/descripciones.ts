// La descripción del torneo y de la ficha (meta description y og:description)
// y el título de la ficha. Lo que llevan viene de fuera (nombres de torneo,
// ciudades, nombres de jugadores) y puede ser larguísimo: se recortan para no
// pasar de DESCRIPTION_MAX, que es más o menos lo que enseña Google.
import type { TournamentFacts } from './db/tournaments'
import { formatCount, formatRange } from './format'

export const DESCRIPTION_MAX = 160

/**
 * Lo que cabe del título de la ficha sin el nombre del sitio: con « ·
 * MapleChess», que añade Base, son 65 caracteres. Google corta hacia los 60.
 */
const PLAYER_TITLE_ROOM = 52

const length = (text: string) => [...text].length

// Lo que no se deja delante de «…»: la puntuación y los conectores («Open de…»).
const LOOSE_END = /(?:[\s,.;:·–-]+|\s(?:de|del|la|el|los|las|y|e|en|a))+$/iu

/**
 * `text` en `max` caracteres como mucho, con «…». Se corta entre palabras,
 * salvo si el último espacio queda en la primera mitad: entonces, donde toca.
 */
export function clip(text: string, max = DESCRIPTION_MAX): string {
	const chars = [...text]
	if (chars.length <= max) return text
	const cut = chars.slice(0, max - 1).join('')
	const space = /\s/.test(chars[max - 1]) ? cut.length : cut.lastIndexOf(' ')
	return `${(space >= max / 2 ? cut.slice(0, space) : cut).replace(LOOSE_END, '')}…`
}

/** Lo que tiene texto: los trozos sin dato quedan fuera. */
const present = (text: string | null | false | undefined): text is string => !!text

/** Una frase con su punto, salvo si ya acaba en «…». */
const sentence = (text: string) => (text.endsWith('…') ? text : `${text}.`)

/**
 * El texto de `build` con `piece` (lo que viene de fuera) recortado para que
 * el total quepa en DESCRIPTION_MAX; sin él, si le quedan menos de 10
 * caracteres. Al final se recorta todo, por si lo demás ya no cabe.
 */
function fit(piece: string | null, build: (piece: string | null) => string): string {
	const text = build(piece)
	if (length(text) <= DESCRIPTION_MAX || !piece) return clip(text)
	const room = DESCRIPTION_MAX - (length(text) - length(piece))
	return clip(build(room >= 10 ? clip(piece, room) : null))
}

export interface DescribedTournament {
	name: string
	city: string | null
	startDate: string | null
	endDate: string | null
	/** Las rondas según la fuente (tournaments.rounds), no las que ya tienen partidas. */
	rounds: number | null
	/** El resumen (tournamentFacts); null en los torneos propios de lichess o sin jugadores. */
	facts: TournamentFacts | null
	/** Si tiene clasificación; sin ella, la página enseña los participantes. */
	standings: boolean
}

/**
 * «Bilbao, 17 oct – 28 nov 2026. 7 rondas · 66 jugadores, 2 GM, 5 IM · ELO
 * medio 2105. Clasificación y partidas.» Sin un dato, se omite su trozo; sin
 * ninguno, el nombre. La ciudad es lo que se recorta.
 */
export function tournamentDescription(t: DescribedTournament): string {
	const closing = t.standings ? 'Clasificación y partidas.' : 'Participantes y partidas.'
	const dates = t.startDate || t.endDate ? formatRange(t.startDate, t.endDate) : null
	const facts = [
		t.rounds ? formatCount(t.rounds, 'ronda', 'rondas') : null,
		t.facts && [t.facts.size, ...t.facts.titles].join(', '),
		t.facts?.average != null ? `ELO medio ${t.facts.average}` : null
	]
		.filter(Boolean)
		.join(' · ')
	const city = t.city?.trim() || null
	if (!city && !dates && !facts) return clip(`${t.name}: ${closing.toLowerCase()}`)
	return fit(city, (place) =>
		[[place, dates].filter(Boolean).join(', '), facts]
			.filter(present)
			.map(sentence)
			.concat(closing)
			.join(' ')
	)
}

/** El título de la ficha: «David Anton Guijarro: ELO y partidas de ajedrez», o más corto si no cabe. */
export function playerTitle(name: string): string {
	const full = `${name}: ELO y partidas de ajedrez`
	return length(full) <= PLAYER_TITLE_ROOM ? full : `${name}: ELO y partidas`
}

export interface DescribedPlayer {
	name: string
	fideId: number
	title: string | null
	ratingStd: number | null
	ratingRapid: number | null
	ratingBlitz: number | null
	/** Fuera de la lista FIDE, el ELO es el de su último torneo: no es «ELO FIDE». */
	inFideList: boolean
	minor: boolean
	tournaments: number
	games: number
	/** El último torneo que ya ha empezado (lastStartedTournament). */
	lastTournament: string | null
}

/** La de siempre, para los posibles menores y las fichas vacías. */
function genericPlayerDescription(p: DescribedPlayer): string {
	return clip(`Partidas y torneos de ${p.name} (FIDE ${p.fideId}).`)
}

/**
 * «GM · ELO FIDE: 2650 estándar, 2601 rápidas, 2580 blitz. 85 torneos y 12.345
 * partidas. Último torneo: Open de Bilbao 2026.» Un posible menor o una ficha
 * vacía llevan la de siempre: la descripción sale también al compartir
 * (og:description), aunque la ficha no se indexe, y diría dónde juega.
 */
export function playerDescription(p: DescribedPlayer): string {
	if (p.minor || (p.tournaments === 0 && p.games === 0)) return genericPlayerDescription(p)
	const fide = [
		[p.ratingStd, 'estándar'],
		[p.ratingRapid, 'rápidas'],
		[p.ratingBlitz, 'blitz']
	].flatMap(([rating, label]) => (rating === null ? [] : [`${rating} ${label}`]))
	const elo = p.inFideList
		? fide.length > 0 && `ELO FIDE: ${fide.join(', ')}`
		: p.ratingStd !== null && `ELO ${p.ratingStd}`
	const counts = [
		p.tournaments > 0 && formatCount(p.tournaments, 'torneo', 'torneos'),
		p.games > 0 && formatCount(p.games, 'partida', 'partidas')
	]
		.filter(Boolean)
		.join(' y ')
	return fit(p.lastTournament, (last) =>
		[[p.title, elo].filter(Boolean).join(' · '), counts, last && `Último torneo: ${last}`]
			.filter(present)
			.map(sentence)
			.join(' ')
	)
}

/**
 * El nombre del último torneo que ya ha empezado (su inicio o, sin él, su fin,
 * hasta `today`), de los suyos, del más reciente al más antiguo: el primero
 * puede ser uno por empezar, al que ya está inscrito.
 */
export function lastStartedTournament(
	tournaments: readonly { tournamentName: string; startDate: string | null; endDate: string | null }[],
	today: string
): string | null {
	return (
		tournaments.find((t) => {
			const date = t.startDate ?? t.endDate
			return date !== null && date <= today
		})?.tournamentName ?? null
	)
}
