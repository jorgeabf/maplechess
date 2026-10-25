// Workflow FCA_IMPORT: importa el archivo de partidas de la Federación Cántabra
// de Ajedrez (archivo.ts). Se lanza a mano (`{"workflow":"fca"}`), sin cron:
// el archivo no cambia desde abril de 2024. Relanzarlo no duplica nada, porque
// cada torneo va por su clave y saveGames conserva los id de las partidas.
//
// Guarda como los torneos propios de lichess (lichess/sync.ts): las mismas
// funciones de repo.ts quitan el año de los menores de los nombres y aplican
// las retiradas, las ocultaciones y las rectificaciones. Los torneos de
// menores (por el nombre) y los marcados en torneos_sensibles no se guardan.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers'
import { buildGameRows } from '../games'
import { fetchText } from '../http'
import { isMinorsTournament } from '../menores'
import { loadExcluded, proposeSensitive, replaceParticipations, saveGames, upsertTournament } from '../repo'
import { looksSensitive } from '../sensibles'
import { FCA_FILES, fcaFileUrl, fcaPageUrl, fcaTournaments, type FcaFile } from './archivo'
import { fcaParticipants, FideMatcher, type FidePlayer } from './jugadores'

const SOURCE = 'fca'

export interface FcaImportParams {
	/** Sólo estos archivos (FcaFile.path); sin él, todos. */
	files?: string[]
}

export interface FcaFileSummary {
	tournaments: number
	games: number
	/** Participantes con FIDE ID, de todos. */
	linked: number
	players: number
	/** Torneos cuya relectura no se guarda (la guarda de saveGames). */
	avisos: number
}

const FILE_STEP: WorkflowStepConfig = {
	retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
	timeout: '5 minutes'
}

/** Entre archivo y archivo, como con info64: es el servidor de una federación. */
const PAUSE = '1 second'

export class FcaImportWorkflow extends WorkflowEntrypoint<Env, FcaImportParams> {
	async run(event: WorkflowEvent<FcaImportParams>, step: WorkflowStep): Promise<void> {
		const only = event.payload?.files
		const files = only ? FCA_FILES.filter((f) => only.includes(f.path)) : FCA_FILES
		const totals: FcaFileSummary = { tournaments: 0, games: 0, linked: 0, players: 0, avisos: 0 }
		for (const [i, file] of files.entries()) {
			if (i > 0) await step.sleep(`pausa ${file.path}`, PAUSE)
			const summary = await step.do(`archivo ${file.path}`, FILE_STEP, async () =>
				importFile(this.env.DB, file, await fetchText(fcaFileUrl(file.path)), new Date().toISOString())
			)
			for (const k of Object.keys(totals) as (keyof FcaFileSummary)[]) totals[k] += summary[k]
		}
		console.log(`[fca] ${files.length} archivos: ${JSON.stringify(totals)}`)
	}
}

/**
 * La lista FIDE española entera (unas 98.000 filas), para cruzar los nombres.
 * Se lee una vez por archivo: una importación son unos 1,2 millones de filas,
 * y sólo se lanza a mano.
 */
async function loadFidePlayers(db: D1Database): Promise<FidePlayer[]> {
	const { results } = await db
		.prepare('SELECT fide_id AS fideId, name, birth_year AS birthYear FROM players')
		.all<FidePlayer>()
	return results
}

/** Guarda los torneos de un archivo ya descargado. */
export async function importFile(db: D1Database, file: FcaFile, pgnText: string, now: string): Promise<FcaFileSummary> {
	const summary: FcaFileSummary = { tournaments: 0, games: 0, linked: 0, players: 0, avisos: 0 }
	const excluded = await loadExcluded(db, SOURCE)
	const tournaments = fcaTournaments(file, pgnText).filter(
		(t) => !excluded.has(t.key) && !isMinorsTournament(t.name, t.startDate)
	)
	if (tournaments.length === 0) return summary
	const matcher = new FideMatcher(await loadFidePlayers(db))
	const url = fcaPageUrl(file.path)

	for (const t of tournaments) {
		const { players, names } = fcaParticipants(t.games, matcher, t.year)
		// Con el nombre del participante, buildGameRows los cruza sin dudas.
		const games = t.games.map((g) => ({ ...g, white: names.get(g.white) ?? g.white, black: names.get(g.black) ?? g.black }))
		const rows = buildGameRows(games, players, { name: t.name, city: t.city, startDate: t.startDate, timeControl: null })
		const id = await upsertTournament(db, {
			source: SOURCE,
			key: t.key,
			type: t.type,
			name: t.name,
			city: t.city,
			startDate: t.startDate,
			endDate: t.endDate,
			timeControl: null,
			url,
			syncedAt: now
		})
		if (looksSensitive(t.name)) await proposeSensitive(db, [{ source: SOURCE, key: t.key, name: t.name }])
		// Primero las partidas: si la guarda de saveGames conserva las guardadas,
		// los participantes tampoco cambian.
		if (!(await saveGames(db, id, rows, now, { name: SOURCE, url }))) {
			console.warn(`[fca] ${t.key}: la lectura trae menos de la mitad de las partidas guardadas; se conservan`)
			summary.avisos++
			continue
		}
		await replaceParticipations(db, id, players)
		summary.tournaments++
		summary.games += rows.length
		summary.players += players.length
		summary.linked += players.filter((p) => p.fideId !== null).length
	}
	return summary
}
