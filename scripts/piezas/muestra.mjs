// Hoja de muestra de las piezas: un HTML suelto, sin dependencias, para
// comparar juegos (direcciones, grosores, opciones de una pieza) en el
// tablero real. Lleva:
// - tableros a 32, 41 y 72 px por casilla, con las coordenadas de board.css;
// - cada pieza sobre las casillas sin marcar y marcadas, con su contraste;
// - las figuras en una lista de jugadas, en sans y en serif, en claro y en
//   oscuro, macizas y huecas;
// - las cburnett (las de lichess) y las mpchess (las de ahora), para comparar.
// La escribe `node scripts/piezas.mjs --muestra <carpeta>`.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { BASE, CASILLAS, ROOT, TAMANOS, informe, svgPieza, token } from './comun.mjs'

const ROLES = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }
const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const fmt = (x) => x.toFixed(1).replace('.', ',')

/** Las cburnett, sacadas del CSS de chessground: { wP: uri, … }. */
function cburnett() {
	const ruta = join(ROOT, 'node_modules', '@lichess-org', 'chessground', 'assets', 'chessground.cburnett.css')
	if (!existsSync(ruta)) return null
	const css = readFileSync(ruta, 'utf8')
	const juego = {}
	for (const [, rol, color, url] of css.matchAll(/piece\.(\w+)\.(white|black)\s*\{\s*background-image:\s*url\('([^']+)'\)/g)) {
		const letra = Object.keys(ROLES).find((k) => ROLES[k] === rol)
		juego[`${color[0]}${letra}`] = url
	}
	return juego
}

/** Las mpchess, mientras sigan en el repo. */
function mpchess() {
	const dir = join(ROOT, 'src', 'assets', 'pieces', 'mpchess')
	if (!existsSync(dir)) return null
	const juego = {}
	for (const color of 'wb') for (const letra of Object.keys(ROLES)) juego[`${color}${letra}`] = uri(readFileSync(join(dir, `${color}${letra}.svg`)))
	return juego
}

// Posiciones: un muestrario (cada pieza sobre las dos casillas) y una partida.
const MUESTRARIO = 'rrnnbbqq/kkpppppp/8/8/8/8/PPPPPPKK/QQBBNNRR'
const PARTIDA = 'r1bqk2r/pppp1ppp/2n2n2/1Bb1p3/4P3/2P2N2/PP1P1PPP/RNBQK2R'

/**
 * Tablero con las reglas de board.css. `juego` da la clase de cada pieza
 * ({ wK: 'j0-wK', … }), que lleva su imagen: así cada SVG va una vez en la
 * hoja y no en cada casilla.
 */
function tablero(fen, juego, casilla, { ultima = [], jaque } = {}) {
	const filas = fen.split('/').map((fila) => fila.replace(/\d/g, (d) => '.'.repeat(Number(d))))
	const casillas = []
	filas.forEach((fila, r) => {
		;[...fila].forEach((c, f) => {
			const nombre = `${'abcdefgh'[f]}${8 - r}`
			const clases = ['sq', (f + r) % 2 ? 'oscura' : 'clara']
			if (ultima.includes(nombre)) clases.push('ultima')
			if (jaque === nombre) clases.push('jaque')
			const codigo = c === '.' ? null : `${c === c.toUpperCase() ? 'w' : 'b'}${c.toUpperCase()}`
			const pieza = codigo && juego[codigo] ? `<i class="${juego[codigo]}"></i>` : ''
			casillas.push(`<div class="${clases.join(' ')}">${pieza}</div>`)
		})
	})
	const numeros = [8, 7, 6, 5, 4, 3, 2, 1].map((n, i) => `<b class="${i % 2 ? 'sobre-oscura' : 'sobre-clara'}">${n}</b>`).join('')
	const letras = [...'abcdefgh'].map((l, i) => `<b class="${i % 2 ? 'sobre-clara' : 'sobre-oscura'}">${l}</b>`).join('')
	return `<div class="tablero" style="--c:${casilla}px">${casillas.join('')}<div class="numeros">${numeros}</div><div class="letras">${letras}</div></div>`
}

/** Una pieza sobre cada casilla de CASILLAS, a `casilla` px. */
function franja(clase, casilla) {
	return CASILLAS.map(
		(c) =>
			`<div class="sq suelta${c.nombre === 'jaque' ? ' jaque' : ''}" style="--c:${casilla}px;background-color:${c.color}" title="${c.nombre}"><i class="${clase}"></i></div>`
	).join('')
}

/** Tabla de contraste: el peor valor de cada casilla entre los tamaños exigidos. */
function tablaContraste(filas, letras) {
	const cab = CASILLAS.map((c) => `<th>${c.nombre}<br><small>≥ ${fmt(c.umbral)}</small></th>`).join('')
	const cuerpo = []
	for (const letra of letras) {
		for (const color of ['w', 'b']) {
			const celdas = CASILLAS.map((c) => {
				const mias = filas.filter((f) => f.letra === letra && f.color === color && f.casilla === c.nombre)
				const exigidas = mias.filter((f) => f.exige)
				const peor = exigidas.reduce((a, f) => (f.valor < a.valor ? f : a), exigidas[0])
				const info = mias.filter((f) => !f.exige).reduce((a, f) => Math.min(a, f.valor), Infinity)
				return `<td class="${peor.ok ? 'ok' : 'mal'}">${fmt(peor.valor)}<br><small>a 1×: ${fmt(info)}</small></td>`
			}).join('')
			cuerpo.push(`<tr><th>${color === 'w' ? 'blanca' : 'negra'} ${letra}</th>${celdas}</tr>`)
		}
	}
	return `<div class="ancho"><table><thead><tr><th></th>${cab}</tr></thead><tbody>${cuerpo.join('')}</tbody></table></div>`
}

/** La caja de la tinta de una figura, en unidades del lienzo. */
function cajaFigura(pieza) {
	const d = pieza.figura ?? pieza.partes.join('')
	return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${BASE}"><path d="${d}"/></svg>`).getBBox()
}

/**
 * Cómo se reparten la altura las figuras en el texto, con 0,76 em para la
 * más alta (scripts/fuente-figuras.py): con las proporciones del tablero, la
 * torre se queda en tres cuartos del rey; todas iguales, la torre pesa como el
 * rey; la intermedia toma la raíz de la proporción.
 */
const ESCALAS = {
	comun: { nombre: 'Escala común: las proporciones del tablero', alto: (a, max) => (0.76 * a) / max },
	intermedia: { nombre: 'Intermedia: la raíz de la proporción del tablero', alto: (a, max) => 0.76 * Math.sqrt(a / max) },
	igual: { nombre: 'Todas a 0,76 em', alto: () => 0.76 }
}

/** La figura recortada a su tinta, `em` de alto y con 0,04 em de margen a cada lado, como en la fuente. */
function figura(pieza, em) {
	const d = pieza.figura ?? pieza.partes.join('')
	const caja = cajaFigura(pieza)
	const alto = BASE - caja.y
	const margen = (0.04 * alto) / em
	const [x, ancho] = [caja.x - margen, caja.width + 2 * margen]
	return `<svg class="fig" viewBox="${x.toFixed(1)} ${caja.y.toFixed(1)} ${ancho.toFixed(1)} ${alto.toFixed(1)}" style="height:${em.toFixed(3)}em;width:${((em * ancho) / alto).toFixed(3)}em" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`
}

const JUGADAS =
	'1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 d6 8.c3 O-O 9.h3 Nb8 10.d4 Nbd7 11.Nbd2 Bb7 12.Bc2 Re8 13.Nf1 Bf8 14.Ng3 g6 15.Bg5 h6 16.Bd2 Bg7 17.a4 c5 18.d5 c4 19.b4 Nh7 20.Be3 h5 21.Qd2 Rf8 22.Ra3 Ndf6 23.Rea1 Qd7 24.R1a2 Rfc8 25.Qc1 Bf8 26.Qa1 Qe8 27.Nf5 gxf5 28.exf5 e4 29.Bxe4 Nxe4 30.Kh2 f6 31.Qxf6 Kg8'

/** Las jugadas con las figuras que haya, a la escala dada; las que falten, con su letra. */
function lista(piezas, escala) {
	const conFigura = Object.keys(piezas).filter((l) => 'KQRBN'.includes(l) && piezas[l].figura !== null)
	const altos = Object.fromEntries(conFigura.map((l) => [l, BASE - cajaFigura(piezas[l]).y]))
	const max = Math.max(...Object.values(altos))
	const figuras = Object.fromEntries(conFigura.map((l) => [l, figura(piezas[l], ESCALAS[escala].alto(altos[l], max))]))
	// Cada jugada en un bloque que no parte: con la fuente, la figura es una
	// letra más; aquí es un <svg>, y el navegador podría partir línea tras ella.
	return JUGADAS.split(' ')
		.map((jugada) => `<span class="jugada">${esc(jugada).replace(/[KQRBN]/g, (l) => figuras[l] ?? l)}</span>`)
		.join(' ')
}

/**
 * @param {object} hoja
 * @param {string} hoja.titulo
 * @param {string} hoja.intro HTML
 * @param {{ nombre: string, nota?: string, piezas: Record<string, object>, opciones?: object, escalas?: string[] }[]} hoja.juegos
 *   `escalas`: cómo se reparten la altura las figuras en el texto (ESCALAS); por defecto, la común
 * @param {boolean} [hoja.artifact] sin el esqueleto del documento (doctype, html, head, body), que pone el Artifact al publicar
 */
export function hojaMuestra({ titulo, intro = '', juegos, artifact = false }) {
	// Una regla por pieza y juego con su imagen: { wK: 'j0-wK', … }.
	const estilos = []
	const registrar = (prefijo, uris) =>
		Object.fromEntries(
			Object.entries(uris).map(([codigo, url]) => {
				estilos.push(`.${prefijo}-${codigo} { background-image: url('${url}'); }`)
				return [codigo, `${prefijo}-${codigo}`]
			})
		)

	const secciones = juegos.map((juego, i) => {
		const uris = {}
		const filas = []
		const letras = Object.keys(ROLES).filter((l) => juego.piezas[l])
		for (const letra of letras) {
			for (const color of ['w', 'b']) uris[`${color}${letra}`] = uri(svgPieza(juego.piezas[letra], color, juego.opciones))
			for (const fila of informe(juego.piezas[letra], juego.opciones)) filas.push({ letra, ...fila })
		}
		const blancas = registrar(`j${i}`, uris)
		const franjas = letras
			.flatMap((l) => ['w', 'b'].map((c) => `<div class="fila"><span>${c === 'w' ? 'blanca' : 'negra'} ${l}</span>${franja(blancas[`${c}${l}`], 41)}</div>`))
			.join('')
		const textos = (juego.escalas ?? ['comun'])
			.map(
				(escala) =>
					`<h4>${ESCALAS[escala].nombre}</h4><div class="textos">` +
					['claro', 'oscuro']
						.map(
							(tema) =>
								`<div class="texto ${tema}"><p class="sans s14">${lista(juego.piezas, escala)}</p><p class="sans s16">${lista(juego.piezas, escala)}</p><p class="serif s16">${lista(juego.piezas, escala)}</p></div>`
						)
						.join('') +
					'</div>'
			)
			.join('')
		return `<section>
<h2>${esc(juego.nombre)}</h2>
${juego.nota ? `<p>${juego.nota}</p>` : ''}
<h3>Tablero</h3>
<div class="ancho tableros">
<figure>${tablero(MUESTRARIO, blancas, 41)}<figcaption>41 px por casilla (móvil)</figcaption></figure>
<figure>${tablero(PARTIDA, blancas, 41, { ultima: ['f8', 'c5'] })}<figcaption>41 px, con la última jugada</figcaption></figure>
<figure>${tablero(MUESTRARIO, blancas, 32)}<figcaption>32 px (el tablero mínimo)</figcaption></figure>
</div>
<div class="ancho tableros"><figure>${tablero(PARTIDA, blancas, 72, { ultima: ['f8', 'c5'] })}<figcaption>72 px por casilla (escritorio)</figcaption></figure></div>
<h3>Sobre cada casilla</h3>
<div class="ancho franjas"><div class="fila cabecera"><span></span>${CASILLAS.map((c) => `<span>${c.nombre}</span>`).join('')}</div>${franjas}</div>
<h3>Contraste</h3>
<p>Mediana del borde o del cuerpo frente a la casilla (el mayor de los dos), en el peor de los tamaños exigidos: ${TAMANOS.filter((t) => t.exige)
			.map((t) => `${t.css} px a ${t.dpr}×`)
			.join(', ')}. Debajo, el peor a 1× con casillas de 32 y 41 px, sólo como dato.</p>
${tablaContraste(filas, letras)}
<h3>Figuras en la notación</h3>
${textos}
</section>`
	})

	const comparadas = [
		['cburnett (lichess, por defecto)', 'cb', cburnett()],
		['mpchess (las de ahora)', 'mp', mpchess()]
	]
		.filter(([, , uris]) => uris)
		.map(([nombre, prefijo, uris]) => [nombre, registrar(prefijo, uris)])
	const comparacion = comparadas.length
		? `<section><h2>Para comparar</h2><div class="ancho tableros">${comparadas
				.map(([nombre, juego]) => `<figure>${tablero(MUESTRARIO, juego, 41)}<figcaption>${nombre}</figcaption></figure>`)
				.join('')}</div></section>`
		: ''

	const pagina = `<title>${esc(titulo)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
@font-face {
	font-family: 'Titulares';
	src: url('data:font/woff2;base64,${readFileSync(join(ROOT, 'src', 'assets', 'fonts', 'titulares-600.woff2')).toString('base64')}') format('woff2');
	font-weight: 600;
}
:root {
	color-scheme: light dark;
	--bg: #f5f2ea; --surface: #fffdf8; --text: #1d1f24; --muted: #5b5f6b; --border: #ddd5c4;
	--ok: #2f6b4f; --mal: #9b3b2f;
	--board-light: ${token('board-light')}; --board-dark: ${token('board-dark')};
	--last: ${token('board-last-move')};
	--coord-light: ${token('board-coord-on-light')}; --coord-dark: ${token('board-coord-on-dark')};
	--serif: 'Titulares', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
}
${estilos.join('\n')}
@media (prefers-color-scheme: dark) {
	:root:not([data-theme='light']) { color-scheme: dark; --bg: #15120f; --surface: #1f1b17; --text: #eae5dd; --muted: #bdb6ac; --border: #3e3631; --ok: #7fd0a4; --mal: #f0907f; }
}
:root[data-theme='dark'] { color-scheme: dark; --bg: #15120f; --surface: #1f1b17; --text: #eae5dd; --muted: #bdb6ac; --border: #3e3631; --ok: #7fd0a4; --mal: #f0907f; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, 'Segoe UI', sans-serif; }
main {
	max-width: 76rem;
	margin: 0 auto;
	padding-block: 24px 64px;
	padding-left: max(16px, env(safe-area-inset-left, 0px));
	padding-right: max(16px, env(safe-area-inset-right, 0px));
}
h1, h2 { font-family: var(--serif); font-weight: 600; }
section { border-top: 1px solid var(--border); margin-top: 32px; }
p, li { max-width: 46rem; }
small { color: var(--muted); }
.ancho { overflow-x: auto; }
.tableros { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
figure { margin: 0; }
figcaption { color: var(--muted); font-size: 14px; margin-top: 4px; }
.tablero { position: relative; display: grid; grid-template-columns: repeat(8, var(--c)); line-height: 1.5; }
.sq { position: relative; inline-size: var(--c); block-size: var(--c); }
.sq i { position: absolute; inset: 0; background-size: cover; z-index: 2; }
.clara { background: var(--board-light); }
.oscura { background: var(--board-dark); }
.ultima::before { content: ''; position: absolute; inset: 0; background: var(--last); }
.jaque::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgb(255 0 0) 0%, rgb(231 0 0) 25%, rgb(169 0 0 / 0) 89%, rgb(158 0 0 / 0) 100%); }
.suelta.jaque { background-color: var(--board-light) !important; }
.numeros, .letras { position: absolute; display: flex; pointer-events: none; font: 600 9px/1.5 system-ui, 'Segoe UI', sans-serif; }
.numeros { top: 0; left: 0; flex-direction: column; height: 100%; width: 12px; }
.numeros b { flex: 1 1 auto; padding-inline-start: 0.3em; }
.letras { bottom: -4px; left: 0; width: 100%; height: 16px; text-transform: uppercase; }
.letras b { flex: 1 1 auto; text-align: end; padding-inline-end: 0.3em; }
.sobre-clara { color: var(--coord-light); }
.sobre-oscura { color: var(--coord-dark); }
.franjas .fila { display: flex; align-items: center; gap: 6px; margin-block: 4px; }
.franjas .fila > span { inline-size: 6rem; flex: none; font-size: 14px; }
.franjas .cabecera > span { font-size: 12px; color: var(--muted); inline-size: 41px; }
.franjas .cabecera > span:first-child { inline-size: 6rem; }
table { border-collapse: collapse; font-size: 14px; }
th, td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: center; }
tbody th { text-align: start; white-space: nowrap; }
td.ok { color: var(--ok); }
td.mal { color: var(--mal); font-weight: 600; }
.textos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 16px; }
.texto { padding: 12px 16px; border-radius: 8px; }
.texto.claro { background: #fffdf8; color: #1d1f24; }
.texto.oscuro { background: #1f1b17; color: #eae5dd; }
.texto p { margin: 0 0 12px; }
.sans { font-family: system-ui, 'Segoe UI', sans-serif; font-weight: 600; }
.serif { font-family: var(--serif); font-weight: 600; }
.s14 { font-size: 14px; }
.s16 { font-size: 16px; }
.fig { vertical-align: baseline; overflow: visible; }
.jugada { white-space: nowrap; }
</style>
<main>
<h1>${esc(titulo)}</h1>
${intro}
${secciones.join('\n')}
${comparacion}
</main>
`
	// head y body son etiquetas opcionales: el navegador los abre y cierra solo.
	return artifact
		? pagina
		: `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${pagina}`
}
