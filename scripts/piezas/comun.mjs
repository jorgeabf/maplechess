// Lo común a las piezas de MapleChess: el lienzo, la peana, los grosores, los
// colores, las ayudas para dibujar y la medida del contraste. Cada pieza se
// dibuja en su módulo (scripts/piezas/<pieza>.mjs) con estas ayudas, y
// scripts/piezas.mjs escribe las SVG del tablero y las de las figuras.
//
// Las piezas son propias: se dibujan aquí desde cero, sin calcar ni adaptar
// trazos de otro juego. Pueden recordar la forma Staunton, que es lo que hace
// legible una pieza, pero no copiarla.
//
// La marca entra por el material y el oficio: perfiles de torno (bases anchas,
// cuellos gruesos), la taracea del logo (arce incrustado en nogal) y las
// juntas redondas del «!?».
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Lienzo de 100×100: chessground pinta cada pieza a todo el tamaño de su
// casilla (background-size: cover), sin márgenes.
export const LADO = 100
export const CENTRO = 50
/** Línea base: donde apoya la peana. */
export const BASE = 88
/**
 * Grosor del borde: el contorno de tinta de las blancas y el filete claro de
 * las negras. Va centrado en el trazo, así que la mitad cae fuera.
 */
export const CONTORNO = 4
/** Grosor de las líneas interiores (juntas, filetes de taracea). */
export const LINEA = 3
/**
 * Grosor del perfil de tinta que rodea a las negras por fuera del filete
 * claro. Sobre el arce el filete casi no se ve (1,2:1) y la pieza parecía
 * llevar un halo: el perfil marca el borde, y el filete queda incrustado entre
 * dos líneas oscuras. Con 2 es una línea de 1,1 a 1,4 px en el escritorio
 * (casillas de 56 a 72 px), sin suavizarse a gris como una de menos de un
 * píxel, y de 1,3 a 1,6 px del dispositivo en el móvil; mide la mitad del
 * filete, que sigue mandando. Lo eligió Jorge el 24-oct-2026 entre 1,5, 2 y
 * 2,5, con el caballo.
 */
export const SOMBRA = 2

/*
 * Con el perfil, la negra asoma 4 unidades por fuera de su forma (medio
 * filete y el perfil) y la blanca, 2 (medio contorno): la negra salía un 7 %
 * más ancha y un 5 % más alta. Se encoge sobre el centro de la línea base lo
 * que crece una pieza típica de la familia, de unos 70 de lado: con el
 * perfil de 2, al 94,6 %. Así las dos ocupan lo mismo en la casilla.
 */
const TIPICA = 70

/*
 * Esquinas que ocupan las coordenadas (9 px fijos, chessground.base.css, con
 * los ajustes de board.css): el número arriba a la izquierda (x < .., y < ..)
 * y la letra abajo a la derecha (x > .., y > ..). La pieza se pinta encima y
 * las taparía. Con la casilla de 41 px (el móvil), la peana de las negras,
 * con su perfil, roza el borde de la letra en menos de un píxel; con la de 32
 * (--board-min: 16rem, pantallas muy estrechas), la peana tapa un poco la
 * letra.
 */
export const ESQUINAS = {
	41: { numero: { x: 20, y: 21 }, letra: { x: 79, y: 76 } },
	32: { numero: { x: 26, y: 27 }, letra: { x: 73, y: 69 } }
}

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
const nogal = rgba(token('board-dark'))
const ultima = rgba(token('board-last-move'))
const elegida = rgba(token('board-selected'))

/**
 * Las casillas sobre las que se mide, con el contraste que se pide. WCAG no
 * tiene AAA para gráficos (1.4.11 pide 3:1): se usan los umbrales del texto.
 * Sobre el nogal, 7:1 es imposible (el máximo es 5,1:1, con blanco puro), así
 * que se pide 4,5:1. Las marcadas son de paso: 3:1. El jaque, en el centro del
 * degradado rojo de board.css, donde es más intenso.
 */
