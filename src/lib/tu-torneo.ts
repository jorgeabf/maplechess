// «Tú» en la página de un torneo (cookie yo; ver lib/me.ts): dónde estás en
// él, para marcar tu fila y llevarte a ella desde arriba. Sin lecturas de D1:
// sale de la clasificación, los participantes y la próxima ronda, que la
// página ya ha leído. Siempre por el FIDE ID: un homónimo sin él no se
// confunde contigo, y un jugador retirado ya no lo lleva.
import { formatPlace } from './format'

interface StandingLike {
	pos: number
	startRank: number
	/** El jugador o, en un torneo por equipos, el equipo. */
	name: string | null
	fideId: number | null
}

interface ParticipantLike {
	fideId: number | null
	team: string | null
	startRank: number
}

interface PairingLike {
	board: number
	white: { fideId: number | null }
	black: { fideId: number | null }
}

export interface MyPlace {
	/** Estás entre sus jugadores: tiene sentido «Mis partidas». */
	member: boolean
	/** Tu equipo, en un torneo por equipos: su fila de la clasificación y su plantilla, abierta. */
	team: string | null
	/** Dónde está la fila a la que lleva `label` (la que lleva id="tu"). */
	target: 'clasificacion' | 'participantes' | 'plantilla' | null
	/**
	 * El número inicial de esa fila, en la clasificación o en los
	 * participantes: sólo ella se marca. Dos equipos pueden llamarse igual, y
	 * se queda el de mejor puesto, como en la ficha.
	 */
	startRank: number | null
	/** «Tu puesto: 20.º de 66», «Tu número inicial: 23 de 80», «Tu equipo: Danubio, 3.º de 10». */
	label: string | null
	/** Tu mesa en la próxima ronda, si ya está emparejada. */
	board: number | null
}

/**
 * Dónde estás en el torneo, o null si no juegas en él. `numbered`: el número
 * inicial es el del torneo. Los propios de lichess y los del archivo de la FCA
 * van numerados por ELO (en la FCA, casi siempre sin él: por el nombre), y
 * no se dice. En uno individual con clasificación no se leen los
 * participantes: cada fila de la clasificación es uno de ellos. Las filas
 * van por puesto, así que `find` da la mejor.
 */
export function myPlace(
	me: number | null,
	tournament: { isTeam: boolean; numbered: boolean },
	standings: readonly StandingLike[] | null,
	participants: readonly ParticipantLike[],
	pairings: readonly PairingLike[]
): MyPlace | null {
	if (me === null) return null
	const board = pairings.find((p) => p.white.fideId === me || p.black.fideId === me)?.board ?? null
	const none: MyPlace = { member: false, team: null, target: null, startRank: null, label: null, board }

	if (tournament.isTeam) {
		const participant = participants.find((p) => p.fideId === me)
		if (!participant) return board === null ? null : none
		// Los sin equipo de una retransmisión de lichess: tu fila se marca, sin nada arriba.
		const team = participant.team
		if (team === null) return { ...none, member: true }
		const row = standings?.find((s) => s.name === team)
		return row && standings
			? {
					...none,
					member: true,
					team,
					target: 'clasificacion',
					startRank: row.startRank,
					label: `Tu equipo: ${team}, ${formatPlace(row.pos)} de ${standings.length}`
				}
			: { ...none, member: true, team, target: 'plantilla', label: `Tu equipo: ${team}` }
	}

	const standing = standings?.find((s) => s.fideId === me)
	if (standing && standings) {
		return {
			...none,
			member: true,
			target: 'clasificacion',
			startRank: standing.startRank,
			label: `Tu puesto: ${formatPlace(standing.pos)} de ${standings.length}`
		}
	}
	const participant = participants.find((p) => p.fideId === me)
	if (participant) {
		return {
			...none,
			member: true,
			target: 'participantes',
			startRank: participant.startRank,
			label: tournament.numbered ? `Tu número inicial: ${participant.startRank} de ${participants.length}` : null
		}
	}
	return board === null ? null : none
}
