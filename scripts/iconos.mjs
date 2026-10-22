// Genera public/favicon.ico (32×32) y public/apple-touch-icon.png (180×180)
// a partir de public/favicon.svg, la marca con los colores escritos. Se
// ejecuta a mano cuando cambia el logo: `node scripts/iconos.mjs`.
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
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
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
