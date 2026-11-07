// Lo común a las piezas de MapleChess: el lienzo, los grosores, las molduras, los
// colores, las ayudas para dibujar y la medida del contraste. Cada pieza se
// dibuja en su módulo (scripts/piezas/<pieza>.mjs) con estas ayudas, y
// scripts/piezas.mjs escribe las SVG del tablero y las de las figuras.
//
// El juego se llama «Libro»: piezas de diagrama de un libro de ajedrez clásico,
// en blanco y negro puros. Son coordenadas propias, dibujadas con cburnett y
// mpchess a la vista y midiendo el parecido contra cburnett, sin abrir sus
// trazados.
//
// La silueta es la misma en los dos colores. Las negras son macizas, sin borde
// claro por fuera; sus juntas, líneas blancas que no tocan el borde. Las esquinas
// van a inglete, como un grabado; donde el trazo vuelve casi sobre sí mismo (bajo
// la cabeza del peón, en la garganta del caballo…), una curva mínima en el trazado
// evita el pico que dejaría el inglete dentro de las blancas.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Lienzo de 100×100: chessground pinta cada pieza a todo el tamaño de su
// casilla (background-size: cover), sin márgenes.
export const LADO = 100
export const CENTRO = 50
/** Línea base: donde apoya la silueta, con el medio contorno de abajo. */
export const BASE = 90
/**
 * Grosor del contorno, en los dos colores. Va centrado en el trazo, así que la
 * mitad cae fuera. A 32 px por casilla, una unidad son 0,32 px: mide 1,09 px.
 */
export const CONTORNO = 3.4
/**
 * Grosor de las juntas: 0,96 px a 32 px en las blancas y 1,09 en las negras, donde
 * el blanco sobre negro se apagaba.
 */
export const LINEA = { w: 3, b: 3.4 }
/** Lo que se acorta una junta en las negras para no tocar el borde de la silueta. */
const MARGEN = 3.8

// Colores, de los tokens de global.css: las SVG no ven variables CSS.
const css = readFileSync(join(ROOT, 'src', 'styles', 'global.css'), 'utf8')

/** Valor de un token de global.css, siguiendo un var() si lo hay. */
export function token(name) {
	const value = css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()
	if (!value) throw new Error(`[piezas] no encuentro --${name} en global.css`)
	const alias = value.match(/^var\(--([\w-]+)\)$/)?.[1]
	return alias ? token(alias) : value
}

/** «#rrggbb» o «rgb(r g b / a)» → [r, g, b, a]. */
export function rgba(color) {
	const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1]
	if (hex) return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).concat(1)
	const rgb = color.match(/^rgb\((\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\)$/)
	if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])]
	throw new Error(`[piezas] color que no sé leer: ${color}`)
}

/** Un color con transparencia sobre otro opaco. */
function sobre([r, g, b, a], fondo) {
	return [r, g, b].map((c, i) => Math.round(c * a + fondo[i] * (1 - a)))
}

const hex = (rgb) => `#${rgb.slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('')}`

/** El tono claro y la tinta de las piezas. */
export const COLORES = { claro: token('board-piece-light'), tinta: token('board-piece-ink') }

const arce = rgba(token('board-light'))
const oscura = rgba(token('board-dark'))
const ultima = rgba(token('board-last-move'))
const elegida = rgba(token('board-selected'))

/**
 * Las casillas sobre las que se mide, con el contraste que se pide. WCAG no
 * tiene AAA para gráficos (1.4.11 pide 3:1): se usan los umbrales del texto.
 * Sobre la casilla oscura, 7:1 es imposible (blanco y negro puros dan 4,58:1), así que se
 * pide 4,5:1. Las marcadas son de paso: 3:1. El jaque, en el centro del degradado
 * rojo de board.css, donde es más intenso.
 */
export const CASILLAS = [
	{ nombre: 'arce', color: hex(arce), umbral: 7 },
	{ nombre: 'oscura', color: hex(oscura), umbral: 4.5 },
	{ nombre: 'arce, última', color: hex(sobre(ultima, arce)), umbral: 3 },
	{ nombre: 'oscura, última', color: hex(sobre(ultima, oscura)), umbral: 3 },
	{ nombre: 'arce, elegida', color: hex(sobre(elegida, arce)), umbral: 3 },
	{ nombre: 'oscura, elegida', color: hex(sobre(elegida, oscura)), umbral: 3 },
	{ nombre: 'jaque', color: '#ff0000', umbral: 3 }
]

