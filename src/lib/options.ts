// Opciones, con su texto, de los filtros de periodo y ritmo que comparten el
// repertorio y el dossier (se pintan con Segmented.astro).
import { TIME_CLASS_LABEL, TIME_CLASSES, type TimeClass } from './chess/timecontrol'
import type { RepertoireSearch } from './params'

export const PERIOD_OPTIONS: readonly { id: RepertoireSearch['period']; label: string }[] = [
	{ id: '2', label: 'Últimos 2 años' },
	{ id: '5', label: 'Últimos 5 años' },
	{ id: '', label: 'Todas' }
]

/** El id '' son todos los ritmos. */
export const TIME_CLASS_OPTIONS: readonly { id: string; label: string }[] = [
	{ id: '', label: 'Todos' },
	...TIME_CLASSES.map((t) => ({ id: t, label: TIME_CLASS_LABEL[t] }))
]

/*
 * Lo elegido, para el resumen de los filtros plegados (FiltrosPlegables). Sin
 * el rótulo de cada selector, «Todas» y «Todos» no dirían a qué se refieren.
 */

/** «últimos 2 años», «todas las fechas». */
export function periodSummary(period: RepertoireSearch['period']): string {
	return period ? `últimos ${period} años` : 'todas las fechas'
}

/** «estándar», «todos los ritmos». */
export function timeClassSummary(timeClass: TimeClass | null): string {
	return timeClass ? TIME_CLASS_LABEL[timeClass].toLowerCase() : 'todos los ritmos'
}
