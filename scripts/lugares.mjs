// Genera src/lib/lugares.json, los datos con los que src/lib/lugares.ts saca la
// provincia de un torneo de su ciudad, a partir de data/lugares/:
// - municipios.tsv: el código y el nombre de cada municipio, de la «Relación
//   de municipios y sus códigos por provincias» del INE (CC BY 4.0);
// - nucleos.tsv: el código del municipio, el nombre y los habitantes de cada
//   núcleo de población de 100 habitantes o más, del Nomenclátor Geográfico de
//   Municipios y Entidades de Población del IGN (CC BY 4.0);
// y los nombres de los países, en inglés y en castellano (Intl.DisplayNames),
// para reconocer las ciudades del extranjero.
//
// La población de cada municipio es la suma de la de esos núcleos: sólo sirve
// para desempatar entre homónimos. Los núcleos que se llaman como su municipio
// (la capital) no se repiten.
//
//   node scripts/lugares.mjs                    regenera el JSON
//   node scripts/lugares.mjs --descargar 2026   antes, vuelve a descargar los
//                                               TSV (el año de la relación del INE)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'data', 'lugares')
const outFile = join(root, 'src', 'lib', 'lugares.json')

const MIN_HABITANTES = 100

/** Países con otros nombres que los de Intl.DisplayNames, como los escriben las retransmisiones. */
const OTROS_PAISES = ['England', 'Scotland', 'Wales', 'Northern Ireland', 'USA', 'UK', 'UAE', 'Czech Republic', 'Holland']

/** España, Canarias y Ceuta y Melilla no son el extranjero. */
const NO_EXTRANJERO = new Set(['ES', 'IC', 'EA'])

const args = process.argv.slice(2)
const i = args.indexOf('--descargar')
if (i !== -1) {
	const year = args[i + 1]
	if (!/^\d{4}$/.test(year ?? '')) throw new Error('[lugares] --descargar necesita el año de la relación del INE')
	await downloadMunicipalities(year)
	await downloadNuclei()
}
build()

function build() {
	const municipalities = readTsv('municipios.tsv').map(([code, name]) => ({ code, name }))
	const known = new Set(municipalities.map((m) => m.code))
	const nuclei = readTsv('nucleos.tsv').map(([code, name, people]) => ({ code, name, people: Number(people) }))
	const population = new Map()
	for (const n of nuclei) population.set(n.code, (population.get(n.code) ?? 0) + n.people)
	const forms = new Map(municipalities.map((m) => [m.code, new Set(nameForms(m.name).map((f) => f.toLowerCase()))]))
	const data = {
		municipios: municipalities.map((m) => [m.code, m.name, population.get(m.code) ?? 0]),
		nucleos: nuclei
			.filter((n) => known.has(n.code) && !forms.get(n.code).has(n.name.toLowerCase()))
			.map((n) => [n.code, n.name, n.people]),
		paises: countries()
	}
	writeFileSync(outFile, JSON.stringify(data) + '\n')
	console.log(
		`[lugares] ${data.municipios.length} municipios, ${data.nucleos.length} núcleos, ${data.paises.length} nombres de país → ${outFile}`
	)
}

/** Las formas del nombre de un municipio: cada denominación y, con el artículo pospuesto, delante («Coruña, A»). */
function nameForms(name) {
	return name.split('/').map((part) => {
		const m = /^(.*), (\S+)$/.exec(part.trim())
		if (!m) return part.trim()
		return m[2].endsWith("'") ? `${m[2]}${m[1]}` : `${m[2]} ${m[1]}`
	})
}

function countries() {
	const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
	const codes = [...letters].flatMap((a) => [...letters].map((b) => a + b)).filter((code) => !NO_EXTRANJERO.has(code))
	const names = new Set(OTROS_PAISES)
	for (const locale of ['en', 'es']) {
		for (const style of ['long', 'short']) {
			const display = new Intl.DisplayNames([locale], { type: 'region', style, fallback: 'none' })
			for (const code of codes) {
				const name = display.of(code)
				if (name) names.add(name)
			}
		}
	}
	return [...names].sort()
}

function readTsv(file) {
	const [, ...rows] = readFileSync(join(dataDir, file), 'utf8').trim().split(/\r?\n/)
	return rows.map((row) => row.split('\t'))
}

function writeTsv(file, header, rows) {
	writeFileSync(join(dataDir, file), [header, ...rows].map((row) => row.join('\t')).join('\n') + '\n')
	console.log(`[lugares] ${rows.length} filas → data/lugares/${file}`)
}

/** La relación del INE: un xlsx con una hoja por provincia y una fila por municipio (CPRO, CMUN, DC, NOMBRE). */
async function downloadMunicipalities(year) {
	const url = `https://www.ine.es/daco/daco42/codmun/${year.slice(2)}codmun.xlsx`
	const response = await fetch(url)
	if (!response.ok) throw new Error(`[lugares] ${url}: ${response.status}`)
	const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
	const xml = (path) => strFromU8(files[path])
	const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map(([, si]) =>
		decode([...si.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(([, t]) => t).join(''))
	)
	const rows = []
	for (const path of Object.keys(files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
		for (const [, row] of xml(path).matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
			const cells = [...row.matchAll(/<c ([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)].map(([, attrs, body = '']) => {
				const value = /<v>(.*?)<\/v>/s.exec(body)?.[1] ?? /<t[^>]*>(.*?)<\/t>/s.exec(body)?.[1] ?? ''
				return /\bt="s"/.test(attrs) ? shared[Number(value)] : decode(value)
			})
			const [cpro, cmun, , name] = cells
			if (/^\d{1,2}$/.test(cpro ?? '') && /^\d{1,3}$/.test(cmun ?? '') && name) {
				rows.push([cpro.padStart(2, '0') + cmun.padStart(3, '0'), name.trim()])
			}
		}
	}
	rows.sort(([a], [b]) => a.localeCompare(b))
	writeTsv('municipios.tsv', ['codigo', 'nombre'], rows)
}

/** Los núcleos de población del IGN (colección nuc de su API OGC), sin geometría, de 5.000 en 5.000. */
async function downloadNuclei() {
	const rows = []
	for (let offset = 0, total = Infinity; offset < total; offset += 5000) {
		const url =
			'https://api-features.ign.es/collections/nuc/items?f=json&skipGeometry=true' +
			`&properties=nombre,codine,habitantes&limit=5000&offset=${offset}`
		const response = await fetch(url)
		if (!response.ok) throw new Error(`[lugares] ${url}: ${response.status}`)
		const page = await response.json()
		total = page.numberMatched
		for (const { properties: p } of page.features) {
			if ((p.habitantes ?? 0) >= MIN_HABITANTES) rows.push([String(p.codine).slice(0, 5), p.nombre.trim(), p.habitantes])
		}
		if (page.numberReturned === 0) break
		await new Promise((resolve) => setTimeout(resolve, 1000))
	}
	rows.sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y))
	writeTsv('nucleos.tsv', ['codigo', 'nombre', 'habitantes'], rows)
}

function decode(text) {
	return text
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&')
}
