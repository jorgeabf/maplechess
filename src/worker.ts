// Entrypoint del Worker: la web (Astro), las tareas programadas y las clases
// de los Workflows de ingesta, que Cloudflare busca entre los exports.
import { handle } from '@astrojs/cloudflare/handler'
import { runScheduled } from './ingest/schedule'

export { FcaImportWorkflow } from './ingest/fca/sync'
export { FideSyncWorkflow } from './ingest/fide/sync'
export { Info64SyncWorkflow } from './ingest/info64/sync'
export { LichessSyncWorkflow } from './ingest/lichess/sync'
export { GamesReprocessWorkflow } from './ingest/reprocess'

export default {
	fetch: handle,
	async scheduled(controller, env) {
		await runScheduled(controller, env)
	}
} satisfies ExportedHandler<Env>
