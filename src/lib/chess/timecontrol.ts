// Ritmo de juego: clasificación FIDE en estándar, rápidas o blitz.
//
// Las Leyes del Ajedrez de la FIDE (apéndices A y B) miden el tiempo asignado
// más 60 veces el incremento: hasta 10 minutos es blitz; más de 10 y menos de
// 60, rápidas; 60 o más, estándar. Con la base en minutos y el incremento en
// segundos, eso es sumar los dos números: 30'+30" da 60 y es estándar; 10'+3",
// 13 y son rápidas.
//
// El ritmo de los torneos de info64 es texto libre del organizador, en inglés,
// español, catalán o gallego: "90 minutes + 30 seconds per move",
// "Estandar: 60 min. + 30 seg. por jugada", "10'+3''",
// "90min/40moves+30min/end+30sec per move from 1st", "10+3"...
import { stripDiacritics } from './names'

export const TIME_CLASSES = ['standard', 'rapid', 'blitz'] as const
export type TimeClass = (typeof TIME_CLASSES)[number]

export const TIME_CLASS_LABEL: Record<TimeClass, string> = {
	standard: 'Estándar',
	rapid: 'Rápidas',
	blitz: 'Blitz'
}

/** Clase según los minutos que cuenta la FIDE (base + 60 × incremento). */
export function classifyMinutes(minutes: number): TimeClass {
	if (minutes <= 10) return 'blitz'
	if (minutes < 60) return 'rapid'
	return 'standard'
}

/**
 * Ritmo de una partida: el del texto del torneo y, si no se entiende, el de la
 * cabecera TimeControl del PGN; si ninguno trae cifras, las palabras del texto
 * ("blitz", "rápido", "estándar"...). null si no se sabe.
 */
export function timeClassOf(tournamentText: string | null | undefined, pgnTag?: string | null): TimeClass | null {
	const minutes = parseTimeControlText(tournamentText) ?? parseTimeControlTag(pgnTag)
	return minutes === null ? keywordClass(tournamentText) : classifyMinutes(minutes)
}

// Recuentos de jugadas, que no son tiempo: "40 moves", "90min/40moves", "40/90 minutes".
const MOVE_COUNTS = /\b\d+\s*(?:moves?|movimientos?|movs?|jugadas?|jugs?|xogadas?)\b|\b\d+\s*\/\s*(?=\d)/g
// Unidades. Quitados los recuentos de jugadas, una palabra que empieza por "m"
// tras un número son minutos: así entran "mn", "mi" y erratas como "mintos" o
// "minuos" (y "90 más 30", que también son 90 minutos).
const NUMBER =
	/(\d+(?:[.,]\d+)?)\s*(horas?\b|hours?\b|h\b|m[a-z]*|segundos?\b|seconds?\b|segons?\b|segs?\b|secs?\b|sg\b|se\b|s\b)?/g
// "15 finish", "10 finis": minutos a caída de bandera.
const FINISH = /^(?:finish|finis|final)\b/

/**
 * Minutos FIDE (base + incremento en segundos) de un texto de ritmo, o null si
 * no trae una base. Los periodos se suman: 90'/40 + 30' + 30" da 150.
 */
export function parseTimeControlText(text: string | null | undefined): number | null {
	if (!text) return null
	const normalized = stripDiacritics(text)
		.toLowerCase()
		.replace(/[´’‘`]/g, "'")
		.replace(/''|["“”]/g, ' s ')
		.replace(/'/g, ' min ')
		.replace(MOVE_COUNTS, ' ')

	let minutes = 0
	let increment = 0
	const bare: { value: number; before: string; after: string }[] = []
	for (const match of normalized.matchAll(NUMBER)) {
		const value = Number(match[1].replace(',', '.'))
		const unit = match[2]
		if (!unit) {
			const before = normalized.slice(0, match.index).trimEnd()
			const after = normalized.slice(match.index + match[0].length).trimStart()
			bare.push({ value, before, after })
		} else if (unit.startsWith('h')) minutes += 60 * value
		else if (unit.startsWith('m')) minutes += value
		else increment = Math.max(increment, value)
	}
	// Números sin unidad:
	// - tras una barra son jugadas ("100'/40");
	// - antes de un "+" o de "finish", o solos en el texto, son la base en
	//   minutos ("90+30", "60 + 30 seg", "15 finish", "20");
	// - tras un "+", el incremento en segundos si no lo hay ya ("10+3").
	const hasIncrement = increment > 0
	for (const { value, before, after } of bare) {
		if (before.endsWith('/')) continue
		if (after.startsWith('+') || FINISH.test(after) || (before === '' && after === '')) minutes += value
		else if (before.endsWith('+') && !hasIncrement) increment = Math.max(increment, value)
	}
	return minutes > 0 ? minutes + increment : null
}

/**
 * Minutos FIDE de una cabecera TimeControl: "5400+30", "40/5400+30:1800+30".
 * El estándar PGN la da en segundos, pero los PGN de los tableros DGT de info64
 * la traen en minutos ("30+30", "90+30"). Ninguna partida presencial tiene
 * menos de 3 minutos de base, así que una base menor de 180 son minutos.
 */
export function parseTimeControlTag(tag: string | null | undefined): number | null {
	const periods = (tag ?? '').split(':').map((period) => {
		const match = /^\s*(?:\d+\/)?(\d+)(?:\+(\d+))?\s*$/.exec(period)
		return match ? { base: Number(match[1]), increment: Number(match[2] ?? 0) } : null
	})
	if (periods.length === 0 || periods.some((p) => p === null)) return null
	const valid = periods as { base: number; increment: number }[]
	const inMinutes = valid[0].base < 180
	const base = valid.reduce((sum, p) => sum + (inMinutes ? p.base : p.base / 60), 0)
	return base > 0 ? base + valid[0].increment : null
}

function keywordClass(text: string | null | undefined): TimeClass | null {
	const normalized = stripDiacritics(text ?? '').toLowerCase()
	if (/\b(?:blitz|relampago)/.test(normalized)) return 'blitz'
	if (/\b(?:rapid|semirapid|semirrapid)/.test(normalized)) return 'rapid'
	if (/\b(?:standard|estandar|clasic|classic|lent[ao])/.test(normalized)) return 'standard'
	return null
}
