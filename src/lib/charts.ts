// Gráficos en SVG generados en el servidor (evaluación de una partida, ELO de
// un jugador): escalas y trazados. Sin bibliotecas y sin JavaScript en el
// navegador; las coordenadas se redondean para no inflar el HTML.

export interface Point {
	x: number
	y: number
}

/** Escala lineal del dominio [d0, d1] al rango [r0, r1]. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (value: number) => number {
	const span = d1 - d0 || 1
	return (value) => r0 + ((value - d0) / span) * (r1 - r0)
}

const round = (n: number) => Math.round(n * 100) / 100

/** Polilínea; un null corta la línea (hueco sin datos). */
export function linePath(points: (Point | null)[]): string {
	let path = ''
	let pen = false
	for (const p of points) {
		if (!p) {
			pen = false
			continue
		}
		path += `${pen ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`
		pen = true
	}
	return path
}

/** Área cerrada entre la polilínea y la horizontal `baseY`. */
export function areaPath(points: Point[], baseY: number): string {
	if (points.length === 0) return ''
	const first = points[0]
	const last = points[points.length - 1]
	return `M${round(first.x)} ${round(baseY)}${points.map((p) => `L${round(p.x)} ${round(p.y)}`).join('')}L${round(last.x)} ${round(baseY)}Z`
}

/**
 * Cuáles de `count` etiquetas seguidas de un eje son menores, las que se
 * pueden ocultar si falta sitio: con más de `max`, se queda una de cada
 * ceil(count / max), empezando por la primera, y las demás son menores.
 */
export function minorLabels(count: number, max: number): boolean[] {
	const step = Math.ceil(count / max)
	return Array.from({ length: count }, (_, i) => i % step !== 0)
}

/**
 * Marcas "redondas" para un eje entre min y max (múltiplos de 1, 2 o 5 por
 * una potencia de 10), unas `count` como mucho.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
	if (!(max > min)) return [min]
	const raw = (max - min) / count
	const power = 10 ** Math.floor(Math.log10(raw))
	const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power
	const ticks: number[] = []
	for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t)
	return ticks
}