// Trazados. Los números van con un decimal como mucho: cada SVG tiene que
// quedar por debajo de 4 KB para que Vite la incruste en el CSS.
export const n = (x) => String(Math.round(x * 10) / 10)
const pt = (x, y) => `${n(x)} ${n(y)}`
const espejo = (x) => LADO - x

/**
 * Pieza de torno: medio perfil, el de la derecha, de arriba abajo. Empieza y
 * acaba en el eje (x = 50) y se refleja para cerrar la silueta. Tramos:
 * ['L', x, y], ['C', x1, y1, x2, y2, x, y], ['Q', x1, y1, x, y] y
 * ['A', r, x, y, barrido], un arco de circunferencia corto.
 */
export function torno([x0, y0], ...tramos) {
	let [x, y] = [x0, y0]
	const derecha = []
	const izquierda = []
	for (const [tipo, ...v] of tramos) {
		if (tipo === 'L') {
			derecha.push(`L${pt(v[0], v[1])}`)
			izquierda.unshift(`L${pt(espejo(x), y)}`)
		} else if (tipo === 'C') {
			derecha.push(`C${pt(v[0], v[1])} ${pt(v[2], v[3])} ${pt(v[4], v[5])}`)
			izquierda.unshift(`C${pt(espejo(v[2]), v[3])} ${pt(espejo(v[0]), v[1])} ${pt(espejo(x), y)}`)
		} else if (tipo === 'Q') {
			derecha.push(`Q${pt(v[0], v[1])} ${pt(v[2], v[3])}`)
			izquierda.unshift(`Q${pt(espejo(v[0]), v[1])} ${pt(espejo(x), y)}`)
		} else if (tipo === 'A') {
			// Reflejar y recorrer al revés invierten el barrido dos veces: queda igual.
			derecha.push(`A${n(v[0])} ${n(v[0])} 0 0 ${v[3]} ${pt(v[1], v[2])}`)
			izquierda.unshift(`A${n(v[0])} ${n(v[0])} 0 0 ${v[3]} ${pt(espejo(x), y)}`)
		} else {
			throw new Error(`[piezas] tramo desconocido: ${tipo}`)
		}
		;[x, y] = tipo === 'A' ? [v[1], v[2]] : v.slice(-2)
	}
	if (x0 !== CENTRO || x !== CENTRO) throw new Error('[piezas] el perfil de torno empieza y acaba en el eje')
	return `M${pt(x0, y0)}${derecha.join('')}${izquierda.join('')}Z`
}

export function circulo(cx, cy, r) {
	return `M${pt(cx - r, cy)}A${n(r)} ${n(r)} 0 1 1 ${pt(cx + r, cy)}A${n(r)} ${n(r)} 0 1 1 ${pt(cx - r, cy)}Z`
}

/*
 * Filas de píxeles a 32 px por casilla (3,125 u cada una): una junta centrada en
 * una fila se pinta entera en ella, y no repartida en dos filas de gris.
 */
export const fila = (k) => (k + 0.5) * 3.125
/** La junta de la base, en la fila 25. Debajo quedan dos filas de plinto en las blancas. */
export const Y_PLINTO = fila(25)
/** El fondo del trazado: con medio contorno, la silueta acaba en BASE. */
const Y_FONDO = BASE - CONTORNO / 2
/** El hombro de la base, sobre la grada. */
const Y_HOMBRO = Y_PLINTO - 4.6

/** Parábola de x = 50 − s a x = 50 + s, con flecha f hacia abajo en el centro. */
const arco = (y, s, f) =>
	f ? `M${n(50 - s)} ${n(y)}Q50 ${n(y + 2 * f)} ${n(50 + s)} ${n(y)}` : `M${n(50 - s)} ${n(y)}H${n(50 + s)}`

/**
 * Una junta de lado a lado. En las blancas llega hasta el contorno; en las
 * negras se queda `margen` antes, sobre la misma parábola, para flotar dentro.
 */
export function junta(y, s, f = 0, margen = MARGEN) {
	const k = s - margen
	const fb = f * (k / s) ** 2
	return { w: arco(y, s, f), b: arco(y + f - fb, k, fb) }
}

