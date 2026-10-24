import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FidePlayer } from '../../src/ingest/fide/parse'
import { applyHiddenFields, upsertFidePlayers } from '../../src/ingest/repo'
import { findPlayersByName, getPlayer, getRanking, searchPlayers, type RankingCategory } from '../../src/lib/db/players'
import { sitemapIds } from '../../src/lib/db/sitemap'
import { playerFilters } from '../../src/lib/params'

// Ocultar a petición el sexo y el año de nacimiento (tabla ocultaciones).
// Nombres e ID inventados.
const db = env.DB

const player = (fideId: number, name: string, sex: string, birthYear: number, ratingStd: number): FidePlayer => ({
	fideId,
	name,
	fed: 'ESP',
	sex,
	title: null,
	birthYear,
	ratingStd,
	ratingRapid: null,
	ratingBlitz: null,
	inactive: false
})

// En 2026: +50 hasta 1976, +65 hasta 1961, sub-18 desde 2008.
const SHE = player(9400001, 'Supuesto Irreal, Otra', 'F', 1970, 2300) // oculta el sexo y el año
const OTHER_WOMAN = player(9400002, 'Inventada Ficticia, Una', 'F', 1990, 2200)
const YOUNG = player(9400003, 'Supuesto Irreal, Joven', 'M', 2009, 2100) // oculta el año; puede ser menor
const VETERAN = player(9400004, 'Inventado Ficticio, Otro', 'M', 1960, 2000)
const OLDER = player(9400005, 'Supuesto Irreal, Mayor', 'M', 1955, 2050) // oculta el año
const LIST = [SHE, OTHER_WOMAN, YOUNG, VETERAN, OLDER]

const hide = (fideId: number, campo: string) =>
	db
		.prepare("INSERT INTO ocultaciones (peticion, fide_id, campo, creada) VALUES ('P-2026-001', ?1, ?2, '2026-10-24')")
		.bind(fideId, campo)
		.run()

const HIDDEN: [number, string][] = [
	[SHE.fideId, 'sexo'],
	[SHE.fideId, 'anio'],
	[YOUNG.fideId, 'anio'],
	[OLDER.fideId, 'anio']
]

/** Importa la lista de septiembre (50 puntos menos) y la de octubre: así todos suben. */
const importLists = async () => {
	const before = LIST.map((p) => ({ ...p, ratingStd: (p.ratingStd ?? 0) - 50 }))
	await upsertFidePlayers(db, before, '2026-09', '2026-09-03T06:00:00.000Z')
	await upsertFidePlayers(db, LIST, '2026-10', '2026-10-03T06:00:00.000Z')
}

const stored = async () =>
	(
		await db
			.prepare('SELECT fide_id AS fideId, sex, birth_year AS birthYear, birth_year_hidden AS hidden FROM players ORDER BY fide_id')
			.all<{ fideId: number; sex: string | null; birthYear: number | null; hidden: number }>()
	).results

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM players'),
		db.prepare('DELETE FROM ocultaciones')
	])
})

describe('la tabla ocultaciones', () => {
	it('sólo admite el sexo y el año, una vez por jugador', async () => {
		await hide(SHE.fideId, 'sexo')
		await expect(hide(SHE.fideId, 'sexo')).rejects.toThrow(/UNIQUE/)
		await expect(hide(SHE.fideId, 'nombre')).rejects.toThrow(/CHECK/)
	})
})

describe('la importación FIDE', () => {
	it('guarda el sexo NULL y el año marcado de quien lo ha pedido; el de los demás, tal cual', async () => {
		for (const [fideId, campo] of HIDDEN) await hide(fideId, campo)
		await importLists()
		expect(await stored()).toEqual([
			{ fideId: SHE.fideId, sex: null, birthYear: 1970, hidden: 1 },
			{ fideId: OTHER_WOMAN.fideId, sex: 'F', birthYear: 1990, hidden: 0 },
			{ fideId: YOUNG.fideId, sex: 'M', birthYear: 2009, hidden: 1 },
			{ fideId: VETERAN.fideId, sex: 'M', birthYear: 1960, hidden: 0 },
			{ fideId: OLDER.fideId, sex: 'M', birthYear: 1955, hidden: 1 }
		])
	})

	it('si se borra la fila, la importación siguiente los vuelve a enseñar', async () => {
		for (const [fideId, campo] of HIDDEN) await hide(fideId, campo)
		await importLists()
		await db.prepare('DELETE FROM ocultaciones WHERE fide_id = ?1').bind(SHE.fideId).run()
		await upsertFidePlayers(db, LIST, '2026-11', '2026-11-03T06:00:00.000Z')
		expect((await stored())[0]).toEqual({ fideId: SHE.fideId, sex: 'F', birthYear: 1970, hidden: 0 })
	})
})

