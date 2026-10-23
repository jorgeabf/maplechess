// Desempates de las clasificaciones de info64: la cabecera de cada columna es
// el código del programa de emparejamientos (Vega), distinto según el torneo y
// el año. Lo que significa cada uno, para la leyenda de la clasificación; los
// que no están aquí se enseñan sin explicar.
export const TIEBREAK_NAMES: Record<string, string> = {
	APRO: 'performance media de los rivales',
	ARO: 'ELO medio de los rivales',
	BH: 'Buchholz',
	'BH/C1': 'Buchholz sin el peor rival',
	'BH/M1': 'Buchholz mediano',
	BucT: 'Buchholz',
	BucM: 'Buchholz mediano',
	Cmlt: 'progresivo',
	PS: 'progresivo',
	'PS/C1': 'progresivo sin la primera ronda',
	'PS/C2': 'progresivo sin las dos primeras rondas',
	SB: 'Sonneborn-Berger',
	WIN: 'partidas ganadas',
	WON: 'partidas ganadas',
	MatPnt: 'puntos de encuentro',
	GamPnt: 'puntos de tablero',
	Dir_MP: 'encuentro directo'
}

/** "BH (Buchholz)", o el código solo si no se conoce. */
export function tiebreakLabel(code: string): string {
	const name = TIEBREAK_NAMES[code]
	return name ? `${code} (${name})` : code
}