/** Una línea libre, igual en los dos colores (no toca el borde). */
export const libre = (d) => ({ w: d, b: d })
/** Una línea distinta en cada color: en las blancas llega al contorno. */
export const doble = (w, b) => ({ w, b })

/**
 * El semiancho de un perfil de torno a la altura y: recorre los tramos y
 * devuelve el x del primer cruce. Para que las juntas caigan en el contorno.
 */
export function semiancho(inicio, tramos, y) {
	let [x0, y0] = inicio
	for (const [tipo, ...v] of tramos) {
		const P =
			tipo === 'L'
				? (t) => [x0 + (v[0] - x0) * t, y0 + (v[1] - y0) * t]
				: tipo === 'Q'
					? (t) => [
							(1 - t) ** 2 * x0 + 2 * (1 - t) * t * v[0] + t * t * v[2],
							(1 - t) ** 2 * y0 + 2 * (1 - t) * t * v[1] + t * t * v[3]
						]
					: (t) => [
							(1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * v[0] + 3 * (1 - t) * t * t * v[2] + t ** 3 * v[4],
							(1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * v[1] + 3 * (1 - t) * t * t * v[3] + t ** 3 * v[5]
						]
		let previo = P(0)
		for (let i = 1; i <= 200; i++) {
			const p = P(i / 200)
			if ((previo[1] - y) * (p[1] - y) <= 0 && p[1] !== previo[1]) {
				return previo[0] + ((p[0] - previo[0]) * (y - previo[1])) / (p[1] - previo[1]) - 50
			}
			previo = p
		}
		;[x0, y0] = v.slice(-2)
	}
	throw new Error(`[piezas] sin cruce a y=${y}`)
}

/** Parte una cúbica en t: devuelve los puntos de control de los dos trozos. */
export function partir([p0, p1, p2, p3], t) {
	const lerp = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
	const [a, b, c] = [lerp(p0, p1), lerp(p1, p2), lerp(p2, p3)]
	const [d, e] = [lerp(a, b), lerp(b, c)]
	const f = lerp(d, e)
	return [
		[p0, a, d, f],
		[f, e, c, p3]
	]
}
export const curva = ([, a, b, c]) => `C${n(a[0])} ${n(a[1])} ${n(b[0])} ${n(b[1])} ${n(c[0])} ${n(c[1])}`

/** El plinto, una losa de cantos vivos. Se entra por su canto superior. */
export const plinto = (x) => [['L', x, Y_PLINTO], ['L', x, Y_FONDO], ['L', CENTRO, Y_FONDO]]

/**
 * La base, desde el final de la escocia hasta la línea base: un hombro, una grada
 * y el plinto. Las gradas sólo se ven en la silueta: una línea más de lado a lado
 * oscurecía la base de las blancas a 32 px.
 */
export function molduras(s) {
	const x = CENTRO + s
	return [['Q', x - 2.4, Y_HOMBRO, x - 2.4, Y_HOMBRO + 1.2], ['L', x - 2.4, Y_PLINTO], ...plinto(x)]
}

/** La escocia del cuello: una sola curva cóncava que llega plana al hombro de la grada. */
export const cuello = (s, x1, y1) => ['C', x1, y1, CENTRO + s - 11, Y_HOMBRO, CENTRO + s - 3.6, Y_HOMBRO]

/** La junta de la base, entre la grada y el plinto. */
export const juntasBase = (s) => [junta(Y_PLINTO, s - 1.6, 0, 3)]

/**
 * Collar: un anillo de cantos redondos, de semiancho s, entre y y y + alto. Se
 * entra por (50 + s − 1,6, y) y se sale por (50 + salida, y + alto).
 */
export function collar(y, s, alto, salida) {
	const x = CENTRO + s
	return [
		['L', x - 1.6, y],
		['Q', x, y, x, y + alto / 2],
		['Q', x, y + alto, x - 1.6, y + alto],
		['L', CENTRO + salida, y + alto]
	]
}

/**
 * La línea del anillo, debajo. En las blancas llega al contorno; en las negras no
 * pasa del cuello (salida − 1): más allá, bajo el anillo, ya sólo queda el borde.
 */
export const juntasCollar = (y, s, alto, salida) => [doble(arco(y + alto, s - 1.6, 0), arco(y + alto, salida - 1, 0))]

/**
 * La SVG de una pieza, igual de silueta en los dos colores. `pieza.macizas`, formas
 * siempre de tinta (la cruz del rey); `pieza.luz`, lo que las rellena en las blancas,
 * sin trazo; `pieza.partes`, las formas con el relleno de su color y contorno de
 * tinta; `pieza.lineas`, trazos abiertos (las juntas), cada
 * uno con su versión para cada color (`{ w, b }`), del color contrario al relleno;
 * `pieza.marcas`, formas rellenas de ese mismo color (`{ w, b }`: un ojo, la crin).
 */
export function svgPieza(pieza, color) {
	const [relleno, linea] = color === 'w' ? [COLORES.claro, COLORES.tinta] : [COLORES.tinta, COLORES.claro]
	const macizas = (pieza.macizas ?? []).map((d) => `<path fill="${COLORES.tinta}" d="${d}"/>`).join('')
	const luz = pieza.luz && color === 'w' ? `<path fill="${COLORES.claro}" stroke="none" d="${pieza.luz}"/>` : ''
	const partes = macizas + luz + pieza.partes.map((d) => `<path d="${d}"/>`).join('')
	const d = pieza.lineas
		.map((l) => l[color])
		.filter(Boolean)
		.join('')
	const lineas = `<path fill="none" stroke="${linea}" stroke-width="${LINEA[color]}" d="${d}"/>`
	const marcas = pieza.marcas ? `<path fill="${linea}" stroke="none" d="${pieza.marcas[color]}"/>` : ''
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LADO} ${LADO}">` +
		`<g fill="${relleno}" stroke="${COLORES.tinta}" stroke-width="${CONTORNO}" ` +
		`stroke-linejoin="miter" stroke-miterlimit="6" stroke-linecap="round">` +
		`${partes}${lineas}${marcas}</g></svg>\n`
	)
}

