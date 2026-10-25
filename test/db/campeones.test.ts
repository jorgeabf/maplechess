import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import { RETIRED_NAME } from '../../src/ingest/nombres'
import { replaceParticipations, replaceStandings, upsertTournament } from '../../src/ingest/repo'
import type { Championship } from '../../src/lib/campeonatos'
import { getChampions } from '../../src/lib/db/campeones'

const db = env.DB
const TODAY = '2026-10-25'

const tournament = (key: string, type: 'individual' | 'team') =>
	upsertTournament(db, {
		source: 'info64',
		key,
		type,
		name: `Campeonato Inventado ${key}`,
		city: null,
		startDate: '2026-08-01',
		endDate: '2026-08-09',
		timeControl: null,
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z'
	})

const player = (startRank: number, name: string, fideId: number | null): TournamentPlayer => ({
	startRank,
	team: null,
	title: startRank === 1 ? 'GM' : null,
	name,
	fed: 'ESP',
	rating: 2600 - startRank,
	fideId
})

/** Clasificación de un torneo individual: [puesto, número inicial, puntos], por defecto la final. */
const standings = (id: number, rows: [pos: number, startRank: number, points: number][], round = 9) =>
	replaceStandings(db, id, 'individual', {
		round,
		rounds: 9,
		tiebreaks: ['BH'],
		rows: rows.map(([pos, startRank, points]) => ({ pos, startRank, name: `Fuente ${startRank}`, points, tiebreaks: [points * 6], rating: null }))
	})

const edition = (sourceKey: string, more: Partial<Championship> = {}): Championship => ({
	category: 'absoluto',
	year: 2026,
	source: 'info64',
	sourceKey,
	...more
})

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM standings'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM players'),
		db.prepare('DELETE FROM retiradas'),
		db.prepare('DELETE FROM ocultaciones')
	])
})

