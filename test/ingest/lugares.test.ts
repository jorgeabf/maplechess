import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { upsertTournament, type TournamentInput } from '../../src/ingest/repo'
import { applyPlaces } from '../../src/ingest/reprocess'

// Dónde se juega cada torneo (tournaments.provincia y comunidad). Torneos inventados.
const db = env.DB

const tournament = (key: string, name: string, city: string | null): TournamentInput => ({
	source: 'info64',
	key,
	type: 'individual',
	name,
	city,
	startDate: '2026-10-17',
	endDate: '2026-10-18',
	timeControl: null,
	url: `https://info64.org/${key}`,
	syncedAt: '2026-10-18T00:00:00.000Z'
})

const place = (id: number) =>
	db
		.prepare('SELECT provincia AS province, comunidad AS community FROM tournaments WHERE id = ?1')
		.bind(id)
		.first<{ province: string | null; community: string | null }>()

beforeEach(async () => {
	await db.prepare('DELETE FROM tournaments').run()
})

describe('upsertTournament', () => {
	it('guarda dónde se juega el torneo', async () => {
		const id = await upsertTournament(db, tournament('open-de-prueba', 'Memorial Gallego 2026', 'Gijon'))
		expect(await place(id)).toEqual({ province: '33', community: '03' })
		const other = await upsertTournament(db, tournament('otro', 'Campeonato Gallego de Prueba', null))
		expect(await place(other)).toEqual({ province: null, community: '12' })
	})

	it('una lectura sin la ciudad conserva el sitio que salió de ella', async () => {
		const id = await upsertTournament(db, tournament('open-de-prueba', 'Open de Prueba', 'Ferrol'))
		await upsertTournament(db, tournament('open-de-prueba', 'Open de Prueba de Asturias', null))
		expect(await place(id)).toEqual({ province: '15', community: '12' })
		// Con otra ciudad, el sitio cambia.
		await upsertTournament(db, tournament('open-de-prueba', 'Open de Prueba', 'Lugo'))
		expect(await place(id)).toEqual({ province: '27', community: '12' })
	})
})

describe('applyPlaces', () => {
	it('vuelve a decidir el sitio de los guardados y sólo reescribe los que cambian', async () => {
		const ids = [
			await upsertTournament(db, tournament('a', 'Open de Prueba', 'Collado Villalba (Madrid)')),
			await upsertTournament(db, tournament('b', 'Campeonato de Extremadura de Prueba', 'Club Inventado')),
			await upsertTournament(db, tournament('c', 'Open de Prueba', 'Budva, Montenegro'))
		]
		// Como recién migrada la base, sin sitio.
		await db.prepare('UPDATE tournaments SET provincia = NULL, comunidad = NULL').run()

		expect(await applyPlaces(db)).toEqual({ province: 1, community: 1, nowhere: 1, updated: 2 })
		expect(await Promise.all(ids.map(place))).toEqual([
			{ province: '28', community: '13' },
			{ province: null, community: '11' },
			{ province: null, community: null }
		])
		expect((await applyPlaces(db)).updated).toBe(0)
	})
})
