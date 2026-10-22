// Importación mensual de los jugadores españoles de la lista FIDE.
//
// El zip pesa ~45 MB y descomprimido ~320 MB: no cabe en los 128 MB de un
// Worker, así que se descarga y descomprime en streaming (fflate) y sólo se
// guardan en memoria los ~100.000 jugadores ESP.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers'
import { Unzip, UnzipInflate } from 'fflate'
import { isoDate } from '../../lib/dates'
import { FIDE_LIST_KEY } from '../../lib/db/players'
import { saveHealth } from '../../lib/salud'
import { fetchOk } from '../http'
import { loadSyncState, refreshTotals, saveSyncState, upsertFidePlayers } from '../repo'
import { FideListParser, type FidePlayer } from './parse'

export const FIDE_LIST_URL = 'https://ratings.fide.com/download/players_list.zip'
const FEDERATION = 'ESP'

export interface FideSyncParams {
	/** Importa aunque el fichero no haya cambiado desde la última vez. */
	force?: boolean
}

const STEP: WorkflowStepConfig = {
	retries: { limit: 3, delay: '5 minutes', backoff: 'exponential' },
	timeout: '15 minutes'
}

export class FideSyncWorkflow extends WorkflowEntrypoint<Env, FideSyncParams> {
	async run(event: WorkflowEvent<FideSyncParams>, step: WorkflowStep): Promise<void> {
		const db = this.env.DB
		const lastModified = await step.do('comprobar', STEP, async () => {
			const response = await fetchOk(FIDE_LIST_URL, { method: 'HEAD' })
			return response.headers.get('Last-Modified')
		})
		const previous = await step.do('estado', () => loadSyncState(db, FIDE_LIST_KEY))
		if (!event.payload?.force && lastModified && lastModified === previous) {
			console.log(`[fide] sin cambios desde ${previous}`)
			await step.do('salud', () => saveHealth(db, 'fide', { ok: 0, fallos: 0, avisos: 0 }))
			return
		}
		// La lista es la del mes de la importación (el cron va el día 3), no la del
		// Last-Modified: FIDE regenera el fichero a mitad de mes sin cambiar los ELO,
		// y un force entonces contaría como lista nueva. La hora de la instancia no
		// cambia entre reintentos.
		const period = isoDate(event.timestamp).slice(0, 7)
		try {
			const summary = await step.do('importar', STEP, () => importFideList(db, lastModified, period))
			console.log(`[fide] ${JSON.stringify(summary)}`)
		} catch (error) {
			// Tras sus reintentos: que /api/estado lo diga ya, y no a los 35 días.
			await step.do('salud con fallos', () => saveHealth(db, 'fide', { ok: 0, fallos: 1, avisos: 0 }))
			throw error
		}
		await step.do('totales', () => refreshTotals(db))
		await step.do('salud', () => saveHealth(db, 'fide', { ok: 1, fallos: 0, avisos: 0 }))
	}
}

async function downloadPlayers(fed: string): Promise<FidePlayer[]> {
	const response = await fetchOk(FIDE_LIST_URL)
	if (!response.body) throw new Error('Lista FIDE: respuesta sin cuerpo')

	const players: FidePlayer[] = []
	const parser = new FideListParser(fed, (p) => players.push(p))
	let files = 0

	const unzip = new Unzip()
	unzip.register(UnzipInflate)
	unzip.onfile = (file) => {
		files++
		file.ondata = (err, chunk, final) => {
			if (err) throw err
			parser.push(chunk)
			if (final) parser.end()
		}
		file.start()
	}

	const reader = response.body.getReader()
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		unzip.push(value)
	}
	unzip.push(new Uint8Array(0), true)
	if (files !== 1) throw new Error(`Lista FIDE: se esperaba un fichero en el zip y hay ${files}`)
	return players
}

async function importFideList(
	db: D1Database,
	lastModified: string | null,
	period: string
): Promise<{ players: number; removed: number }> {
	const players = await downloadPlayers(FEDERATION)

	// Antes de borrar a quien no aparezca, comprobar que el fichero está entero.
	const current = await db.prepare('SELECT count(*) AS n FROM players').first<{ n: number }>()
	if (current && players.length < current.n * 0.9) {
		throw new Error(`Lista FIDE: sólo ${players.length} jugadores ${FEDERATION} frente a ${current.n} guardados`)
	}

	const seenAt = new Date().toISOString()
	await upsertFidePlayers(db, players, period, seenAt)

	// Quien ya no está en la lista como ESP (cambio de federación, baja).
	const removed = await db.prepare('DELETE FROM players WHERE seen_at <> ?1').bind(seenAt).run()
	if (lastModified) await saveSyncState(db, FIDE_LIST_KEY, lastModified)
	return { players: players.length, removed: removed.meta.changes }
}