export const CASILLAS = [
	{ nombre: 'arce', color: hex(arce), umbral: 7 },
	{ nombre: 'nogal', color: hex(nogal), umbral: 4.5 },
	{ nombre: 'arce, última', color: hex(sobre(ultima, arce)), umbral: 3 },
	{ nombre: 'nogal, última', color: hex(sobre(ultima, nogal)), umbral: 3 },
	{ nombre: 'arce, elegida', color: hex(sobre(elegida, arce)), umbral: 3 },
	{ nombre: 'nogal, elegida', color: hex(sobre(elegida, nogal)), umbral: 3 },
	{ nombre: 'jaque', color: '#ff0000', umbral: 3 }
]

// Trazados. Los números van con un decimal como mucho: cada SVG tiene que
// quedar por debajo de 4 KB para que Vite la incruste en el CSS.
const n = (x) => String(Math.round(x * 10) / 10)
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

/**
 * La peana común, como tramos de un perfil de torno: del hombro, en
 * (50 + semiancho − 3, BASE − alto), hasta el eje en la línea base.
 */
export function peana(semiancho, alto = 10) {
	const x = CENTRO + semiancho
	const y = BASE - alto
	return [
		['C', x - 1.2, y, x, y + 1.2, x, y + 3],
		['L', x, BASE - 2],
		['Q', x, BASE, x - 2, BASE],
		['L', CENTRO, BASE]
	]
}

/** Filete de taracea a lo largo de la peana. */
export function filetePeana(semiancho, alto = 10) {
	const y = BASE - alto / 2 + 0.5
	return `M${pt(CENTRO - semiancho + 5, y)}H${n(CENTRO + semiancho - 5)}`
}

export function circulo(cx, cy, r) {
	return `M${pt(cx - r, cy)}A${n(r)} ${n(r)} 0 1 1 ${pt(cx + r, cy)}A${n(r)} ${n(r)} 0 1 1 ${pt(cx - r, cy)}Z`
}

/** Rectángulo con las esquinas redondeadas (radio r). */
export function rect(x, y, ancho, alto, r = 0) {
	if (!r) return `M${pt(x, y)}H${n(x + ancho)}V${n(y + alto)}H${n(x)}Z`
	return (
		`M${pt(x + r, y)}H${n(x + ancho - r)}Q${pt(x + ancho, y)} ${pt(x + ancho, y + r)}V${n(y + alto - r)}` +
		`Q${pt(x + ancho, y + alto)} ${pt(x + ancho - r, y + alto)}H${n(x + r)}Q${pt(x, y + alto)} ${pt(x, y + alto - r)}` +
		`V${n(y + r)}Q${pt(x, y)} ${pt(x + r, y)}Z`
	)
}

/** Polígono cerrado por sus vértices: poligono([x, y], [x, y]…). */
export function poligono(...vertices) {
	return `M${vertices.map(([x, y]) => pt(x, y)).join('L')}Z`
}

/**
 * La SVG de una pieza. `pieza.partes` son las piezas de torno, de atrás
 * adelante: cada una con su relleno y su borde, así que donde una tapa a otra
 * queda la junta. `pieza.lineas`, trazos abiertos (juntas, filetes);
 * `pieza.marcas`, formas rellenas del color del borde (un ojo, una ranura).
 * Las negras son las blancas con los colores cambiados: el borde claro queda
 * fuera, que es lo que las separa del nogal. Con `sombra`, las negras llevan
 * además el perfil de tinta: una capa bajo toda la silueta, más ancha que el
 * filete, que sólo asoma por fuera y no se ve en las juntas. Y van encogidas
 * (ver TIPICA, o `escala`) para ocupar lo mismo que las blancas.
 */
