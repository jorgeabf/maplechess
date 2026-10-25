// El encuentro de cada partida de un torneo por equipos, de sus plantillas:
// la página del torneo ya las lee, así que no hace falta otra consulta.
import type { GameListRow } from './db/games'
import type { TournamentParticipant } from './db/tournaments'

type Game = Pick<GameListRow, 'id' | 'round' | 'whiteFideId' | 'blackFideId' | 'whiteName' | 'blackName'>
type Member = Pick<TournamentParticipant, 'team' | 'fideId' | 'name'>

/**
 * Los dos equipos del encuentro de cada partida, por su id. El equipo de cada
 * jugador sale de su FIDE ID y, sin él, de su nombre. Los dos van en el orden
 * de la primera partida del encuentro que llega (las partidas van por ronda y
 * mesa): blancas primero en su primer tablero, el equipo que se nombra antes,
 * y el mismo orden en todas sus partidas, aunque los colores se alternen.
 *
 * Una partida no tiene encuentro si falta el equipo de algún jugador o si los
 * dos son del mismo. Un FIDE ID o un nombre que está en dos equipos («Jugador
 * retirado», un homónimo) no dice de cuál es.
 */
export function gameMatches(games: readonly Game[], members: readonly Member[]): Map<number, readonly [string, string]> {
	const byId = new Map<number, string | null>()
	const byName = new Map<string, string | null>()
	const add = <K>(map: Map<K, string | null>, key: K, team: string) =>
		map.set(key, map.has(key) && map.get(key) !== team ? null : team)
	for (const m of members) {
		if (!m.team) continue
		if (m.fideId !== null) add(byId, m.fideId, m.team)
		add(byName, m.name, m.team)
	}
	const teamOf = (fideId: number | null, name: string) =>
		(fideId !== null && byId.has(fideId) ? byId.get(fideId) : byName.get(name)) ?? null

	const pairs = new Map<string, readonly [string, string]>()
	const matches = new Map<number, readonly [string, string]>()
	for (const game of games) {
		const white = teamOf(game.whiteFideId, game.whiteName)
		const black = teamOf(game.blackFideId, game.blackName)
		if (!white || !black || white === black) continue
		const key = JSON.stringify([game.round, ...[white, black].sort()])
		const pair = pairs.get(key) ?? ([white, black] as const)
		pairs.set(key, pair)
		matches.set(game.id, pair)
	}
	return matches
}
