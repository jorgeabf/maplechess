import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { federationColumn, FEDERATIONS } from '../../src/ingest/federaciones'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import { clearNonFederations, replaceParticipations, upsertTournament } from '../../src/ingest/repo'

// La columna Fed. de los participantes: sólo códigos de federación de la FIDE.
// Torneos y jugadores inventados.
const db = env.DB

/** FIDE ID de un jugador inventado de la lista española, y de un extranjero. */
const SPANISH = 930601
const FOREIGN = 930602

const tournament = (key: string) =>
	upsertTournament(db, {
		source: 'info64',
		key,
		type: 'individual',
		name: `Open ${key}`,
		city: 'Ninguna',
		startDate: '2026-09-01',
		endDate: '2026-09-02',
		timeControl: '90+30',
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z'
	})

const player = (startRank: number, fed: string | null, fideId: number | null = null): TournamentPlayer => ({
	startRank,
	team: null,
	title: null,
	name: `Inventado, Jugador ${startRank}`,
	fed,
	rating: 1500 + startRank,
	fideId
})

const column = (...rows: [string | null, number | null][]) =>
	federationColumn(
		rows.map(([fed, fideId]) => ({ fed, fideId })),
		new Set([SPANISH])
	)

const feds = async (tournamentId: number) =>
	(
		await db
			.prepare('SELECT fed FROM participations WHERE tournament_id = ?1 ORDER BY start_rank')
			.bind(tournamentId)
			.all<{ fed: string | null }>()
	).results.map((r) => r.fed)

describe('federationColumn', () => {
	it('tiene las 207 federaciones de la FIDE y la bandera de la FIDE', () => {
		expect(FEDERATIONS.size).toBe(208)
		for (const code of ['ESP', 'FRA', 'ENG', 'KOS', 'FID']) expect(FEDERATIONS.has(code), code).toBe(true)
	})

	it('deja las federaciones, también «AND» y «CAN» de un extranjero', () => {
		expect(column(['ESP', SPANISH], ['AND', FOREIGN], ['CAN', null], [null, null])).toEqual(['ESP', 'AND', 'CAN', null])
		expect(column()).toEqual([])
	})

	it('vacía las edades, los años, las provincias y las erratas', () => {
		expect(column(['ESP', null], ['S12', null], ['sub12', null], ['2017', null], ['FRA', null])).toEqual([
			'ESP',
			null,
			null,
			null,
			'FRA'
		])
		expect(column(['MA', null], ['JA', null], ['ESP', null])).toEqual([null, null, 'ESP'])
	})

	it('en quien está en la lista española, «MAD», «AND» y «CAN» son su comunidad', () => {
		expect(column(['MAD', SPANISH], ['ESP', null])).toEqual([null, 'ESP'])
	})

	it('sin FIDE ID, lo son si la columna trae otras comunidades, no por una errata con un extranjero', () => {
		expect(column(['AND', null], ['CAT', null], ['IND', FOREIGN])).toEqual([null, null, 'IND'])
		expect(column(['ESp', null], ['CAN', FOREIGN])).toEqual([null, 'CAN'])
	})
})

describe('la columna Fed. al guardar y en lo guardado', () => {
	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM participations'),
			db.prepare('DELETE FROM tournaments'),
			db.prepare('DELETE FROM players'),
			db.prepare("INSERT INTO players (fide_id, name, seen_at) VALUES (?1, 'Inventado, Español', '2026-10-01')").bind(SPANISH)
		])
	})

	it('replaceParticipations sólo guarda los códigos de federación', async () => {
		const ages = await tournament('edades')
		const ok = await tournament('federaciones')
		await replaceParticipations(db, ages, [player(1, 'ESP'), player(2, 'S12'), player(3, null)])
		await replaceParticipations(db, ok, [player(1, 'MAD', SPANISH), player(2, 'CAN', FOREIGN), player(3, 'AND')])
		expect(await feds(ages)).toEqual(['ESP', null, null])
		expect(await feds(ok)).toEqual([null, 'CAN', 'AND'])
	})

	it('clearNonFederations limpia lo ya guardado como al escribir, y repetirlo no cambia nada', async () => {
		const regions = await tournament('comunidades')
		const ok = await tournament('federaciones')
		// Guardados antes de la regla: sin pasar por replaceParticipations.
		await db.batch(
			[
				[regions, 1, 'MAD', SPANISH],
				[regions, 2, 'AND', null],
				[regions, 3, 'CAT', null],
				[regions, 4, 'CAN', FOREIGN],
				[regions, 5, null, null],
				[ok, 1, 'AND', null],
				[ok, 2, 'MAD', SPANISH]
			].map(([id, rank, fed, fideId]) =>
				db
					.prepare(
						"INSERT INTO participations (tournament_id, start_rank, name, name_norm, fed, fide_id) VALUES (?1, ?2, 'Inventado, Uno', 'inventado, uno', ?3, ?4)"
					)
					.bind(id, rank, fed, fideId)
			)
		)
		expect(await clearNonFederations(db)).toBe(4)
		expect(await feds(regions)).toEqual([null, null, null, 'CAN', null])
		expect(await feds(ok)).toEqual(['AND', null])
		expect(await clearNonFederations(db)).toBe(0)
	})
})
