// Campeonatos de España de los que info64 no publica partidas y sí están en
// SICHESS (https://sichess.com/web/feda/), donde la FEDA retransmite sus
// campeonatos. La FEDA no puso inconveniente (noviembre de 2026).
//
// La lista va a mano, una sola vez: en 2026 todo llega ya por info64 o lichess
// y no aporta nada. Son las 2.719 partidas con jugadas medidas el 6-nov-2026,
// de torneos que no tenían ninguna. No entran los de jóvenes ni las selecciones
// autonómicas (sus posibles menores no tienen dossier ni repertorio) ni el
// Inclusivo (torneos sensibles).
//
// El visor saca las rutas de una configuración ofuscada en 2023 y 2024: se
// escriben aquí para que el Worker no tenga que evaluarla.
import { SICHESS_SITE } from '../../lib/urls'

export interface SichessTournament {
	/** source_key en info64: el torneo ya está guardado. */
	key: string
	/** Página del visor: la que se enlaza desde el torneo y la partida. */
	viewer: string
	/** Los PGN del torneo: uno por ronda o, por equipos, uno por encuentro. */
	files: string[]
}

const number = (n: number): string => String(n).padStart(2, '0')

const roundNumbers = (rounds: number): number[] => Array.from({ length: rounds }, (_, i) => i + 1)

/** Un PGN por ronda: «…/01/games.pgn». */
const byRound = (path: string, rounds: number): string[] =>
	roundNumbers(rounds).map((round) => `${SICHESS_SITE}${path}/${number(round)}/games.pgn`)

/** Un PGN por encuentro de cada ronda: «…/01/games1.pgn». */
const byMatch = (path: string, rounds: number, matches: number): string[] =>
	roundNumbers(rounds).flatMap((round) =>
		roundNumbers(matches).map((match) => `${SICHESS_SITE}${path}/${number(round)}/games${match}.pgn`)
	)

const tournament = (key: string, viewer: string, files: string[]): SichessTournament => ({
	key,
	viewer: `${SICHESS_SITE}${viewer}`,
	files
})

export const SICHESS_TOURNAMENTS: SichessTournament[] = [
	tournament('ce-rapido-2023', 'feda/rapidas2023/', byRound('feda/rapido2023', 10)),
	tournament('campeonato-de-espana-de-aficionados-2023-tramo-2300', 'feda/aficion2023/', byRound('feda/afi2300', 9)),
	tournament('campeonato-de-espana-de-aficionados-2023-tramo-2000', 'feda/aficion2023/', byRound('feda/afi2000', 9)),
	tournament('campeonato-de-espana-de-aficionados-2023-tramo-1700', 'feda/aficion2023/', byRound('feda/afi1700', 9)),
	tournament('team/ce-ceclub-division-de-honor-2023', 'feda/ceclub_dh2023/ronda_1.html', byMatch('feda/ceclub_honor', 7, 4)),
	tournament('team/ce-rapido-por-equipos-2023-337129', 'feda/ceclubrapidas23/', byRound('feda/ceclub_rapido', 9)),
	tournament('ce-individual-absoluto-y-femenino-2023', 'feda/absoluto2023/', byRound('feda/marbella', 9)),
	tournament('ce-relampago-2024', 'torneos/feda24/relampago/', byRound('games/feda/2024/relam', 11)),
	tournament('ce-rapido-2024', 'torneos/feda24/rapido/', byRound('games/feda/2024/rapid', 10)),
	tournament('team/ceclub-primera-division-381897', 'torneos/feda24/1divi/r7.html', byMatch('games/feda/2024/1divi', 7, 4)),
	tournament(
		'team/campeonato-de-espana-de-ajedrez-rapido-por-equipos-de-club-2024',
		'torneos/feda24/equirapid/',
		byRound('games/feda/2024/equirap', 7)
	),
	tournament('ce-veteranos-2024-m65', 'torneos/feda24/veteranos/mas65.html', byRound('games/feda/2024/veter65', 9)),
	tournament('team/ceclub-primera-division-1', 'torneos/feda25/1divi/R7.html', byMatch('games/feda/2025/1divi', 7, 4)),
	tournament('team/ce-equipos-ajedrez-rapido-2025', 'torneos/feda25/rapido_equi/', byRound('games/feda/2025/rapidteam', 7))
]
