// Prepara una copia de trabajo (git worktree) de MapleChess para probar con pnpm dev:
// instala, copia del checkout principal la D1 local y .dev.vars si la copia no los tiene,
// aplica las migraciones de la rama y dice qué configuración de .claude/launch.json
// arranca su servidor en el puerto pedido.
//
//   node scripts/worktree.mjs <puerto>        # dentro de la copia
//
// Sólo funciona en una copia de este repositorio, fuera de OneDrive (subiría .dev.vars y la
// D1 local, que lleva nombres) y fuera de la carpeta temporal (workerd.exe pasa allí del
// límite de rutas de Windows y wrangler se cuelga sin dar error). .dev.vars se copia sin
// leerlo ni enseñarlo.
import { execFileSync, execSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'

function fail(message) {
	console.error(message)
	process.exit(1)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const normal = (path) => realpathSync(path).toLowerCase()

const port = Number(process.argv[2])
if (!Number.isInteger(port)) fail('Uso: node scripts/worktree.mjs <puerto>')

const top = git('rev-parse', '--show-toplevel')
const gitDir = git('rev-parse', '--path-format=absolute', '--git-dir')
const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir')
if (normal(gitDir) === normal(commonDir)) fail('Esto es el checkout principal: se lanza dentro de una copia de trabajo.')
if (!/jorgeabf\/maplechess(\.git)?$/.test(git('config', '--get', 'remote.origin.url')))
	fail('No es una copia del repositorio de MapleChess.')
const main = dirname(commonDir)

const here = normal(top) + sep
if (/[\\/]onedrive[^\\/]*[\\/]/.test(here)) fail('La copia está en OneDrive: subiría .dev.vars y la D1 local a la nube.')
if (here.startsWith(normal(tmpdir()) + sep)) fail('La copia está en la carpeta temporal: allí workerd.exe pasa del límite de rutas.')

const launch = JSON.parse(readFileSync(join(top, '.claude', 'launch.json'), 'utf8'))
const config = launch.configurations.find((entry) => entry.port === port)
if (!config)
	fail(`Ninguna configuración de .claude/launch.json usa el puerto ${port}. Hay: ${launch.configurations.map((entry) => entry.port).join(', ')}.`)

const steps = []
function step(name, action) {
	const started = Date.now()
	const note = action()
	steps.push(`${name}: ${note ?? 'hecho'} (${((Date.now() - started) / 1000).toFixed(1)} s)`)
	console.log(`· ${steps.at(-1)}`)
}

step('.dev.vars', () => {
	if (existsSync(join(top, '.dev.vars'))) return 'ya estaba'
	if (!existsSync(join(main, '.dev.vars'))) return 'no está en el checkout principal: copia .dev.vars.example y rellénalo'
	copyFileSync(join(main, '.dev.vars'), join(top, '.dev.vars'))
	return 'copiado del checkout principal'
})

step('D1 local', () => {
	const d1 = join('.wrangler', 'state', 'v3', 'd1')
	if (existsSync(join(top, d1))) return 'ya estaba'
	if (!existsSync(join(main, d1))) return 'no está en el checkout principal: las páginas saldrán vacías'
	cpSync(join(main, d1), join(top, d1), { recursive: true })
	return 'copiada del checkout principal'
})

step('pnpm install', () => {
	execSync('pnpm install --frozen-lockfile', { cwd: top, stdio: 'inherit' })
})

step('migraciones', () => {
	execSync('pnpm db:migrate:local', { cwd: top, stdio: 'inherit' })
})

console.log(`\nLista. preview_start con name «${config.name}» arranca pnpm dev en el puerto ${port}.`)
