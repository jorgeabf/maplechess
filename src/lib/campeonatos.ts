// Campeonatos de España de adultos desde 2015, para /torneos/campeones. La
// lista va a mano y no se busca por el nombre: «absoluto» casa con cientos de
// regionales y abiertos, hay torneos dudosos con nombre de campeonato (el
// «Campeonato de España de Ajedrez Relámpago Hotel Churra» de 2023 no es el
// oficial) y los nombres son irregulares («LXXX C E INDIVIDUAL ABSOLUTO»,
// «CE CECLUB DIVISION DE HONOR»). Cada año se añaden los de la temporada.
//
// Sin las categorías de menores (Sub 16, Sub 18, sus rápidos, las selecciones
// autonómicas cadete y la Copa Sub-18): una lista hecha para destacar a sus
// campeones iría contra lo decidido para los menores (ver CLAUDE.md).
//
// Cada edición dice su torneo por la clave natural (`source`, `source_key`),
// que no cambia al releerlo; el id de D1 sí puede cambiar. El campeón no se
// escribe aquí: sale de la clasificación y de los participantes, que ya van
// saneados (sin el año de los menores, y los retirados como «Jugador
// retirado»). Si el título no es del primero de la clasificación, la edición
// lleva el número inicial (start_rank) de quien lo ganó, nunca su nombre ni su
// FIDE ID: este repositorio es público.

export const CATEGORIES = [
	{ id: 'absoluto', label: 'Absoluto', holder: 'Campeón' },
	{ id: 'femenino', label: 'Femenino', holder: 'Campeona' },
	{ id: 'rapido', label: 'Rápido', holder: 'Campeón' },
	{ id: 'relampago', label: 'Relámpago', holder: 'Campeón' },
	{ id: 'veteranos-50', label: 'Veteranos +50', holder: 'Campeón' },
	{ id: 'veteranos-65', label: 'Veteranos +65', holder: 'Campeón' },
	{ id: 'division-de-honor', label: 'División de Honor', holder: 'Equipo' }
] as const

export type Category = (typeof CATEGORIES)[number]['id']

/**
 * Lo que la categoría dice de quien la gana: su sexo o su edad. Quien ha
 * pedido ocultarlo (tabla ocultaciones: 'sexo' o 'anio') no sale en ella.
 */
export const REVEALS: Partial<Record<Category, 'sexo' | 'anio'>> = {
	femenino: 'sexo',
	'veteranos-50': 'anio',
	'veteranos-65': 'anio'
}

export interface Championship {
	category: Category
	year: number
	source: 'info64' | 'lichess' | 'fca'
	sourceKey: string
	/**
	 * Número inicial de quien ganó el título, si no es el primero de la
	 * clasificación: la mejor mujer de un absoluto mixto, el mejor español de un
	 * abierto o quien ganó un play-off. Sin él, el primero.
	 */
	startRank?: number
	/** Lo que hay que saber del título, en pocas palabras: «1.º español». */
	note?: string
}

type Edition = Omit<Championship, 'category'>

const info64 = (year: number, sourceKey: string, champion?: Pick<Edition, 'startRank' | 'note'>): Edition => ({
	year,
	source: 'info64',
	sourceKey,
	...champion
})

/**
 * Por categoría, del más reciente al más antiguo. El absoluto y el femenino
 * se juegan juntos desde 2018 (y en 2016): la campeona es la mejor mujer de
 * la clasificación. Con empate arriba, el primero por desempate; en un
 * abierto que gana un extranjero, el mejor español (decidido por Jorge el
 * 25-oct-2026). Si la fuente diera el mismo puesto a dos, la edición llevaría
 * el número inicial: la consulta tomaría el de número más bajo. Comprobado con la FEDA (hasta 2020), Wikipedia y OlimpBase.
 * Faltan los que no están en D1: el rápido de 2017 y de 2020, el relámpago de
 * 2015 a 2017 y de 2020, y los veteranos de 2020.
 */
