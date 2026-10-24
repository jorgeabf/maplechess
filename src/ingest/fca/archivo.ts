// Archivo de partidas de la Federación Cántabra de Ajedrez (FCA,
// https://www.fcajedrez.es/partidas/): PGN estáticos de la Liga Regional y los
// campeonatos regionales de 2007 a 2010, de 2012 y de 2021, con licencia CC BY
// 4.0 (ver CC_BY en lib/licenses.ts). Cada archivo junta varios torneos: uno por
// cabecera Event. Medido el 24-oct-2026: 2.861 partidas; sin las categorías
// hasta Sub 14 y sin repetidas, 2.683 en 46 torneos. Ninguno está en info64.
import { normalizeName, words } from '../../lib/chess/names'
import { parseGames, type ParsedGame } from '../../lib/chess/pgn'
import { FCA_SITE } from '../../lib/urls'
import type { TournamentType } from '../info64/parse'

export interface FcaFile {
	/** Ruta bajo assets/partidas/, sin «.pgn». */
	path: string
	/** Temporada que da la página del archivo («2007/08»), para el nombre de los torneos que no la llevan. */
	season: string
}

/**
 * Los archivos que se importan, en el orden de la página. Los de Sub 12 y Sub
 * 14 de 2012 no están: no se piden. Los demás también traen torneos de menores
 * (los regionales por edades), que se quitan por el nombre (isMinorsTournament).
 */
export const FCA_FILES: FcaFile[] = [
	{ path: '2007/liga_2007', season: '2007/08' },
	{ path: '2008/liga_2008', season: '2008/09' },
	{ path: '2009/liga_2009', season: '2009/10' },
	{ path: '2007/regionales_2007', season: '2007/08' },
	{ path: '2008/regionales_2008', season: '2008/09' },
	{ path: '2009/regionales_2009', season: '2009/10' },
	{ path: '2012/veteranos', season: '2012/13' },
	{ path: '2012/sub18m', season: '2012/13' },
	{ path: '2012/sub18f', season: '2012/13' },
	{ path: '2012/sub16m', season: '2012/13' },
	{ path: '2021/regional_absoluto_2021', season: '2021' },
	{ path: '2021/edades-veteranos-2021', season: '2021' }
]

/** El PGN del archivo. */
export const fcaFileUrl = (path: string): string => `${FCA_SITE}assets/partidas/${path}.pgn`

/** La página del archivo con su visor: la que se enlaza desde el torneo. */
export const fcaPageUrl = (path: string): string => `${FCA_SITE}partidas/index.html?pgn=/assets/partidas/${path}.pgn`

export interface FcaTournament {
	/** source_key: el archivo y el evento («2008/liga_2008/liga-regional-primera-division»). */
	key: string
	name: string
	type: TournamentType
	city: string | null
	startDate: string | null
	endDate: string | null
	/** Año de las partidas, para ver si un jugador podía jugarlas (jugadores.ts). */
	year: number
	games: ParsedGame[]
}

/** Sin los espacios repetidos de la fuente («Pedro  Corral Saiz»). */
export const clean = (text: string): string => text.replace(/\s+/g, ' ').trim()

const hasName = (name: string): boolean => name !== '' && name !== '?'

/**
 * El nombre del torneo: el Event del archivo, con la temporada si no lleva un
 * año, y Cantabria si no la nombra, para que se encuentre al buscar por sitio
 * («Liga Regional - Primera Division 2008/09 (Cantabria)»).
 */
export function tournamentName(event: string, season: string): string {
	const withSeason = /\b(?:19|20)\d\d\b|\b\d\d\/\d\d\b/.test(event) ? event : `${event} ${season}`
	return /cantabri/i.test(event) ? withSeason : `${withSeason} (Cantabria)`
}

/**
 * Los torneos de un archivo, uno por Event. Cada partida lleva en la cabecera
 * Source el archivo del que sale, que da su aviso de licencia (fcaUrl). Las que
 * no traen los dos jugadores se descartan.
 */
export function fcaTournaments(file: FcaFile, pgnText: string): FcaTournament[] {
	const byEvent = new Map<string, ParsedGame[]>()
	for (const game of parseGames(pgnText)) {
		const white = clean(game.white)
		const black = clean(game.black)
		if (!hasName(white) || !hasName(black)) continue
		game.game.headers.set('Source', fcaFileUrl(file.path))
		const event = clean(game.game.headers.get('Event') ?? '')
		byEvent.set(event, [...(byEvent.get(event) ?? []), { ...game, white, black }])
	}
	return [...byEvent].map(([event, games]) => {
		const dates = games.flatMap((g) => (g.date ? [g.date] : [])).sort()
		const site = games.map((g) => clean(g.game.headers.get('Site') ?? '')).find(hasName)
		const teams = games.every((g) => g.game.headers.get('WhiteTeam') && g.game.headers.get('BlackTeam'))
		return {
			key: `${file.path}/${words(event).join('-')}`,
			name: tournamentName(event, file.season),
			type: teams ? 'team' : 'individual',
			city: site ?? 'Cantabria',
			startDate: dates[0] ?? null,
			endDate: dates[dates.length - 1] ?? null,
			year: Number((dates[0] ?? file.season).slice(0, 4)),
			games
		}
	})
}

/** Clave de un jugador del archivo: su nombre en forma canónica. */
export const playerKey = (name: string): string => normalizeName(name)
