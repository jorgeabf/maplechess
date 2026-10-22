// Genera public/favicon.ico (32×32), public/apple-touch-icon.png (180×180) y
// los iconos de la app web instalada a partir de public/favicon.svg, la marca
// con los colores escritos, y la tarjeta que se ve al compartir un enlace
// (src/assets/compartir.png). Se ejecuta a mano cuando cambia el logo, el
// nombre o las maderas: `node scripts/iconos.mjs`.
//
// public/favicon.svg es «!?» (jugada interesante) con los mismos trazos que
// src/components/Logo.astro y los colores de los tokens walnut y maple-pale
// escritos, porque un favicón no ve los tokens. No lleva comentarios: se sirve
// tal cual. Tampoco media queries: Safari las ignora en los favicones, y la
// losa de nogal se ve en pestañas claras y oscuras.
//
// - favicon.ico: para Windows, lectores de RSS y navegadores que no leen el
//   SVG. Un ICO puede llevar un PNG dentro (desde Windows Vista): basta una
//   imagen de 32 px.
// - apple-touch-icon.png: iOS redondea las esquinas y pinta de negro lo
//   transparente, así que va opaco y a sangre, con el color de la losa de fondo.
// - icono-192.png e icono-512.png: los del manifest (src/lib/manifest.ts), la
//   losa tal cual. Chrome pide los dos tamaños para ofrecer la instalación.
// - icono-maskable-512.png: el que Android recorta con la forma del lanzador
//   (círculo, gota, cuadrado redondeado). Va a sangre, sin esquinas, y con el
//   «!?» al 80 %, dentro de la zona segura: el círculo central de radio 0,4 del
//   lado.
// - compartir.png: 1200×630, el tamaño que WhatsApp, Telegram, X y LinkedIn
//   enseñan en grande. La losa y, debajo, «MapleChess» (scripts/nombre-marca.svg,
//   en trazos) sobre arce claro, con una franja de casillas de arce y nogal
//   abajo. Logo y nombre van apilados en el centro: algunas apps recortan la
//   imagen a un cuadrado. Los colores salen de los tokens de global.css. Base.astro
//   la importa, así que lleva hash y cambia de URL al regenerarla.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const svg = readFileSync(join(pub, 'favicon.svg'), 'utf8')

const png = (size, background) => new Resvg(svg, { fitTo: { mode: 'width', value: size }, background }).render().asPng()

// La losa es el primer <rect>: su color rellena las esquinas del icono de iOS.
const tile = svg.match(/<rect[^>]*\sfill="(#[0-9a-f]{6})"/i)?.[1]
if (!tile) throw new Error('[iconos] no encuentro el color de la losa en favicon.svg')

writeFileSync(join(pub, 'apple-touch-icon.png'), png(180, tile))

// ICO con una sola imagen PNG: cabecera de 6 bytes, una entrada de 16 y el PNG.
const image = png(32)
const header = Buffer.alloc(22)
header.writeUInt16LE(0, 0) // reservado
header.writeUInt16LE(1, 2) // tipo: icono
header.writeUInt16LE(1, 4) // número de imágenes
header.writeUInt8(32, 6) // ancho
header.writeUInt8(32, 7) // alto
header.writeUInt8(0, 8) // colores de paleta: ninguno
header.writeUInt8(0, 9) // reservado
header.writeUInt16LE(1, 10) // planos
header.writeUInt16LE(32, 12) // bits por píxel
header.writeUInt32LE(image.length, 14) // tamaño del PNG
header.writeUInt32LE(header.length, 18) // dónde empieza el PNG
writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([header, image]))

console.log(`[iconos] favicon.ico (32 px) y apple-touch-icon.png (180 px, fondo ${tile}) → public/`)

// Iconos de la app web instalada.
writeFileSync(join(pub, 'icono-192.png'), png(192))
writeFileSync(join(pub, 'icono-512.png'), png(512))
const glyph = svg.match(/<g[\s\S]*<\/g>/)?.[0]
if (!glyph) throw new Error('[iconos] no encuentro el «!?» en favicon.svg')
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
	<rect width="32" height="32" fill="${tile}"/>
	<g transform="translate(16 16) scale(0.8) translate(-16 -16)">${glyph}</g>
</svg>`
writeFileSync(
	join(pub, 'icono-maskable-512.png'),
	new Resvg(maskable, { fitTo: { mode: 'width', value: 512 } }).render().asPng()
)
console.log('[iconos] icono-192.png, icono-512.png e icono-maskable-512.png → public/')

// Tarjeta para compartir.
const css = readFileSync(join(root, 'src', 'styles', 'global.css'), 'utf8')
const token = (name) => {
	const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
	if (!value) throw new Error(`[iconos] no encuentro --${name} en global.css`)
	return value
}
const name = readFileSync(join(root, 'scripts', 'nombre-marca.svg'), 'utf8')
const [nameX, nameY, nameW, nameH] = name.match(/viewBox="([^"]+)"/)?.[1].split(' ').map(Number) ?? []
const namePath = name.match(/<path d="([^"]+)"/)?.[1]
if (!namePath || !nameW) throw new Error('[iconos] nombre-marca.svg sin viewBox o sin trazo')
const logo = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1]

const W = 1200
const H = 630
// Franja: dos filas de casillas de 60 px, 20 por fila. La de abajo a la
// derecha es clara, como h1 en un tablero.
const SQUARE = 60
const band = H - 2 * SQUARE
const squares = []
for (let row = 0; row < 2; row++) {
	for (let col = 0; col < W / SQUARE; col++) {
		const light = (row + col) % 2 === 1
		squares.push(
			`<rect x="${col * SQUARE}" y="${band + row * SQUARE}" width="${SQUARE}" height="${SQUARE}" fill="${token(light ? 'maple' : 'walnut')}"/>`
		)
	}
}
// Losa de 180 px y nombre de 532 px de ancho (cabe en el recorte cuadrado
// central, de 630), centrados en el hueco que deja la franja.
const TILE = 180
const GAP = 44
const NAME_WIDTH = 532
const scale = NAME_WIDTH / nameW
const stack = TILE + GAP + nameH * scale
const top = (band - stack) / 2
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
	<rect width="${W}" height="${H}" fill="${token('maple-pale')}"/>
	<g transform="translate(${(W - TILE) / 2} ${top}) scale(${TILE / 32})">${logo}</g>
	<path transform="translate(${(W - NAME_WIDTH) / 2} ${top + TILE + GAP}) scale(${scale}) translate(${-nameX} ${-nameY})" fill="${token('walnut-dark')}" d="${namePath}"/>
	${squares.join('')}
</svg>`
const share = join(root, 'src', 'assets', 'compartir.png')
writeFileSync(share, new Resvg(card).render().asPng())
console.log(`[iconos] compartir.png (${W}×${H}) → src/assets/`)
