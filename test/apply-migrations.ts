import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// Se ejecuta antes de cada fichero de test; applyD1Migrations sólo aplica las
// migraciones pendientes, así que es idempotente.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