describe('lo que se ve', () => {
	beforeEach(async () => {
		for (const [fideId, campo] of HIDDEN) await hide(fideId, campo)
		await importLists()
	})

	const ranking = async (category: RankingCategory) => {
		const { top, risers } = await getRanking(db, category, 2026)
		return { top: top.map((p) => p.name), risers: risers.map((p) => p.name) }
	}

	it('no entran en el ranking femenino ni en los de edad, tampoco en los que más suben', async () => {
		const women = [OTHER_WOMAN.name]
		expect(await ranking('femenino')).toEqual({ top: women, risers: women })
		expect(await ranking('sub18')).toEqual({ top: [], risers: [] })
		const veterans = [VETERAN.name]
		expect(await ranking('mas50')).toEqual({ top: veterans, risers: veterans })
		expect(await ranking('mas65')).toEqual({ top: veterans, risers: veterans })
	})

	it('en el absoluto siguen, sin el año', async () => {
		const { top, risers } = await getRanking(db, '', 2026)
		const born = (rows: { name: string; birthYear: number | null }[]) => rows.map((p) => [p.name, p.birthYear])
		expect(born(top)).toEqual([
			[SHE.name, null],
			[OTHER_WOMAN.name, 1990],
			[YOUNG.name, null],
			[OLDER.name, null],
			[VETERAN.name, 1960]
		])
		// Todos suben 50: por nombre.
		expect(born(risers)).toEqual([
			[OTHER_WOMAN.name, 1990],
			[VETERAN.name, 1960],
			[YOUNG.name, null],
			[OLDER.name, null],
			[SHE.name, null]
		])
	})

	it('el filtro por sexo no encuentra con ninguno a quien ha ocultado el suyo', async () => {
		const names = async (query: string) =>
			(await searchPlayers(db, playerFilters(new URLSearchParams(query)), 2026)).rows.map((p) => p.name)
		expect(await names('sexo=F')).toEqual([OTHER_WOMAN.name])
		expect(await names('sexo=M')).toEqual([YOUNG.name, OLDER.name, VETERAN.name])
		expect(await names('q=irreal')).toEqual([SHE.name, YOUNG.name, OLDER.name])
	})

	it('ni la ficha, ni la búsqueda ni «¿Cuál eres tú?» dan el año oculto', async () => {
		const search = await searchPlayers(db, playerFilters(new URLSearchParams('q=irreal')), 2026)
		expect(search.rows.map((p) => p.birthYear)).toEqual([null, null, null])
		const choices = await findPlayersByName(db, 'irreal', VETERAN.fideId, undefined, 2026)
		expect(choices.rows.map((p) => p.birthYear)).toEqual([null, null, null])
		expect((await getPlayer(db, OLDER.fideId, 2026))?.birthYear).toBeNull()
		expect((await getPlayer(db, VETERAN.fideId, 2026))?.birthYear).toBe(1960)
		// Sin la marca: no sale de players.ts.
		expect(await getPlayer(db, OLDER.fideId, 2026)).not.toHaveProperty('birthYearHidden')
	})

	it('la ficha y el sitemap siguen sabiendo quién puede ser menor, con el año guardado', async () => {
		expect((await getPlayer(db, YOUNG.fideId, 2026))?.minor).toBe(true)
		expect((await getPlayer(db, OLDER.fideId, 2026))?.minor).toBe(false)
		await db.batch([
			db.prepare("INSERT INTO tournaments (id, source, source_key, name, type, url) VALUES (1, 'info64', 'abierto', 'Abierto', 'individual', '')"),
			...[YOUNG, OLDER].map((p, i) =>
				db
					.prepare('INSERT INTO participations (tournament_id, start_rank, name, name_norm, fide_id) VALUES (1, ?1, ?2, ?2, ?3)')
					.bind(i + 1, p.name, p.fideId)
			)
		])
		expect(await sitemapIds(db, 'jugadores', 1, 50, 2026)).toEqual([OLDER.fideId])
	})
})

describe('el reprocesado ({"ocultaciones":true})', () => {
	it('aplica la tabla a los jugadores guardados, y repetirlo no cambia nada', async () => {
		await importLists()
		for (const [fideId, campo] of HIDDEN) await hide(fideId, campo)
		expect(await applyHiddenFields(db)).toEqual({ sex: 1, birthYear: 3 })
		expect(await applyHiddenFields(db)).toEqual({ sex: 0, birthYear: 0 })
		expect(await stored()).toEqual([
			{ fideId: SHE.fideId, sex: null, birthYear: 1970, hidden: 1 },
			{ fideId: OTHER_WOMAN.fideId, sex: 'F', birthYear: 1990, hidden: 0 },
			{ fideId: YOUNG.fideId, sex: 'M', birthYear: 2009, hidden: 1 },
			{ fideId: VETERAN.fideId, sex: 'M', birthYear: 1960, hidden: 0 },
			{ fideId: OLDER.fideId, sex: 'M', birthYear: 1955, hidden: 1 }
		])
	})
})
