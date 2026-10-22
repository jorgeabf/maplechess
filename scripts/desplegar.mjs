// Despliegue a producción: `pnpm run deploy` (sin «run», pnpm ejecuta su propio
// «deploy»). Lo opera sólo Jorge. En orden:
// 1. Se niega si el árbol tiene cambios, si HEAD no es origin/main tras un
//    fetch o si es la ventana de un cron: la media hora que sigue a cada
//    expresión de wrangler.jsonc, para no desplegar a mitad de una pasada.
// 2. copy-engine: public/engine/ no se versiona y `git pull` no ejecuta el
//    postinstall.
// 3. Apunta en despliegues.log (ignorado por git, como todos los .log) la
//    hora, el commit y el marcador de Time Travel de D1, para restaurarla si
//    hiciera falta (ver CLAUDE.md).
// 4. pnpm build y wrangler deploy.
// 5. scripts/humo.mjs contra producción.
//
// Con --comprobar sólo hace las comprobaciones del paso 1. Con
// --comprobar=<fecha ISO>, la del cron como si fuera esa hora:
//
//   pnpm run deploy --comprobar=2026-10-23T05:10Z
//
// Todo se lanza sin shell. pnpm, con el ejecutable que deja en npm_execpath:
// en Windows, `pnpm` es un .cmd, que Node no ejecuta sin shell.
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOG = join(root, 'despliegues.log')
const DATABASE = 'ajedrez'
/** Minutos, desde que salta un cron, en los que no se despliega. */
const CRON_WINDOW_MIN = 30

function fail(message) {
	console.error(`[desplegar] ${message}`)
	process.exit(1)
}

function step(message) {
	console.log(`\n[desplegar] ${message}`)
}

/** Ejecuta un comando sin shell. Con `capture` devuelve su salida; si no, la muestra. Si falla, para. */
function run(command, args, { capture = false } = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: 'utf8',
		stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit'
	})
	if (result.error) fail(`${basename(command)} ${args.join(' ')}: ${result.error.message}`)
	if (result.status !== 0) fail(`${basename(command)} ${args.join(' ')} ha salido con ${result.status}`)
	return result.stdout?.trim() ?? ''
}

/**
 * pnpm tal como lo ha lanzado `pnpm run deploy`: un .js (corepack, npm) que va
 * con node, o un ejecutable. null si no lo ha lanzado pnpm.
 */
function pnpmCommand() {
	const execPath = process.env.npm_execpath
	if (!execPath || !/pnpm/i.test(basename(execPath))) return null
	return /\.[cm]?js$/.test(execPath) ? [process.execPath, execPath] : [execPath]
}

/** ¿Ha saltado `cron` (`*` o listas de números, en UTC) en los últimos CRON_WINDOW_MIN minutos? */
function inCronWindow(cron, now) {
	const fields = cron.split(/\s+/).map((field) => (field === '*' ? null : field.split(',').map(Number)))
	if (fields.length !== 5 || fields.some((field) => field?.some((n) => !Number.isInteger(n)))) {
		fail(`no entiendo el cron «${cron}»: sólo admito * y listas de números`)
	}
	for (let back = 0; back < CRON_WINDOW_MIN; back++) {
		const t = new Date(now.getTime() - back * 60_000)
		const values = [t.getUTCMinutes(), t.getUTCHours(), t.getUTCDate(), t.getUTCMonth() + 1, t.getUTCDay()]
		if (fields.every((field, i) => field === null || field.includes(values[i]))) return true
	}
	return false
}

/** Motivos para no desplegar a la hora `now`; vacío si se puede. */
async function refusals(now) {
	const reasons = []
	if (run('git', ['status', '--porcelain'], { capture: true })) {
		reasons.push('el árbol tiene cambios sin commitear o archivos sin seguimiento (git status)')
	}
	run('git', ['fetch', '--quiet', 'origin'])
	const head = run('git', ['rev-parse', 'HEAD'], { capture: true })
	const main = run('git', ['rev-parse', 'origin/main'], { capture: true })
	if (head !== main) reasons.push(`HEAD (${head.slice(0, 7)}) no es origin/main (${main.slice(0, 7)})`)
	// Los crons, de la configuración que despliega wrangler.
	const { unstable_readConfig } = await import('wrangler')
	const crons = unstable_readConfig({ config: join(root, 'wrangler.jsonc') }).triggers?.crons ?? []
	const cron = crons.find((expression) => inCronWindow(expression, now))
	if (cron) reasons.push(`es la ventana del cron «${cron}»: ${CRON_WINDOW_MIN} min desde que salta (UTC)`)
	return { reasons, head }
}

/** El marcador de `wrangler d1 time-travel info --json`, o undefined si la salida no es ese JSON. */
function parseBookmark(output) {
	try {
		return JSON.parse(output).bookmark
	} catch {
		return undefined
	}
}

const [option, ...rest] = process.argv.slice(2)
if (rest.length > 0 || (option !== undefined && option !== '--comprobar' && !option.startsWith('--comprobar='))) {
	fail('uso: pnpm run deploy [--comprobar[=<fecha ISO>]]')
}
const checkOnly = option !== undefined
const at = option?.split('=')[1]
const now = at ? new Date(at) : new Date()
if (Number.isNaN(now.getTime())) fail(`fecha no válida: ${at} (p. ej. 2026-10-23T05:10Z)`)
const pnpmCmd = pnpmCommand()
if (!checkOnly && !pnpmCmd) fail('lánzalo con `pnpm run deploy`')
const pnpm = (args, options) => run(pnpmCmd[0], [...pnpmCmd.slice(1), ...args], options)

step(`1/5 Comprobaciones (${now.toISOString()})`)
const { reasons, head } = await refusals(now)
if (reasons.length > 0) fail(`no se despliega:\n- ${reasons.join('\n- ')}`)
console.log('Se puede desplegar.')
if (checkOnly) process.exit(0)

step('2/5 Motor (copy-engine)')
run(process.execPath, [join(root, 'scripts', 'copy-engine.mjs')])

step('3/5 Marcador de Time Travel de D1')
const output = pnpm(['exec', 'wrangler', 'd1', 'time-travel', 'info', DATABASE, '--json'], { capture: true })
const bookmark = parseBookmark(output)
if (!bookmark) fail(`sin marcador no se despliega. La salida de wrangler era:\n${output}`)
appendFileSync(LOG, `${new Date().toISOString()} commit=${head} marcador=${bookmark}\n`)
console.log(`${bookmark} → despliegues.log`)

step('4/5 Build y despliegue')
pnpm(['build'])
pnpm(['exec', 'wrangler', 'deploy'])

step('5/5 Humo')
const smoke = spawnSync(process.execPath, [join(root, 'scripts', 'humo.mjs')], { cwd: root, stdio: 'inherit' })
if (smoke.status !== 0) {
	fail(
		'el humo falla tras desplegar. Para volver a la versión anterior del Worker:\n' +
			'  pnpm exec wrangler deployments list\n' +
			'  pnpm exec wrangler rollback <versión>\n' +
			'D1 sólo hace falta restaurarla si el problema está en los datos (marcador en despliegues.log).'
	)
}
console.log('\n[desplegar] Desplegado.')
