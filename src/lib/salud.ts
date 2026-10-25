// Salud de la ingesta. Al terminar, cada pasada guarda en sync_state cuándo
// acabó y cuántos torneos fueron bien o fallaron, y cuántos avisos dejaron las
// guardas. /api/estado lo lee y .github/workflows/vigilancia.yml lo consulta dos
// veces al día: si una pasada lleva demasiado sin terminar o falla en muchos
// torneos, la acción falla y GitHub manda un correo. También si queda algún
// torneo que parece sensible por revisar (hasSensitivePending) o alguna
// rectificación sin aplicar (hasRectificationsPending).
//
// Los Workflows escriben con saveHealth, también cuando no hay nada que hacer
// (la lista FIDE sin cambios). Mientras una pasada no haya escrito nunca, su
// estado es «sin datos», que no es una alarma.

/** Pasadas vigiladas. La diaria de info64 escribe también la de emparejamientos. */
export const HEALTH_RUNS = ['info64', 'emparejamientos', 'lichess', 'fide'] as const
export type HealthRun = (typeof HEALTH_RUNS)[number]

/** Recuento de una pasada. `ok` y `fallos` no se solapan; los avisos van aparte. */
export interface HealthCounts {
	/** Torneos (en la FIDE, la lista) procesados sin error, aunque dejen avisos. */
	ok: number
	/** Torneos cuyo procesado lanzó un error: se registró y la pasada siguió con los demás. */
	fallos: number
	/** Lecturas vacías o parciales que una guarda no dejó guardar. Un torneo puede dejar varios. */
	avisos: number
}

/** Valor de la clave de cada pasada: el recuento y su fin (ISO 8601). */
export interface RunHealth extends HealthCounts {
	fin: string
}

/** Lo que /api/estado dice de cada pasada. «caducada» y «con fallos» son alarmas. */
export type HealthStatus = 'ok' | 'caducada' | 'con fallos' | 'sin datos'

/** Clave de sync_state de una pasada: `salud.info64`, `salud.emparejamientos`… */
export function healthKey(run: HealthRun): string {
	return `salud.${run}`
}

const HOUR_MS = 3_600_000

/**
 * Tiempo máximo desde el fin de la última pasada. Llevan margen sobre el
 * intervalo de cada una, para que una pasada larga o el cambio de hora no den
 * una falsa alarma:
 * - info64 (00:00 UTC) y lichess (06:30 UTC): diarias;
 * - emparejamientos: los escribe la diaria de info64;
 * - FIDE: el día 3 de cada mes.
 */
export const MAX_AGE_MS: Record<HealthRun, number> = {
	info64: 26 * HOUR_MS,
	emparejamientos: 26 * HOUR_MS,
	lichess: 26 * HOUR_MS,
	fide: 35 * 24 * HOUR_MS
}

/** Parte de los torneos de una pasada que puede fallar sin dar la alarma. */
export const MAX_FAILED_SHARE = 0.2

function isCount(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0
}

function parseHealth(value: string): RunHealth | null {
	let health: Partial<RunHealth>
	try {
		health = JSON.parse(value)
	} catch {
		return null
	}
	const valid =
		typeof health?.fin === 'string' &&
		!Number.isNaN(Date.parse(health.fin)) &&
		isCount(health.ok) &&
		isCount(health.fallos) &&
		isCount(health.avisos)
	return valid ? (health as RunHealth) : null
}

/** Estado de una pasada a partir de su valor en sync_state (null si no está). */
export function runStatus(run: HealthRun, value: string | null, now: Date): HealthStatus {
	if (value === null) return 'sin datos'
	const health = parseHealth(value)
	// Un valor que no se entiende es un fallo de quien lo escribe: mejor una
	// alarma que un «sin datos» que lo esconda para siempre.
	if (!health) return 'con fallos'
	if (now.getTime() - Date.parse(health.fin) > MAX_AGE_MS[run]) return 'caducada'
	const processed = health.ok + health.fallos
	if (processed > 0 && health.fallos / processed > MAX_FAILED_SHARE) return 'con fallos'
	return 'ok'
}

/** Si el estado de una pasada es una alarma. */
export function isAlarm(status: HealthStatus): boolean {
	return status === 'caducada' || status === 'con fallos'
}

/** Estado de cada pasada. Lee sólo sus claves de sync_state, por la clave primaria. */
export async function loadHealth(db: D1Database, now = new Date()): Promise<Record<HealthRun, HealthStatus>> {
	const { results } = await db
		.prepare('SELECT key, value FROM sync_state WHERE key IN (SELECT value FROM json_each(?1))')
		.bind(JSON.stringify(HEALTH_RUNS.map(healthKey)))
		.all<{ key: string; value: string }>()
	const values = new Map(results.map((r) => [r.key, r.value]))
	return Object.fromEntries(
		HEALTH_RUNS.map((run) => [run, runStatus(run, values.get(healthKey(run)) ?? null, now)])
	) as Record<HealthRun, HealthStatus>
}

/**
 * ¿Queda algún torneo por revisar en torneos_sensibles? La ingesta y el
 * reprocesado apuntan los que lo parecen por el nombre y, hasta que se decide a
 * mano, se guardan como los demás: es una alarma.
 */
export async function hasSensitivePending(db: D1Database): Promise<boolean> {
	return (await db.prepare('SELECT 1 FROM torneos_sensibles WHERE excluido IS NULL LIMIT 1').first()) !== null
}

/**
 * ¿Hay alguna rectificación sin aplicar? Lo está la recién apuntada, hasta que
 * se relee su torneo, y la que la última lectura no ha encontrado: la fuente lo
 * ha corregido o ha cambiado el dato, y el error puede haber vuelto. Es una
 * alarma.
 */
export async function hasRectificationsPending(db: D1Database): Promise<boolean> {
	return (await db.prepare('SELECT 1 FROM rectificaciones WHERE aplicada IS NULL LIMIT 1').first()) !== null
}

/** Guarda la salud de una pasada al terminar. `fin` es ahora, salvo en los tests. */
export async function saveHealth(
	db: D1Database,
	run: HealthRun,
	counts: HealthCounts,
	end = new Date()
): Promise<void> {
	const fin = end.toISOString()
	const health: RunHealth = { fin, ok: counts.ok, fallos: counts.fallos, avisos: counts.avisos }
	await db
		.prepare(
			`INSERT INTO sync_state (key, value, updated_at) VALUES (?1, ?2, ?3)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
		)
		.bind(healthKey(run), JSON.stringify(health), fin)
		.run()
}