export function svgPieza(pieza, color, { contorno = CONTORNO, linea = LINEA, sombra = SOMBRA, escala } = {}) {
	const [relleno, borde] = color === 'w' ? [COLORES.claro, COLORES.tinta] : [COLORES.tinta, COLORES.claro]
	const partes = pieza.partes.map((d) => `<path d="${d}"/>`).join('')
	const lineas = pieza.lineas ? `<path fill="none" stroke-width="${linea}" d="${pieza.lineas}"/>` : ''
	const marcas = pieza.marcas ? `<path fill="${borde}" stroke="none" d="${pieza.marcas}"/>` : ''
	const conPerfil = color === 'b' && sombra > 0
	const perfil = conPerfil
		? `<g fill="${COLORES.tinta}" stroke="${COLORES.tinta}" stroke-width="${contorno + 2 * sombra}" stroke-linejoin="round">${partes}</g>`
		: ''
	const dibujo =
		`${perfil}<g fill="${relleno}" stroke="${borde}" stroke-width="${contorno}" stroke-linejoin="round" stroke-linecap="round">` +
		`${partes}${lineas}${marcas}</g>`
	const k = conPerfil ? (escala ?? TIPICA / (TIPICA + 2 * sombra)) : 1
	// Encogida sobre el centro de la línea base y subida lo que el perfil
	// asoma por debajo de la peana, para que apoye donde la blanca.
	const sube = (contorno / 2 + sombra) * k - contorno / 2
	const contenido =
		k === 1 ? dibujo : `<g transform="translate(${CENTRO} ${n(BASE - sube)}) scale(${+k.toFixed(3)}) translate(-${CENTRO} -${BASE})">${dibujo}</g>`
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LADO} ${LADO}">${contenido}</svg>`
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
function pintar(svg, px, contorno) {
	const { width: ancho, height: alto, pixels } = new Resvg(svg, { fitTo: { mode: 'width', value: px } }).render()
	const silueta = new Uint8Array(ancho * alto)
	for (let i = 0; i < silueta.length; i++) silueta[i] = pixels[i * 4 + 3] >= 128 ? 1 : 0
	let cuerpo = silueta
	for (let i = 0; i < Math.max(1, Math.round((contorno * px) / LADO)); i++) cuerpo = erosionar(cuerpo, ancho, alto)
	const fuera = (x, y) => x < 0 || y < 0 || x >= ancho || y >= alto || !silueta[y * ancho + x]
	const orilla = []
	for (let y = 0; y < alto; y++) {
		for (let x = 0; x < ancho; x++) {
			if (silueta[y * ancho + x] && (fuera(x - 1, y) || fuera(x + 1, y) || fuera(x, y - 1) || fuera(x, y + 1))) orilla.push(y * ancho + x)
		}
	}
	const radio = Math.max(1, Math.ceil((contorno * px) / LADO))
	return { pixels, ancho, alto, silueta, cuerpo, orilla, radio }
}

/**
 * Contraste de una pieza pintada sobre una casilla: el del borde y el del
 * cuerpo frente a la casilla. Una pieza se ve si destaca su borde o su
 * cuerpo: una blanca sobre el nogal se ve por el relleno, no por el contorno
 * de tinta.
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

/** Contraste de una pieza sobre una casilla, a `px` píxeles de lado. */
export function medir(svg, casilla, px, contorno = CONTORNO) {
	return medirSobre(pintar(svg, px, contorno), casilla)
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
export function informe(pieza, opciones = {}) {
	const filas = []
	for (const color of ['w', 'b']) {
		const svg = svgPieza(pieza, color, opciones)
		// El borde de la negra con perfil es más ancho: perfil y filete.
		const grosor = (opciones.contorno ?? CONTORNO) + (color === 'b' ? (opciones.sombra ?? SOMBRA) : 0)
		for (const tamano of TAMANOS) {
			const pintada = pintar(svg, tamano.css * tamano.dpr, grosor)
			for (const casilla of CASILLAS) {
				const { borde, cuerpo } = medirSobre(pintada, casilla.color)
				const valor = Math.max(borde, cuerpo)
				filas.push({ color, casilla: casilla.nombre, ...tamano, borde, cuerpo, valor, umbral: casilla.umbral, ok: valor >= casilla.umbral })
			}
		}
	}
	return filas
}
