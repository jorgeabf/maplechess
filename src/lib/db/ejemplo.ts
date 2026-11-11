// El ejemplo de la portada: tres resúmenes del dossier de verdad de uno de los
// primeros del ranking, con sus partidas con blancas (las que enseña su dossier
// al abrirlo). Lo calcula de noche src/ingest/ejemplo.ts y se guarda en
// sync_state: la portada sólo lee el resumen y el nombre de su ficha.
import type { ClockSummary } from '../chess/clock'
import type { EloGap, FirstMoves } from '../chess/dossier'
import type { Stats } from '../chess/repertoire'
import type { TimeClass } from '../chess/timecontrol'
import { madridYear } from '../dates'
import { mayBeMinor } from './players'

/** Clave de sync_state con el resumen guardado. */
export const EXAMPLE_KEY = 'portada.ejemplo'

/**
 * Sube cuando cambia la forma del resumen: uno guardado con otra no se enseña
 * hasta que se recalcula (de noche o con el reprocesado {"ejemplo":true}).
 */
export const EXAMPLE_VERSION = 1

/** Lo que se guarda: sus partidas con blancas, resumidas como en el dossier. */
export interface DossierExample {
	v: number
	fideId: number
	/** Su puesto en el ranking absoluto (activos, por ELO estándar). */
	rank: number
	first: FirstMoves
	byElo: Record<EloGap, Stats>
	/** Ritmo del resumen del reloj: el que más partidas con reloj tiene, como en el dossier. */
	timeClass: TimeClass | null
	clock: ClockSummary
}

export interface HomeExample extends DossierExample {
	name: string
}

/**
 * El ejemplo guardado, con el nombre de su ficha: si pide la retirada (se borra
 * su ficha), si pide no salir (portada_excluidos) o si pudiera ser menor, deja
 * de salir en el acto, sin esperar a recalcularlo. Dos filas, por su clave
 * (sync_state y players), y la de portada_excluidos si está en ella.
 */
export async function getExample(db: D1Database, year = madridYear(new Date())): Promise<HomeExample | null> {
	const row = await db
		.prepare(
			`SELECT s.value, p.name, p.birth_year AS birthYear
			FROM sync_state s
			JOIN players p ON p.fide_id = json_extract(s.value, '$.fideId')
			WHERE s.key = ?1
				AND NOT EXISTS (SELECT 1 FROM portada_excluidos e WHERE e.fide_id = p.fide_id)`
		)
		.bind(EXAMPLE_KEY)
		.first<{ value: string; name: string; birthYear: number | null }>()
	if (!row || mayBeMinor(row.birthYear, year)) return null
	const example = JSON.parse(row.value) as DossierExample
	return example.v === EXAMPLE_VERSION ? { ...example, name: row.name } : null
}