/**
 * La SVG de la figura que usa la fuente de la notación
 * (scripts/fuente-figuras.py): sólo relleno, con el borde de abajo del
 * viewBox en la línea base y la misma escala para todas.
 */
export function svgFigura(pieza) {
	const d = pieza.figura ?? pieza.partes.join('')
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LADO} ${BASE}"><path d="${d}"/></svg>\n`
}

// Contraste (WCAG 2): luminancia relativa de un color sRGB de 8 bits.
function luminancia(r, g, b) {
	const lin = (c) => {
		const s = c / 255
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contraste(a, b) {
	const [la, lb] = [luminancia(...a), luminancia(...b)].sort((x, y) => y - x)
	return (la + 0.05) / (lb + 0.05)
}

function mediana(valores) {
	if (!valores.length) return 0
	const orden = Float64Array.from(valores).sort()
	return orden[orden.length >> 1]
}

/** Erosiona una máscara con un cuadrado de radio 1. */
function erosionar(mascara, ancho, alto) {
	const out = new Uint8Array(mascara.length)
	for (let y = 1; y < alto - 1; y++) {
		for (let x = 1; x < ancho - 1; x++) {
			let dentro = 1
			for (let dy = -1; dy <= 1 && dentro; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					if (!mascara[(y + dy) * ancho + x + dx]) {
						dentro = 0
						break
					}
				}
			}
			out[y * ancho + x] = dentro
		}
	}
	return out
}

/**
 * Una pieza pintada a `px` píxeles de lado, lista para medirla sobre
 * cualquier casilla:
 * - los píxeles;
 * - la silueta: lo que cubre al menos la mitad del píxel;
 * - su orilla: los píxeles de la silueta que tocan el exterior;
 * - el cuerpo: la silueta sin un anillo del grosor del contorno;
 * - ese grosor en píxeles, redondeado hacia arriba (el radio en que se busca
 *   el borde).
 */
function pintar(svg, px) {
	const { width: ancho, height: alto, pixels } = new Resvg(svg, { fitTo: { mode: 'width', value: px } }).render()
	const silueta = new Uint8Array(ancho * alto)
	for (let i = 0; i < silueta.length; i++) silueta[i] = pixels[i * 4 + 3] >= 128 ? 1 : 0
	let cuerpo = silueta
	for (let i = 0; i < Math.max(1, Math.round((CONTORNO * px) / LADO)); i++) cuerpo = erosionar(cuerpo, ancho, alto)
	const fuera = (x, y) => x < 0 || y < 0 || x >= ancho || y >= alto || !silueta[y * ancho + x]
	const orilla = []
	for (let y = 0; y < alto; y++) {
		for (let x = 0; x < ancho; x++) {
			const toca = fuera(x - 1, y) || fuera(x + 1, y) || fuera(x, y - 1) || fuera(x, y + 1)
			if (silueta[y * ancho + x] && toca) orilla.push(y * ancho + x)
		}
	}
	const radio = Math.max(1, Math.ceil((CONTORNO * px) / LADO))
	return { pixels, ancho, alto, silueta, cuerpo, orilla, radio }
}

/**
 * Contraste de una pieza pintada sobre una casilla: el del borde y el del
 * cuerpo frente a la casilla. Una pieza se ve si destaca su borde o su
 * cuerpo.
 * - El borde: en cada punto de la orilla, el mejor contraste a menos de un
 *   grosor de contorno; luego, la mediana a lo largo de la silueta. Dice si
 *   hay una línea que destaca alrededor de la pieza, caiga donde caiga en la
 *   rejilla de píxeles: medir un anillo fijo recogía tinta por dentro y
 *   suavizado por fuera, y el resultado dependía de dónde cayera cada borde.
 * - El cuerpo: la mediana de lo que queda dentro del anillo.
 * Los píxeles se componen sobre la casilla como hace el navegador, en sRGB.
 * resvg los da premultiplicados (un blanco que cubre medio píxel sale 128,
 * 128, 128, 128): el color ya lleva el alfa, y sólo la casilla se multiplica
 * por lo que queda.
 */
function medirSobre({ pixels, ancho, alto, silueta, cuerpo, orilla, radio }, casilla) {
	const fondo = rgba(casilla)
	const valores = new Float32Array(silueta.length)
	const dentro = []
	for (let i = 0; i < silueta.length; i++) {
		if (!silueta[i]) continue
		const a = pixels[i * 4 + 3] / 255
		valores[i] = contraste([0, 1, 2].map((k) => pixels[i * 4 + k] + fondo[k] * (1 - a)), fondo)
		if (cuerpo[i]) dentro.push(valores[i])
	}
	const borde = orilla.map((i) => {
		const [x0, y0] = [i % ancho, Math.floor(i / ancho)]
		let mejor = 0
		for (let y = Math.max(0, y0 - radio); y <= Math.min(alto - 1, y0 + radio); y++) {
			for (let x = Math.max(0, x0 - radio); x <= Math.min(ancho - 1, x0 + radio); x++) {
				if (silueta[y * ancho + x] && valores[y * ancho + x] > mejor) mejor = valores[y * ancho + x]
			}
		}
		return mejor
	})
	return { borde: mediana(borde), cuerpo: mediana(dentro) }
}

/*
 * Tamaños en los que se mide, en píxeles del dispositivo. Los tableros
 * pequeños (casillas de 32 y 41 px) son de móvil, con 2 o 3 píxeles por píxel
 * CSS; los de 56 y 72 px, de escritorio, a 1. Las de 32 y 41 a 1 se miden
 * también, pero sólo para informar: un borde de 1 px pierde contraste con el
 * suavizado.
 */
export const TAMANOS = [
	{ css: 32, dpr: 2, exige: true },
	{ css: 41, dpr: 2, exige: true },
	{ css: 56, dpr: 1, exige: true },
	{ css: 72, dpr: 1, exige: true },
	{ css: 32, dpr: 1, exige: false },
	{ css: 41, dpr: 1, exige: false }
]

/** Mide una pieza en todas las casillas y tamaños. */
export function informe(pieza) {
	const filas = []
	for (const color of ['w', 'b']) {
		const svg = svgPieza(pieza, color)
		for (const tamano of TAMANOS) {
			const pintada = pintar(svg, tamano.css * tamano.dpr)
			for (const { nombre, color: fondo, umbral } of CASILLAS) {
				const { borde, cuerpo } = medirSobre(pintada, fondo)
				const valor = Math.max(borde, cuerpo)
				filas.push({ color, casilla: nombre, ...tamano, borde, cuerpo, valor, umbral, ok: valor >= umbral })
			}
		}
	}
	return filas
}
