// Copia la build "lite single-threaded" de Stockfish a public/engine/<versión>/.
//
// El paquete `stockfish` pesa ~200 MB porque trae todas las builds; sólo
// servimos una (~1,9 MB). Es de un hilo, así que no necesita las cabeceras
// COOP/COEP (SharedArrayBuffer). Stockfish es GPL-3.0: se copia también la
// licencia para servirla junto al motor.
//
// La carpeta lleva la versión del paquete para que public/_headers pueda
// servir el motor con caché inmutable: una versión nueva es otra URL. Si este
// script pasa a copiar otra build sin que cambie la versión, hay que cambiar
// también el nombre de la carpeta (aquí y en ENGINE_URL de
// src/client/visor/motor.ts), o los navegadores seguirán con la anterior.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

let pkgDir
try {
	pkgDir = dirname(require.resolve('stockfish/package.json'))
} catch {
	console.warn('[copy-engine] stockfish no está instalado todavía; se omite.')
	process.exit(0)
}
const { version } = require('stockfish/package.json')

const binDir = join(pkgDir, 'bin')
const build = readdirSync(binDir).find((f) => /^stockfish-\d+-lite-single\.js$/.test(f))
if (!build) throw new Error(`[copy-engine] no hay build lite-single en ${binDir}`)

const base = build.replace(/\.js$/, '')
const outDir = join(root, 'public', 'engine')
const versionDir = join(outDir, version)
rmSync(outDir, { recursive: true, force: true })
mkdirSync(versionDir, { recursive: true })

// El loader deriva la ruta del .wasm de la suya (cambia .js por .wasm), así
// que basta con copiar ambos con el mismo nombre base en la misma carpeta.
copyFileSync(join(binDir, `${base}.js`), join(versionDir, 'stockfish.js'))
copyFileSync(join(binDir, `${base}.wasm`), join(versionDir, 'stockfish.wasm'))

// La licencia, fuera de la carpeta de la versión: /acerca la enlaza en una URL fija.
const license = ['Copying.txt', 'COPYING.txt', 'LICENSE', 'LICENSE.txt'].find((f) =>
	existsSync(join(pkgDir, f))
)
if (license) copyFileSync(join(pkgDir, license), join(outDir, 'Copying.txt'))

console.log(`[copy-engine] ${base} (stockfish@${version}) → public/engine/${version}/`)
