// Formatos de presentación.
import { stripDiacritics } from './chess/names'

const dateFormat = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '—'
	const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
	return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date)
}

const monthFormat = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Mes de una fecha ISO → "octubre de 2026". */
export function formatMonth(iso: string): string {
	const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
	return Number.isNaN(date.getTime()) ? iso : monthFormat.format(date)
}

const roundDayFormat = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Hora de una ronda ('YYYY-MM-DD HH:MM', ya en hora local) → "sáb, 24 oct, 16:00". */
export function formatRoundTime(startsAt: string): string {
	const date = new Date(`${startsAt.slice(0, 10)}T00:00:00Z`)
	if (Number.isNaN(date.getTime())) return startsAt
	const time = startsAt.slice(11, 16)
	return time ? `${roundDayFormat.format(date)}, ${time}` : roundDayFormat.format(date)
}

/** Segundos de reloj → "4 min 30 s", "45 s"; desde 10 minutos, en minutos enteros ("49 min"). */
export function formatDuration(seconds: number): string {
	const total = Math.round(seconds)
	if (total >= 600) return `${Math.round(total / 60)} min`
	const minutes = Math.floor(total / 60)
	const rest = total % 60
	if (minutes === 0) return `${rest} s`
	return rest ? `${minutes} min ${rest} s` : `${minutes} min`
}

/**
 * Fechas de un torneo sin repetir el mes ni el año que comparten:
 * "16–27 sept 2026", "29 ago – 4 sept 2026", "28 dic 2025 – 3 ene 2026".
 */
export function formatRange(start: string | null, end: string | null): string {
	if (!start) return formatDate(end)
	if (!end || end === start) return formatDate(start)
	const [from, to] = [start, end].map((iso) => new Date(`${iso.slice(0, 10)}T00:00:00Z`))
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
		return `${formatDate(start)} – ${formatDate(end)}`
	}
	return dateFormat.formatRange(from, to)
}

/** "1/2-1/2" → "½-½". */
export function formatResult(result: string): string {
	return result === '1/2-1/2' ? '½-½' : result
}

/** Jugada con su número: "12.Nf3" las blancas y "12…Nf6" las negras (`ply` es la media jugada). */
export function formatMove(ply: number, san: string): string {
	return `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}${san}`
}

/**
 * Línea con los números de las jugadas de las blancas: "1.e4 c5 2.Nf3". Si
 * empieza en una de las negras (una variante del motor), con el suyo, como en
 * la lista de jugadas: "34…Qxc3 35.Qa4".
 */
export function formatLine(moves: { ply: number; san: string }[]): string {
	return moves.map((m, i) => (m.ply % 2 === 1 || i === 0 ? formatMove(m.ply, m.san) : m.san)).join(' ')
}

/**
 * Parte de 1 en porcentaje: 0.571 → "57 %". Con espacio de no separación: si
 * el texto parte línea, la cifra no se queda sin su %.
 */
export function formatPercent(share: number): string {
	return `${Math.round(share * 100)} %`
}

/** El color en una frase: «con blancas». */
export const COLOR_NAME = { white: 'blancas', black: 'negras' } as const

/** Resultado desde el punto de vista de un jugador. */
export function outcomeFor(result: string, color: 'white' | 'black'): 'win' | 'draw' | 'loss' | null {
	if (result === '1/2-1/2') return 'draw'
	if (result === '1-0') return color === 'white' ? 'win' : 'loss'
	if (result === '0-1') return color === 'black' ? 'win' : 'loss'
	return null
}

/** Puntos de ajedrez: 4.5 → "4½", 0.5 → "½". */
export function formatPoints(points: number): string {
	const whole = Math.floor(points)
	if (points - whole < 0.5) return String(whole)
	return whole > 0 ? `${whole}½` : '½'
}

const numberFormat = new Intl.NumberFormat('es-ES')

export function formatNumber(n: number): string {
	return numberFormat.format(n)
}

/** Cifra con el nombre en singular o plural: "1 jugador", "12.345 jugadores". */
export function formatCount(n: number, singular: string, plural: string): string {
	return `${formatNumber(n)} ${n === 1 ? singular : plural}`
}

/** "1 partida", "12.345 partidas". */
export function formatGames(n: number): string {
	return formatCount(n, 'partida', 'partidas')
}

/** Ganadas, tablas y perdidas: "5 ganadas, 3 tablas, 1 perdida". "Tablas" no tiene singular: "1 tablas". */
export function formatResults(stats: { wins: number; draws: number; losses: number }): string {
	return `${formatCount(stats.wins, 'ganada', 'ganadas')}, ${formatNumber(stats.draws)} tablas, ${formatCount(stats.losses, 'perdida', 'perdidas')}`
}

/**
 * La lista FIDE distingue a los homónimos con el año de nacimiento, a veces con
 * una letra, detrás del nombre («Supuesto Supuesto, Ruben 1978 I»; unos 1.300
 * españoles). Sobre lo que va tras la coma: el nombre y el año.
 */
const HOMONYM = /^(?:(.*?)\s+)?(\d{4}(?:\s+\S+)?)$/

/**
 * Nombre "Apellidos, Nombre" → "Nombre Apellidos" para títulos. El año de los
 * homónimos va al final, entre paréntesis, y no en mitad del nombre.
 */
export function displayName(name: string): string {
	const comma = name.indexOf(',')
	if (comma === -1) return name
	const surname = name.slice(0, comma).trim()
	const given = name.slice(comma + 1).trim()
	const homonym = HOMONYM.exec(given)
	if (homonym) return `${homonym[1] ? `${homonym[1]} ` : ''}${surname} (${homonym[2]})`
	return given ? `${given} ${surname}` : surname
}

/** Año de los homónimos («Supuesto Supuesto, Ruben 1978 I» → 1978), o null si el nombre no lo lleva. */
export function homonymYear(name: string): number | null {
	const comma = name.indexOf(',')
	if (comma === -1) return null
	const homonym = HOMONYM.exec(name.slice(comma + 1).trim())
	return homonym ? Number(homonym[2].slice(0, 4)) : null
}

/** Nombre FIDE sin el año de los homónimos: «Supuesto Supuesto, Ruben 1978 I» → «Supuesto Supuesto, Ruben». */
export function withoutHomonymYear(name: string): string {
	const comma = name.indexOf(',')
	if (comma === -1) return name
	const homonym = HOMONYM.exec(name.slice(comma + 1).trim())
	if (!homonym) return name
	const surname = name.slice(0, comma).trim()
	return homonym[1] ? `${surname}, ${homonym[1]}` : surname
}

/** Nombre de fichero seguro para descargas. */
export function fileSlug(text: string): string {
	return (
		stripDiacritics(text)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'partidas'
	)
}
