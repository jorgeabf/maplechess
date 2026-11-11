// El ejemplo de la portada (lib/db/ejemplo.ts): el dossier de uno de los
// primeros del ranking, resumido en tres tarjetas con las mismas funciones que
// el dossier. Se calcula tras los totales, al final de cada pasada de info64 o
// de lichess que guarda algo, de la lista FIDE (puede cambiar el n.º 1) y de
// cada reprocesado, y se guarda en sync_state. Como los totales, no tras las
// cargas de Cantabria y SICHESS: después de una, {"ejemplo":true}. En cada
// visita costaría 167 filas y de 23 a 51 ms de CPU (medido con el n.º 1 el
// 11-nov-2026).
import type { WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import { dossierClock, MIN_CLOCK_GAMES } from '../lib/chess/clock'
import { firstMoves, resultsByEloGap } from '../lib/chess/dossier'
import { indexPositions } from '../lib/chess/repertoire'
import { madridYear } from '../lib/dates'
import { EXAMPLE_KEY, EXAMPLE_VERSION, type DossierExample } from '../lib/db/ejemplo'
import { mayBeMinor, rankingQueries } from '../lib/db/players'
import { getPlayerGames, repertoireGames, type PlayerGame } from '../lib/db/repertoire'
import { saveSyncState } from './repo'

type ExampleSummary = Pick<DossierExample, 'first' | 'byElo' | 'timeClass' | 'clock'>

/**
 * Las tres tarjetas a partir de sus partidas con blancas, como las calcula su
 * dossier sin filtros. null si alguna no tendría nada que enseñar: sin jugadas
 * desde la inicial, sin rivales con ELO o con menos de MIN_CLOCK_GAMES con reloj.
 */
export function summarizeExample(games: PlayerGame[]): ExampleSummary | null {
	const first = firstMoves(indexPositions(repertoireGames(games), 'white'), 'white')
	const byElo = resultsByEloGap(games, 'white')
	const { timeClass, clock } = dossierClock(games, 'white')
	const rated = byElo.stronger.games + byElo.similar.games + byElo.weaker.games
	if (!first?.moves.length || rated === 0 || clock.games < MIN_CLOCK_GAMES) return null
	return { first, byElo, timeClass, clock }
}

/**
 * El primero de los diez del ranking (el de /jugadores) cuyas partidas con
 * blancas den para las tres tarjetas, sin quien puede ser menor, que no tiene
 * dossier, ni quien ha pedido no salir (portada_excluidos). Su puesto es el del
 * ranking: si se salta al n.º 1, el ejemplo es el n.º 2. null si no hay ninguno.
 */
export async function chooseExample(db: D1Database, year = madridYear(new Date())): Promise<DossierExample | null> {
	const { top, params } = rankingQueries('', year)
	const [ranking, excluded] = await Promise.all([
		db
			.prepare(top)
			.bind(...params)
			.all<{ fideId: number; birthYear: number | null }>(),
		db.prepare('SELECT fide_id AS fideId FROM portada_excluidos').all<{ fideId: number }>()
	])
	const skip = new Set(excluded.results.map((e) => e.fideId))
	for (const [i, player] of ranking.results.entries()) {
		if (skip.has(player.fideId) || mayBeMinor(player.birthYear, year)) continue
		const summary = summarizeExample(await getPlayerGames(db, player.fideId, 'white', {}, { clocks: true }))
		if (summary) return { v: EXAMPLE_VERSION, fideId: player.fideId, rank: i + 1, ...summary }
	}
	return null
}

/** Recalcula el ejemplo y lo guarda; sin ninguno, guarda null y la portada no lo enseña. */
export async function refreshExample(db: D1Database): Promise<{ fideId: number; rank: number } | null> {
	const example = await chooseExample(db)
	await saveSyncState(db, EXAMPLE_KEY, JSON.stringify(example))
	return example && { fideId: example.fideId, rank: example.rank }
}

/**
 * Un reintento y no los cinco de por defecto (desde 10 s, doblando): si falla,
 * la pasada sigue enseguida, también en cada ventana de una carga encadenada.
 * La portada se queda con el anterior hasta la pasada siguiente.
 */
const EXAMPLE_STEP: WorkflowStepConfig = {
	retries: { limit: 1, delay: '30 seconds', backoff: 'constant' },
	timeout: '2 minutes'
}

/** El paso que lo recalcula al final de una pasada. Si falla, la pasada sigue: sólo es la portada. */
export async function refreshExampleStep(step: WorkflowStep, db: D1Database, pass: string): Promise<void> {
	try {
		const example = await step.do('ejemplo', EXAMPLE_STEP, () => refreshExample(db))
		console.log(`[${pass}] ejemplo: ${JSON.stringify(example)}`)
	} catch (error) {
		console.warn(`[${pass}] ejemplo: ${String(error)}`)
	}
}
