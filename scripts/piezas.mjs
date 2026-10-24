// Escribe las piezas de MapleChess a partir de sus módulos
// (scripts/piezas/<pieza>.mjs, con las ayudas de scripts/piezas/comun.mjs):
// - src/assets/pieces/maple/{w,b}X.svg, las del tablero (board.css);
// - scripts/piezas/figuras/X.svg, las de la fuente de la notación
//   (scripts/fuente-figuras.py). El peón no tiene: en SAN no lleva letra.
// Comprueba cada una: menos de 4096 bytes, porque por encima Vite deja de
// incrustarla en el CSS y pasa a pedirla aparte, y el contraste sobre cada
// casilla (CASILLAS y TAMANOS, en comun.mjs). Sale con error si alguna no
// cumple.
//
//   node scripts/piezas.mjs                        todas las que haya
//   node scripts/piezas.mjs rey torre              sólo ésas
//   node scripts/piezas.mjs rey --muestra <carpeta>  además, muestra.html
//
// Los módulos que aún no existen se saltan. Cada sesión de pieza regenera sólo
// la suya, y así cada rama toca sólo sus archivos.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CASILLAS, ROOT, informe, svgFigura, svgPieza } from './piezas/comun.mjs'
import { hojaMuestra } from './piezas/muestra.mjs'

const PIEZAS = ['rey', 'dama', 'torre', 'alfil', 'caballo', 'peon']
const LIMITE = 4096

const args = process.argv.slice(2)
const i = args.indexOf('--muestra')
const muestra = i === -1 ? null : args.splice(i, 2)[1]
if (i !== -1 && !muestra) throw new Error('[piezas] --muestra necesita una carpeta')
const pedidas = args.length ? args : PIEZAS
for (const nombre of pedidas) if (!PIEZAS.includes(nombre)) throw new Error(`[piezas] no conozco la pieza «${nombre}»`)

const tablero = join(ROOT, 'src', 'assets', 'pieces', 'maple')
const figuras = join(ROOT, 'scripts', 'piezas', 'figuras')
mkdirSync(tablero, { recursive: true })
mkdirSync(figuras, { recursive: true })

const cargadas = {}
let fallos = 0
for (const nombre of pedidas) {
	const ruta = join(ROOT, 'scripts', 'piezas', `${nombre}.mjs`)
	if (!existsSync(ruta)) {
		if (args.length) throw new Error(`[piezas] falta scripts/piezas/${nombre}.mjs`)
		continue
	}
	const pieza = (await import(pathToFileURL(ruta).href)).default
	cargadas[pieza.letra] = pieza

	for (const color of ['w', 'b']) {
		const svg = svgPieza(pieza, color)
		const bytes = Buffer.byteLength(svg)
		writeFileSync(join(tablero, `${color}${pieza.letra}.svg`), svg)
		if (bytes >= LIMITE) {
			console.log(`✗ ${color}${pieza.letra}.svg: ${bytes} bytes, por encima de ${LIMITE}`)
			fallos++
		}
	}
	if (pieza.figura !== null) writeFileSync(join(figuras, `${pieza.letra}.svg`), svgFigura(pieza))

	// El peor caso de cada color y casilla entre los tamaños exigidos.
	const filas = informe(pieza).filter((f) => f.exige)
	const lineas = []
	for (const color of ['w', 'b']) {
		const valores = CASILLAS.map((c) => {
			const peor = filas.filter((f) => f.color === color && f.casilla === c.nombre).reduce((a, f) => (f.valor < a.valor ? f : a))
			if (!peor.ok) fallos++
			return `${c.nombre} ${peor.valor.toFixed(1)}${peor.ok ? '' : ` ✗ (pide ${c.umbral})`}`
		})
		lineas.push(`  ${color === 'w' ? 'blanca' : 'negra '}  ${valores.join(' · ')}`)
	}
	console.log(`${nombre} (${pieza.letra})\n${lineas.join('\n')}`)
}

if (muestra) {
	mkdirSync(muestra, { recursive: true })
	const html = hojaMuestra({ titulo: 'Piezas MapleChess', juegos: [{ nombre: 'Las piezas de ahora', piezas: cargadas }] })
	writeFileSync(join(muestra, 'muestra.html'), html)
	console.log(`muestra: ${join(muestra, 'muestra.html')}`)
}

if (fallos) {
	console.log(`\n${fallos} comprobaciones fallidas`)
	process.exit(1)
}
