// Torneos de info64 que repiten las partidas de otro y no se guardan (decidido
// por Jorge el 4-nov-2026, medido en producción: 964 partidas de más, un 0,8 %).
//
// Sus partidas salen de una retransmisión de lichess que enlazan varios
// torneos de info64, y cada uno guarda las de sus participantes. Una regla no
// distingue la copia del original: los grupos del Open San Miguel o del
// Princesa de Asturias también comparten la de su torneo general, y ésos se
// quedan, porque la página de cada grupo enseña sus partidas. Van a mano, por
// su slug, como los de menores de la lista (menores.ts). Uno nuevo, con su PR
// y el reprocesado {"repetidos":true}.

/** Los slugs (`source_key`) de info64 que no se guardan. */
export const LISTED_COPIES: readonly string[] = [
	// Granada Chess Open 2026, dado de alta dos veces con los mismos jugadores,
	// clasificación y partidas: se queda granada-chess-open-2026.
	'granada-chess-open-2026-1',
	// Campeonato de Asturias Individual 2024: el cálculo del ELO FIDE por tramos
	// de rondas, cada uno con las 87 partidas del campeonato.
	'variacion-elo-fide-std-r1',
	'variacion-elo-fide-std-r2-r3-r4',
	'variacion-elo-fide-std-r5-r6-r7-r8'
]

const LISTED = new Set(LISTED_COPIES)

/** ¿Es un torneo de info64 de la lista de los que repiten las partidas de otro? */
export function isListedCopy(key: string): boolean {
	return LISTED.has(key)
}