describe('getChampions', () => {
	it('da el primero de la clasificación, con sus datos de participante', async () => {
		const id = await tournament('ce-inventado-2026', 'individual')
		await replaceParticipations(db, id, [player(1, 'Primero Inventado, Uno', 9500001), player(2, 'Segundo Inventado, Dos', 9500002)])
		await standings(id, [
			[1, 2, 7.5],
			[2, 1, 7]
		])

		expect(await getChampions(db, [edition('ce-inventado-2026')], TODAY)).toEqual([
			{
				...edition('ce-inventado-2026'),
				tournamentId: id,
				tournamentName: 'Campeonato Inventado ce-inventado-2026',
				gamesCount: 0,
				name: 'Segundo Inventado, Dos',
				title: null,
				fideId: 9500002,
				points: 7.5
			}
		])
	})

	it('con número inicial, el de esa fila: la mejor mujer o el mejor español', async () => {
		const id = await tournament('abierto-inventado', 'individual')
		await replaceParticipations(db, id, [player(1, 'Extranjero Inventado, Uno', 9500001), player(2, 'Español Inventado, Dos', 9500002)])
		await standings(id, [
			[1, 1, 8.5],
			[2, 2, 7.5]
		])

		const [champion] = await getChampions(db, [edition('abierto-inventado', { startRank: 2, note: '1.º español' })], TODAY)
		expect(champion).toMatchObject({ name: 'Español Inventado, Dos', points: 7.5, startRank: 2, note: '1.º español' })
	})

	it('en un torneo por equipos, el equipo de la clasificación', async () => {
		const id = await tournament('team/division-inventada', 'team')
		await replaceStandings(db, id, 'team', {
			round: null,
			rounds: 7,
			tiebreaks: ['GamPnt'],
			rows: [
				{ pos: 1, startRank: 3, name: 'Club Inventado', points: 12, tiebreaks: [28], rating: 2600 },
				{ pos: 2, startRank: 1, name: 'Otro Club Inventado', points: 11, tiebreaks: [29], rating: 2650 }
			]
		})

		const [champion] = await getChampions(db, [edition('team/division-inventada', { category: 'division-de-honor' })], TODAY)
		expect(champion).toMatchObject({ name: 'Club Inventado', points: 12, fideId: null, title: null })
	})

	it('con el nombre de la lista FIDE si está en ella, aunque el torneo lo escriba de otra forma', async () => {
		const id = await tournament('ce-nombre', 'individual')
		await replaceParticipations(db, id, [player(1, 'Lista Inventado, Jose Antonio', 9500001), player(2, 'Extranjero Inventado, Otro', 9500002)])
		await db
			.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (9500001, 'Lista Inventado, Josep Anton', 1970, '')")
			.run()
		await standings(id, [
			[1, 1, 7],
			[2, 2, 6]
		])

		const champions = await getChampions(db, [edition('ce-nombre'), edition('ce-nombre', { year: 2025, startRank: 2 })], TODAY)
		expect(champions.map((c) => c.name)).toEqual(['Lista Inventado, Josep Anton', 'Extranjero Inventado, Otro'])
	})

	it('el retirado, como «Jugador retirado» y sin FIDE ID', async () => {
		await db
			.prepare("INSERT INTO retiradas (fide_id, nombre, creada) VALUES (9500001, 'Retirado Inventado, Uno', '2026-10-22')")
			.run()
		const id = await tournament('ce-retirado', 'individual')
		await replaceParticipations(db, id, [player(1, 'Retirado Inventado, Uno', 9500001)])
		await standings(id, [[1, 1, 7]])

		const [champion] = await getChampions(db, [edition('ce-retirado')], TODAY)
		expect(champion).toMatchObject({ name: RETIRED_NAME, fideId: null, title: null })
	})

	it('de quien puede ser menor, por su año en la lista FIDE, la edición sin nombre ni ficha', async () => {
		const id = await tournament('ce-joven', 'individual')
		await replaceParticipations(db, id, [player(1, 'Joven Inventada, Una', 9500001), player(2, 'Adulta Inventada, Otra', 9500002)])
		await db.batch([
			db.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (9500001, 'Joven Inventada, Una', 2008, '')"),
			db.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (9500002, 'Adulta Inventada, Otra', 2007, '')")
		])
		await standings(id, [
			[1, 1, 7],
			[2, 2, 6]
		])

		const champions = await getChampions(db, [edition('ce-joven'), edition('ce-joven', { year: 2025, startRank: 2 })], TODAY)
		expect(champions.map(({ name, title, fideId, points }) => ({ name, title, fideId, points }))).toEqual([
			{ name: null, title: null, fideId: null, points: 7 },
			{ name: 'Adulta Inventada, Otra', title: null, fideId: 9500002, points: 6 }
		])
	})

	it('sin la campeona que ha pedido ocultar su sexo, que sí sale en el absoluto', async () => {
		const id = await tournament('ce-mixto', 'individual')
		await replaceParticipations(db, id, [player(1, 'Oculta Inventada, Una', 9500001)])
		await db
			.prepare("INSERT INTO ocultaciones (peticion, fide_id, campo, creada) VALUES ('P-2026-001', 9500001, 'sexo', '2026-10-24')")
			.run()
		await standings(id, [[1, 1, 7]])

		const champions = await getChampions(db, [edition('ce-mixto'), edition('ce-mixto', { category: 'femenino' })], TODAY)
		expect(champions.map((c) => c.category)).toEqual(['absoluto'])
	})

	it('sin el campeón de veteranos que ha pedido ocultar su año, que sí sale en el absoluto', async () => {
		const id = await tournament('ce-veterano', 'individual')
		await replaceParticipations(db, id, [player(1, 'Veterano Inventado, Uno', 9500001)])
		await db
			.prepare("INSERT INTO players (fide_id, name, birth_year, birth_year_hidden, seen_at) VALUES (9500001, 'Veterano Inventado, Uno', 1955, 1, '')")
			.run()
		await standings(id, [[1, 1, 7]])

		const champions = await getChampions(db, [edition('ce-veterano'), edition('ce-veterano', { category: 'veteranos-65' })], TODAY)
		expect(champions.map((c) => c.category)).toEqual(['absoluto'])
	})

	it('sin las ediciones cuyo torneo o clasificación no está guardado', async () => {
		await tournament('ce-sin-clasificacion', 'individual')
		expect(await getChampions(db, [edition('ce-que-no-esta'), edition('ce-sin-clasificacion')], TODAY)).toEqual([])
		expect(await getChampions(db, [], TODAY)).toEqual([])
	})

	it('sin las que aún no tienen la clasificación final', async () => {
		const id = await tournament('ce-en-juego', 'individual')
		await replaceParticipations(db, id, [player(1, 'Líder Inventado, Uno', 9500001)])
		await standings(id, [[1, 1, 3]], 3)
		expect(await getChampions(db, [edition('ce-en-juego')], TODAY)).toEqual([])
		// Por equipos, la fuente no dice tras qué ronda va: final si el torneo ha terminado.
		const team = await tournament('team/division-en-juego', 'team')
		await replaceStandings(db, team, 'team', {
			round: null,
			rounds: 7,
			tiebreaks: [],
			rows: [{ pos: 1, startRank: 1, name: 'Club Inventado', points: 4, tiebreaks: [], rating: null }]
		})
		const division = edition('team/division-en-juego', { category: 'division-de-honor' })
		expect(await getChampions(db, [division], '2026-08-05')).toEqual([])
		expect(await getChampions(db, [division], TODAY)).toHaveLength(1)
	})

	it('lee unas pocas filas por edición, aunque la clasificación sea larga', async () => {
		const id = await tournament('ce-largo', 'individual')
		await replaceParticipations(
			db,
			id,
			Array.from({ length: 200 }, (_, i) => player(i + 1, `Jugador Inventado, Número ${i + 1}`, 9500001 + i))
		)
		await standings(
			id,
			Array.from({ length: 200 }, (_, i) => [i + 1, i + 1, 9 - i / 40] as [number, number, number])
		)
		const rowsRead: number[] = []
		const counting = {
			prepare: (sql: string) => db.prepare(sql),
			batch: async <T>(statements: D1PreparedStatement[]) => {
				const results = await db.batch<T>(statements)
				rowsRead.push(...results.map((r) => r.meta.rows_read))
				return results
			}
		} as unknown as D1Database

		await getChampions(counting, [edition('ce-largo'), edition('ce-largo', { year: 2025, startRank: 12 })], TODAY)
		// El torneo, su fila de la clasificación (o las 12 primeras), el jugador
		// y su fila de players: nunca la clasificación entera.
		expect(rowsRead[0]).toBeLessThanOrEqual(4)
		expect(rowsRead[1]).toBeLessThanOrEqual(16)
	})
})
