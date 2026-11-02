// Lectura de las listas de la FIDE (players_list.zip, la combinada, y las de
// rápido y relámpago → TXT).
//
// Son ficheros de ancho fijo: cada columna empieza donde empieza su título
// en la línea de cabecera. Las posiciones se leen de esa cabecera en vez de
// fijarlas a mano, por si la FIDE las cambia.

export interface FidePlayer {
	fideId: number
	name: string
	fed: string
	sex: string | null
	title: string | null
	birthYear: number | null
	ratingStd: number | null
	ratingRapid: number | null
	ratingBlitz: number | null
	/** Inactivo en estándar: la combinada sólo trae la marca de ese ritmo. */
	inactive: boolean
	/** Inactivo en rápido y en relámpago, de sus listas; null si no está en ella. */
	rapidInactive: boolean | null
	blitzInactive: boolean | null
}

/** Una línea de la lista de rápido o de relámpago: sólo su marca. */
export interface FideFlag {
	fideId: number
	fed: string
	inactive: boolean
}

export type Layout = Map<string, { start: number; end: number }>

const PLAYER_COLUMNS = ['ID Number', 'Name', 'Fed', 'Sex', 'Tit', 'WTit', 'SRtng', 'RRtng', 'BRtng', 'B-day', 'Flag']

export function parseHeader(header: string, required: readonly string[] = PLAYER_COLUMNS): Layout {
	const tokens = [...header.matchAll(/\S+/g)].map((m) => ({ name: m[0], start: m.index }))
	// "ID Number" son dos palabras de una misma columna.
	const merged = tokens.filter((t, i) => !(t.name === 'Number' && tokens[i - 1]?.name === 'ID'))
	const layout: Layout = new Map()
	merged.forEach((t, i) => {
		const name = t.name === 'ID' ? 'ID Number' : t.name
		layout.set(name, { start: t.start, end: merged[i + 1]?.start ?? Infinity })
	})
	for (const column of required) {
		if (!layout.has(column)) throw new Error(`Lista FIDE: falta la columna "${column}" en la cabecera`)
	}
	return layout
}

function field(line: string, layout: Layout, name: string): string {
	const col = layout.get(name)
	return col ? line.slice(col.start, col.end).trim() : ''
}

function positive(text: string): number | null {
	const value = Number.parseInt(text, 10)
	return Number.isFinite(value) && value > 0 ? value : null
}

export function parsePlayerLine(line: string, layout: Layout): FidePlayer | null {
	const fideId = positive(field(line, layout, 'ID Number'))
	const name = field(line, layout, 'Name')
	if (!fideId || !name) return null
	const flag = field(line, layout, 'Flag')
	return {
		fideId,
		name,
		fed: field(line, layout, 'Fed'),
		sex: field(line, layout, 'Sex') || null,
		// Título absoluto (GM, IM, FM, CM) o, si no tiene, el femenino (WGM…).
		title: field(line, layout, 'Tit') || field(line, layout, 'WTit') || null,
		birthYear: positive(field(line, layout, 'B-day')),
		ratingStd: positive(field(line, layout, 'SRtng')),
		ratingRapid: positive(field(line, layout, 'RRtng')),
		ratingBlitz: positive(field(line, layout, 'BRtng')),
		// Flag: "i" inactivo, "w" mujer, "wi" ambas.
		inactive: flag.includes('i'),
		rapidInactive: null,
		blitzInactive: null
	}
}

/**
 * Una línea de la lista de rápido o de relámpago. Su ELO va en una columna con
 * el nombre del mes («NOV26»): no se lee, porque ya está en la combinada.
 */
export function parseFlagLine(line: string, layout: Layout): FideFlag | null {
	const fideId = positive(field(line, layout, 'ID Number'))
	if (!fideId) return null
	return { fideId, fed: field(line, layout, 'Fed'), inactive: field(line, layout, 'Flag').includes('i') }
}

/** Qué columnas necesita cada lista y cómo se lee cada línea. */
export interface ListFormat<T> {
	columns: readonly string[]
	parse: (line: string, layout: Layout) => T | null
}

export const PLAYERS_LIST: ListFormat<FidePlayer> = { columns: PLAYER_COLUMNS, parse: parsePlayerLine }
export const FLAGS_LIST: ListFormat<FideFlag> = { columns: ['ID Number', 'Fed', 'Flag'], parse: parseFlagLine }

const NEWLINE = 0x0a

/**
 * Parser incremental: recibe el fichero en trozos de bytes (tal como salen del
 * descompresor) y entrega las filas de la federación indicada.
 *
 * La federación se mira en los bytes, y sólo se decodifican las líneas que
 * casan, cada una por separado. Al decodificar el texto entero, V8 saca cada
 * línea y cada nombre como un trozo de la cadena del bloque descomprimido, sin
 * copiarlo, y el nombre retiene el bloque: con jugadores ESP en todos los
 * bloques, la lista entera (317 MB) se quedaba en memoria, y el Worker tiene
 * 128. Las columnas valen igual en bytes porque el fichero es ASCII.
 */
export class FideListParser<T extends { fed: string }> {
	private layout: Layout | null = null
	/** La línea que quedó a medias al final del trozo anterior. */
	private rest: Uint8Array = new Uint8Array(0)
	private readonly decoder = new TextDecoder('utf-8')
	private readonly fedBytes: Uint8Array

	constructor(
		private readonly fed: string,
		private readonly format: ListFormat<T>,
		private readonly onRow: (row: T) => void
	) {
		this.fedBytes = new TextEncoder().encode(fed)
	}

	push(bytes: Uint8Array): void {
		let start = 0
		if (this.rest.length > 0) {
			const end = bytes.indexOf(NEWLINE)
			if (end === -1) {
				this.rest = concat(this.rest, bytes)
				return
			}
			this.line(concat(this.rest, bytes.subarray(0, end)))
			start = end + 1
		}
		for (let end = bytes.indexOf(NEWLINE, start); end !== -1; end = bytes.indexOf(NEWLINE, start)) {
			this.line(bytes.subarray(start, end))
			start = end + 1
		}
		this.rest = bytes.slice(start)
	}

	end(): void {
		if (this.rest.length > 0) this.line(this.rest)
		this.rest = new Uint8Array(0)
		if (!this.layout) throw new Error('Lista FIDE vacía: no se encontró la cabecera')
	}

	private line(bytes: Uint8Array): void {
		if (!this.layout) {
			this.layout = parseHeader(this.decode(bytes), this.format.columns)
			return
		}
		// Filtro barato antes de decodificar: son ~2 millones de líneas.
		const at = this.layout.get('Fed')!.start
		if (this.fedBytes.some((byte, i) => bytes[at + i] !== byte)) return
		const row = this.format.parse(this.decode(bytes), this.layout)
		if (row && row.fed === this.fed) this.onRow(row)
	}

	private decode(bytes: Uint8Array): string {
		return this.decoder.decode(bytes).replace(/\r$/, '')
	}
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const joined = new Uint8Array(a.length + b.length)
	joined.set(a)
	joined.set(b, a.length)
	return joined
}