const EDITIONS: Record<Category, Edition[]> = {
	absoluto: [
		info64(2026, 'campeonato-de-espana-individual-absoluto-y-femenino-2026'),
		info64(2025, 'ce-individual-absoluto-2025'),
		info64(2024, 'ce-absoluto-2024'),
		info64(2023, 'ce-individual-absoluto-y-femenino-2023'),
		info64(2022, 'ce-absoluto-2022-1'),
		info64(2021, 'ce-absoluto-2021'),
		info64(2020, 'ce-individual-absoluto-y-femenino'),
		info64(2019, 'ce-individual-absoluto-y-femenino-2019'),
		info64(2018, 'cto-de-espana-individual-absoluto-y-femenino'),
		info64(2017, 'lxxxii-campeonato-de-espana-individual-absoluto-17'),
		info64(2016, 'lxxxi-campeonato-de-espana-individual-absoluto'),
		info64(2015, 'lxxx-c-e-individual-absoluto')
	],
	femenino: [
		info64(2026, 'campeonato-de-espana-individual-absoluto-y-femenino-2026', { startRank: 32 }),
		info64(2025, 'ce-individual-absoluto-2025', { startRank: 25 }),
		info64(2024, 'ce-absoluto-2024', { startRank: 26 }),
		info64(2023, 'ce-individual-absoluto-y-femenino-2023', { startRank: 9 }),
		info64(2022, 'ce-absoluto-2022-1', { startRank: 47 }),
		info64(2021, 'ce-absoluto-2021', { startRank: 20 }),
		info64(2020, 'ce-individual-absoluto-y-femenino', { startRank: 28 }),
		info64(2019, 'ce-individual-absoluto-y-femenino-2019', { startRank: 26 }),
		info64(2018, 'cto-de-espana-individual-absoluto-y-femenino', { startRank: 21 }),
		info64(2017, 'ce-individual-femenino-2017'),
		info64(2016, 'lxxxi-campeonato-de-espana-individual-absoluto', { startRank: 30 }),
		info64(2015, 'campeonato-espana-femenino-2015')
	],
	rapido: [
		info64(2026, 'ce-rapido-2026'),
		info64(2025, 'ce-rapido-2025'),
		info64(2024, 'ce-rapido-2024'),
		info64(2023, 'ce-rapido-2023'),
		info64(2022, 'campeonato-de-espana-absoluto-ajedrez-rapido-2022'),
		info64(2021, 'ce-rapido-2021'),
		info64(2019, 'campeonato-de-espana-rapido-2019'),
		info64(2018, 'ce-rapido-2018'),
		info64(2016, 'campeonato-de-espana-rapido-2016'),
		info64(2015, 'cto-de-espana-de-ajedrez-rapido-2015', { startRank: 3, note: '1.º español' })
	],
	relampago: [
		info64(2026, 'ce-relampago-2026'),
		info64(2025, 'ce-relampago-2025'),
		info64(2024, 'ce-relampago-2024'),
		info64(2023, 'ce-relampago-2023'),
		info64(2022, 'campeonato-de-espana-absoluto-ajedrez-relampago-2022'),
		info64(2021, 'ce-relampago-2021'),
		info64(2019, 'ce-relampago-absoluto-2019'),
		info64(2018, 'ce-relampago-2018')
	],
	'veteranos-50': [
		info64(2026, 'xxiii-ce-individual-de-veteranos-2026-mayores-de-50'),
		info64(2025, 'ce-veteranos-m50-2025'),
		info64(2024, 'ce-veteranos-2024-m50'),
		info64(2023, 'ce-individual-veteranos-m50-2023'),
		info64(2022, 'xix-ce-veteranos-grupo-50'),
		info64(2021, 'xviii-ce-veteranos-grupo-a-50-2021'),
		info64(2019, 'xvii-ce-veteranos-grupo-a-50-2019'),
		info64(2018, 'xvi-campeonato-de-espana-de-veteranos-50'),
		info64(2017, 'campeonato-de-espana-de-veteranos-grupo-a-50'),
		info64(2016, 'xiv-cto-de-espana-de-veteranos-grupo-a-50'),
		info64(2015, 'xiii-campeonato-de-espana-de-veteranos-grupo-a')
	],
	'veteranos-65': [
		info64(2026, 'cto-espana-individual-veteranos-s65-2026'),
		info64(2025, 'ce-veteranos-65-2025'),
		info64(2024, 'ce-veteranos-2024-m65'),
		info64(2023, 'ce-individual-veteranos-m65-2023'),
		info64(2022, 'xix-ce-veteranos-grupo-65'),
		info64(2021, 'xviii-ce-veteranos-grupo-b-65-2021'),
		info64(2019, 'xvii-ce-veteranos-grupo-b-65-2019'),
		info64(2018, 'xvi-cto-espana-de-veteranos-grupo-b-65'),
		info64(2017, 'xv-campeonato-de-espana-de-veteranos-grupo-b-65'),
		info64(2016, 'xiv-cto-de-espana-de-veteranos-grupo-b-65'),
		info64(2015, 'xiii-campeonato-de-espana-de-veteranos-grupo-b')
	],
	'division-de-honor': [
		info64(2025, 'team/ceclub-division-de-honor-2025'),
		info64(2024, 'team/ceclub-division-honor-1'),
		info64(2023, 'team/ce-ceclub-division-de-honor-2023'),
		info64(2022, 'team/campeonato-de-espana-equipos-division-honor-2022-295537'),
		info64(2021, 'team/ce-por-equipos-division-de-honor-2021'),
		info64(2020, 'team/ceclub-division-de-honor-2020'),
		info64(2019, 'team/ceclub-division-honor'),
		info64(2018, 'team/ceclub-division-de-honor-191779'),
		info64(2017, 'team/ceclub-division-honor-2017'),
		info64(2016, 'team/ce-division-de-honor-2016'),
		info64(2015, 'team/campeonato-espana-division-honor')
	]
}

/** Todas las ediciones, por categoría (en el orden de CATEGORIES) y de la más reciente a la más antigua. */
export const CHAMPIONSHIPS: Championship[] = CATEGORIES.flatMap(({ id }) =>
	EDITIONS[id].map((edition) => ({ category: id, ...edition }))
)

/**
 * Los títulos que da un torneo: ninguno, uno o, en un absoluto mixto, el
 * absoluto y el femenino. Para enlazar /torneos/campeones desde su página.
 */
export function championshipsOf(source: string, sourceKey: string): Championship[] {
	return CHAMPIONSHIPS.filter((c) => c.source === source && c.sourceKey === sourceKey)
}
