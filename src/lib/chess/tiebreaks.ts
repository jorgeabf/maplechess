// Desempates de las clasificaciones de info64: la cabecera de cada columna es
// el código del programa de emparejamientos (Vega), distinto según el torneo y
// el año. Lo que significa cada uno, para la leyenda de la clasificación; los
// que no están aquí se enseñan sin explicar.
//
// Los de ahora son los del reglamento de desempates de la FIDE (C.07) y de su
// lista de códigos («Mandatory Tie-Breaks»): un modificador tras la barra
// (BH/C1, sin el peor rival) y, en equipos, los puntos con que se calcula tras
// los dos puntos (BH:MP, con los de encuentro). Algunos torneos los escriben con
// guion, como el texto del C.07 (BH-C1). Las versiones anteriores de Vega usaban
// otros (BucT, Buc1, S-B, Dir_MP); los que no explica su manual salen de las
// bases de torneos de info64 que los usan.
export const TIEBREAK_NAMES: Record<string, string> = {
	DE: 'encuentro directo',
	DirE: 'encuentro directo',
	DE1: 'encuentro directo',
	WIN: 'victorias, también sin jugar',
	Mwns: 'victorias, también sin jugar',
	WON: 'partidas ganadas',
	BPG: 'partidas jugadas con negras',
	MBlk: 'partidas jugadas con negras',
	BWG: 'partidas ganadas con negras',
	REP: 'rondas que decidió jugar',
	GE: 'rondas que decidió jugar',
	PS: 'progresivo',
	Cmlt: 'progresivo',
	'PS/C1': 'progresivo sin la primera ronda',
	'PS/C2': 'progresivo sin las dos primeras rondas',
	StdScr: 'puntos contando la victoria 1 y las tablas ½',
	SScr: 'puntos contando la victoria 1 y las tablas ½',
	Arranz: 'sistema Arranz: tablas, 0,6 con negras y 0,4 con blancas',
	'Arr.': 'sistema Arranz: tablas, 0,6 con negras y 0,4 con blancas',
	User: 'desempate manual, como el sorteo',
	UserTB: 'desempate manual, como el sorteo',
	'TPN/R': 'número inicial más alto',
	BH: 'Buchholz',
	BucT: 'Buchholz',
	'BH/C1': 'Buchholz sin el peor rival',
	'BH-C1': 'Buchholz sin el peor rival',
	Buc1: 'Buchholz sin el peor rival',
	'BH/C2': 'Buchholz sin los dos peores rivales',
	'BH-C2': 'Buchholz sin los dos peores rivales',
	Buc2: 'Buchholz sin los dos peores rivales',
	'BH/M1': 'Buchholz mediano',
	'BH-M1': 'Buchholz mediano',
	BucM: 'Buchholz mediano',
	'BH/M2': 'Buchholz sin los dos mejores ni los dos peores rivales',
	FB: 'Buchholz con la última ronda en tablas',
	'FB/C1': 'Buchholz con la última ronda en tablas, sin el peor rival',
	AOB: 'Buchholz medio de los rivales',
	'AOB/F': 'Buchholz medio de los rivales, con la última ronda en tablas',
	SB: 'Sonneborn-Berger',
	'S-B': 'Sonneborn-Berger',
	'SB/C1': 'Sonneborn-Berger sin el peor rival',
	'SB-C1': 'Sonneborn-Berger sin el peor rival',
	SB_C1: 'Sonneborn-Berger sin el peor rival',
	'SB/C2': 'Sonneborn-Berger sin los dos peores rivales',
	KS: 'sistema Koya: puntos contra los que sacaron al menos la mitad',
	Koya: 'sistema Koya: puntos contra los que sacaron al menos la mitad',
	ARO: 'ELO medio de los rivales',
	'ARO.': 'ELO medio de los rivales',
	'ARO/C1': 'ELO medio de los rivales sin el más bajo',
	'ARO-C1': 'ELO medio de los rivales sin el más bajo',
	ARO1: 'ELO medio de los rivales sin el más bajo',
	TPR: 'performance',
	APRO: 'performance media de los rivales',
	PTP: 'performance perfecta',
	APPO: 'performance perfecta media de los rivales',
	MP: 'puntos de encuentro',
	MatPnt: 'puntos de encuentro',
	GP: 'puntos de tablero',
	GamPnt: 'puntos de tablero',
	Dir_MP: 'encuentro directo por puntos de encuentro',
	Dir_GP: 'encuentro directo por puntos de tablero',
	Dir_Enc: 'encuentro directo',
	'BH:MP': 'Buchholz por puntos de encuentro',
	EMPBH: 'Buchholz por puntos de encuentro',
	'BH:MP/C1': 'Buchholz por puntos de encuentro, sin el peor rival',
	EMPBH_C1: 'Buchholz por puntos de encuentro, sin el peor rival',
	'BH:GP': 'Buchholz por puntos de tablero',
	EGPBH: 'Buchholz por puntos de tablero',
	'BH:GP/C1': 'Buchholz por puntos de tablero, sin el peor rival',
	EGPBH_C1: 'Buchholz por puntos de tablero, sin el peor rival',
	EMMSB: 'Sonneborn-Berger por puntos de encuentro',
	EGGSB: 'Sonneborn-Berger por puntos de tablero',
	EMGSB: 'Sonneborn-Berger por puntos de tablero, con los de encuentro de cada rival',
	EMGSB_C1: 'Sonneborn-Berger por puntos de tablero, con los de encuentro de cada rival y sin el peor',
	EGMSB: 'Sonneborn-Berger por puntos de encuentro, con los de tablero de cada rival',
	WBoard: 'tableros ponderados: cuentan más los primeros',
	Berlin: 'sistema Berlín: cuentan más los primeros tableros'
}

/** "BH (Buchholz)", o el código solo si no se conoce. */
export function tiebreakLabel(code: string): string {
	const name = TIEBREAK_NAMES[code]
	return name ? `${code} (${name})` : code
}

/** Equipos que tiene que haber para dar un desempate por la puntuación. */
const POINTS_MIN_ROWS = 4

/**
 * Posiciones de los desempates de un torneo por equipos que son su propia
 * puntuación: dan lo mismo que los puntos en todas las filas. En una tabla
 * serían una columna repetida, como MP (los puntos de encuentro) en el CE de
 * Rápidas por Equipos 2026, en sus 52 filas. Se mira en los datos y no en el
 * código, que no dice con qué puntos ordena el torneo: en la D1 remota
 * (25-oct-2026), MP en 64 torneos, MatPnt en 59, y GP o GamPnt (los de
 * tablero) en 26, de los 584 por equipos con clasificación.
 *
 * Sólo para los de equipos, y con al menos POINTS_MIN_ROWS filas: en los
 * individuales y con dos o tres equipos coinciden por casualidad (las
 * victorias son los puntos en un torneo sin tablas: Mwns en 47 torneos y WIN
 * en 41, casi todos de 3 a 6 jugadores), y se escondería un desempate de verdad.
 */
export function pointsTiebreaks(standings: {
	tiebreaks: readonly string[]
	rows: readonly { points: number; tiebreaks: readonly (number | null)[] }[]
}): number[] {
	if (standings.rows.length < POINTS_MIN_ROWS) return []
	return standings.tiebreaks.flatMap((_, i) => (standings.rows.every((r) => r.tiebreaks[i] === r.points) ? [i] : []))
}
