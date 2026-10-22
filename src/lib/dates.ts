// Fechas como texto ISO (YYYY-MM-DD), en UTC. Es el formato que guardan D1 y
// las fuentes, y se compara bien como cadena.

export function isoDate(date: Date): string {
	return date.toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
	const date = new Date(`${day}T00:00:00Z`)
	date.setUTCDate(date.getUTCDate() + days)
	return isoDate(date)
}

/** Primer año verosímil de una fecha de las fuentes (torneos y partidas). */
const FIRST_YEAR = 1850

/**
 * La fecha si es un día real ('YYYY-MM-DD') entre 1850 y el año que viene; si
 * no, null. Las fuentes traen a veces meses 13, días 45 o años 0001 y 9999: un
 * día así haría fallar addDays (RangeError) o encabezaría siempre las listas.
 */
export function validDate(day: string | null | undefined, now = new Date()): string | null {
	if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
	const date = new Date(`${day}T00:00:00Z`)
	if (Number.isNaN(date.getTime()) || isoDate(date) !== day) return null
	const year = date.getUTCFullYear()
	return year >= FIRST_YEAR && year <= now.getUTCFullYear() + 1 ? day : null
}

/** Mismo día `years` años después (o antes, si es negativo). */
export function addYears(day: string, years: number): string {
	const date = new Date(`${day}T00:00:00Z`)
	date.setUTCFullYear(date.getUTCFullYear() + years)
	return isoDate(date)
}

const MADRID = new Intl.DateTimeFormat('en', {
	timeZone: 'Europe/Madrid',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
})

/**
 * Fecha y hora local de España peninsular ('YYYY-MM-DD HH:MM'), el formato en
 * que info64 publica el horario de las rondas. En Canarias es una hora menos:
 * se acepta ese desfase.
 */
export function madridDateTime(date: Date): string {
	const part = Object.fromEntries(MADRID.formatToParts(date).map((p) => [p.type, p.value]))
	return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}`
}

/** Día en España peninsular ('YYYY-MM-DD'). */
export function madridDate(date: Date): string {
	return madridDateTime(date).slice(0, 10)
}

/** Año en España peninsular. */
export function madridYear(date: Date): number {
	return Number(madridDate(date).slice(0, 4))
}

/** Último día del mes que está `months - 1` meses después del de `day`. */
export function endOfMonth(day: string, months = 1): string {
	const date = new Date(`${day}T00:00:00Z`)
	return isoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 0)))
}
