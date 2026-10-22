import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Los tests corren dentro de workerd (Miniflare), con HTMLRewriter y un D1
// propio por fichero de test. No se carga src/worker.ts: arrastra el handler de
// Astro, que sólo existe tras el build. Los tests importan los módulos que
// prueban y los bindings se declaran aquí.
export default defineConfig(async () => {
	const migrations = await readD1Migrations('migrations')

	return {
		plugins: [
			cloudflareTest({
				miniflare: {
					compatibilityDate: '2026-10-01',
					compatibilityFlags: ['nodejs_compat'],
					d1Databases: ['DB'],
					// El límite de ritmo, encendido y con los números de wrangler.jsonc.
					ratelimits: { RATE_LIMITER: { namespace_id: '26102201', simple: { limit: 30, period: 60 } } },
					bindings: { TEST_MIGRATIONS: migrations, RATE_LIMIT: 'on' }
				}
			})
		],
		test: {
			setupFiles: ['./test/apply-migrations.ts']
		}
	}
})
