// Jugadores del archivo de la FCA: sus PGN no traen FIDE ID, y muchos nombres
// van cortos («Mora, Jesus») o al revés («Nombre Apellidos», los de 2021). Se
// cruzan por el nombre con la lista FIDE española, sólo cuando casa con un
// único jugador y su año de nacimiento le deja jugar esas partidas (decidido
// con Jorge el 24-oct-2026). Un cruce equivocado pondría las partidas de una
// persona en la ficha de otra: en la duda, se queda sin FIDE ID.
//
// Medido el 24-oct-2026 importando el archivo entero en local: de las 2.683
// partidas, 884 quedan con los dos jugadores enlazados, 1.343 con uno y 456
// sin ninguno; son 229 jugadores de la lista.
import { words } from '../../lib/chess/names'
import { plausibleRating } from '../../lib/chess/rating'
import type { ParsedGame } from '../../lib/chess/pgn'
import type { TournamentPlayer } from '../info64/parse'
import { playerKey } from './archivo'

export interface FidePlayer {
	fideId: number
	name: string
	birthYear: number | null
}

/**
 * Años que tiene que haber cumplido para jugar una partida del archivo: la
 * categoría más joven de sus archivos es la Sub 8.
 */
export const MIN_AGE = 6

interface Indexed extends FidePlayer {
	surnames: string[]
	given: string[]
}

/** ¿Son las palabras de `part` las primeras de `full`? */
const startsWith = (part: string[], full: string[]): boolean =>
	part.length > 0 && part.length <= full.length && part.every((word, i) => full[i] === word)

/**
 * Busca jugadores de la lista FIDE por un nombre del archivo. Casa si sus
 * apellidos empiezan por los del archivo y sus nombres de pila también: «Mora,
 * Jesus» casa con «Mora Gutiérrez, Jesús María». Sin coma, prueba todas las
 * formas de partir el nombre en nombre de pila y apellidos.
 */
export class FideMatcher {
	/** Por el primer apellido, para no recorrer la lista con cada nombre. */
	private readonly bySurname = new Map<string, Indexed[]>()

	constructor(players: FidePlayer[]) {
		for (const player of players) {
			const comma = player.name.indexOf(',')
			if (comma === -1) continue
			const surnames = words(player.name.slice(0, comma))
			const given = words(player.name.slice(comma + 1))
			if (surnames.length === 0) continue
			const list = this.bySurname.get(surnames[0]) ?? []
			list.push({ ...player, surnames, given })
			this.bySurname.set(surnames[0], list)
		}
	}

	candidates(name: string): FidePlayer[] {
		const comma = name.indexOf(',')
		const splits: [string[], string[]][] =
			comma === -1
				? words(name).flatMap((_, k, all): [string[], string[]][] => (k > 0 ? [[all.slice(k), all.slice(0, k)]] : []))
				: [[words(name.slice(0, comma)), words(name.slice(comma + 1))]]
		const found = new Map<number, FidePlayer>()
		for (const [surnames, given] of splits) {
			// Sin nombre de pila no se cruza: «Garcia» a secas casaría con cualquiera.
			if (surnames.length === 0 || given.length === 0) continue
			for (const p of this.bySurname.get(surnames[0]) ?? []) {
				if (startsWith(surnames, p.surnames) && startsWith(given, p.given)) {
					found.set(p.fideId, { fideId: p.fideId, name: p.name, birthYear: p.birthYear })
				}
			}
		}
		return [...found.values()]
	}

	/** El jugador, si casa con uno solo y pudo jugar en `year`; si no, null. */
	match(name: string, year: number): FidePlayer | null {
		const found = this.candidates(name)
		if (found.length !== 1) return null
		const [player] = found
		return player.birthYear === null || player.birthYear <= year - MIN_AGE ? player : null
	}
}

export interface FcaPlayers {
	players: TournamentPlayer[]
	/** Nombre en el archivo → el del participante (el de la lista FIDE si se ha cruzado). */
	names: Map<string, string>
}

/**
 * Los participantes de un torneo del archivo: los jugadores de sus partidas,
 * con el nombre y el FIDE ID de la lista si se cruzan (FideMatcher.match). El
 * ELO, sólo si lo trae la partida (los de 2012): el de la lista es el de hoy.
 * Se numeran por ELO, como un ranking inicial; en la Liga, dentro de cada
 * equipo. Dos nombres del archivo que casan con el mismo jugador son uno.
 */
export function fcaParticipants(games: ParsedGame[], matcher: FideMatcher, year: number): FcaPlayers {
	const byKey = new Map<string, Omit<TournamentPlayer, 'startRank'>>()
	const names = new Map<string, string>()
	for (const game of games) {
		const headers = game.game.headers
		for (const color of ['White', 'Black'] as const) {
			const name = color === 'White' ? game.white : game.black
			if (names.has(name)) continue
			const fide = matcher.match(name, year)
			const key = fide ? `#${fide.fideId}` : playerKey(name)
			const player = byKey.get(key) ?? {
				name: fide?.name ?? name,
				fideId: fide?.fideId ?? null,
				title: null,
				rating: plausibleRating(Number.parseInt(headers.get(`${color}Elo`) ?? '', 10)),
				fed: fide ? 'ESP' : null,
				team: headers.get(`${color}Team`)?.trim() || null
			}
			byKey.set(key, player)
			names.set(name, player.name)
		}
	}
	const sorted = [...byKey.values()].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name, 'es'))
	const ranks = new Map<string, number>()
	const players = sorted.map((p) => {
		const team = p.team ?? ''
		const rank = (ranks.get(team) ?? 0) + 1
		ranks.set(team, rank)
		return { ...p, startRank: rank }
	})
	return { players, names }
}
