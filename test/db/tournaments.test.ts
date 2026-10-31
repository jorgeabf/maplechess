import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import { refreshTotals, replaceParticipations, upsertTournament } from '../../src/ingest/repo'
import {
	countTournamentsByName,
	getTournament,
	getTournamentGroup,
	getTournamentParticipants,
	groupLabels,
	isIndexableTournament,
	searchTournaments,
	tournamentSummary,
	type TournamentFilters
} from '../../src/lib/db/tournaments'

const db = env.DB

const player = (startRank: number, name: string, fideId: number | null): TournamentPlayer => ({
	startRank,
	team: null,
	title: null,
	name,
	fed: 'ESP',
	rating: null,
	fideId
})

const tournament = (
	key: string,
	startDate = '2026-10-17',
	endDate = '2026-10-18',
	type: 'individual' | 'team' = 'individual',
	city: string | null = null
) =>
	upsertTournament(db, {
		source: 'info64',
		key,
		type,
		name: key,
		city,
		startDate,
		endDate,
		timeControl: null,
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-18T00:00:00.000Z'
	})

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM players'),
		db.prepare('DELETE FROM site_totals')
	])
})

describe('participantes', () => {

	it('marca quién tiene dossier: partidas con cualquier color y de cualquier torneo, y no poder ser menor', async () => {
		const id = await tournament('open-de-prueba')
		const other = await tournament('otro-torneo')
		await replaceParticipations(db, id, [
			player(1, 'Blancas, Ana', 9000001),
			player(2, 'Negras, Berta', 9000002),
			player(3, 'Sin Partidas, Carla', 9000003),
			player(4, 'Sin Fide, Diana', null),
			player(5, 'Menor Inventada, Eva', 9000005)
		])
		// En la lista FIDE, la 1 nació en 2007 (adulta en 2026), la 5 en 2008
		// (puede ser menor) y la 2 no tiene año: como una adulta.
		const born: [number, number | null][] = [
			[9000001, 2007],
			[9000002, null],
			[9000005, 2008]
		]
		// Dos partidas en otro torneo: la 1 (blancas) contra la 2 (negras) y la 5 contra la 1.
		const games: [number, number][] = [
			[9000001, 9000002],
			[9000005, 9000001]
		]
		await db.batch([
			...born.map(([fideId, year]) =>
				db.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (?1, 'Inventado, Alguien', ?2, '')").bind(fideId, year)
			),
			...games.map(([white, black], i) =>
				db
					.prepare(
						`INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_fide_id, black_fide_id,
							result, ply_count, pgn, seen_at)
						VALUES (?1, 1, ?2, '2026-09-25', 'Blancas', 'Negras', ?3, ?4, '1-0', 40, '', '2026-09-25')`
					)
					.bind(other, i + 1, white, black)
			)
		])

		const participants = await getTournamentParticipants(db, id, 2026)
		expect(participants.map((p) => [p.name, p.hasDossier])).toEqual([
			['Blancas, Ana', 1],
			['Negras, Berta', 1],
			['Sin Partidas, Carla', 0],
			['Sin Fide, Diana', 0],
			['Menor Inventada, Eva', 0]
		])
		// En 2027, la nacida en 2008 ya no puede ser menor.
		expect((await getTournamentParticipants(db, id, 2027)).at(-1)?.hasDossier).toBe(1)
	})
})

describe('searchTournaments', () => {
	const TODAY = '2026-10-20'
	const search = async (filters: Partial<TournamentFilters>) => {
		const result = await searchTournaments(
			db,
			{ q: '', upcoming: false, withGames: false, from: '', to: '', type: null, page: 1, ...filters },
			TODAY
		)
		return { names: result.rows.map((t) => t.name), total: result.total, upcoming: result.upcoming }
	}

	beforeEach(async () => {
		const past = await tournament('Open Pasado', '2026-09-01', '2026-09-03')
		await tournament('Liga Hoy', TODAY, '2026-11-30', 'team')
		await tournament('Open Lejano', '2027-03-01', '2027-03-02')
		await tournament('Open Futuro', '2026-11-01', '2026-11-03')
		await db.prepare('UPDATE tournaments SET games_count = 5 WHERE id = ?1').bind(past).run()
		await refreshTotals(db)
	})

	it('por defecto, los que empiezan hoy o antes, del más reciente al más antiguo', async () => {
		// Sin filtros, el total son los totales guardados menos los próximos.
		expect(await search({})).toEqual({ names: ['Liga Hoy', 'Open Pasado'], total: 2, upcoming: 2 })
	})

	it('los próximos, del más cercano al más lejano', async () => {
		expect(await search({ upcoming: true })).toEqual({ names: ['Open Futuro', 'Open Lejano'], total: 2, upcoming: 2 })
	})

	it('los filtros cuentan en las dos pestañas', async () => {
		expect(await search({ q: 'open' })).toEqual({ names: ['Open Pasado'], total: 1, upcoming: 2 })
		expect(await search({ q: 'lejano', upcoming: true })).toEqual({ names: ['Open Lejano'], total: 1, upcoming: 1 })
		expect(await search({ to: '2026-11-15' })).toEqual({ names: ['Liga Hoy', 'Open Pasado'], total: 2, upcoming: 1 })
	})

	it('«Sólo con partidas» no cambia la cuenta de los próximos', async () => {
		expect(await search({ withGames: true })).toEqual({ names: ['Open Pasado'], total: 1, upcoming: 2 })
	})

	it('con una búsqueda, cada torneo de la página con sus jugadores y en orden', async () => {
		const [pasado] = (await db.prepare("SELECT id FROM tournaments WHERE name = 'Open Pasado'").all<{ id: number }>()).results
		const otro = await tournament('Open Antiguo', '2026-06-01', '2026-06-02')
		await replaceParticipations(db, pasado.id, [player(1, 'Uno Inventado, A', null), player(2, 'Dos Inventado, B', null)])
		await replaceParticipations(db, otro, [player(1, 'Tres Inventado, C', null)])
		const result = await searchTournaments(
			db,
			{ q: 'open', upcoming: false, withGames: false, from: '', to: '', type: null, page: 1 },
			TODAY
		)
		expect(result.rows.map((t) => [t.name, t.players])).toEqual([
			['Open Pasado', 2],
			['Open Antiguo', 1]
		])
	})

	it('la modalidad filtra las dos pestañas', async () => {
		expect(await search({ type: 'team' })).toEqual({ names: ['Liga Hoy'], total: 1, upcoming: 0 })
		expect(await search({ type: 'individual' })).toEqual({ names: ['Open Pasado'], total: 1, upcoming: 2 })
		expect(await search({ type: 'individual', upcoming: true })).toEqual({
			names: ['Open Futuro', 'Open Lejano'],
			total: 2,
			upcoming: 2
		})
		expect(await search({ type: 'team', upcoming: true })).toEqual({ names: [], total: 0, upcoming: 0 })
	})
})

describe('searchTournaments por sitio', () => {
	const search = async (q: string) => {
		const result = await searchTournaments(
			db,
			{ q, upcoming: false, withGames: false, from: '', to: '', type: null, page: 1 },
			'2026-10-20'
		)
		return result.rows.map((t) => t.name).sort()
	}
	const at = (name: string, city: string | null) => tournament(name, '2026-10-17', '2026-10-18', 'individual', city)

	beforeEach(async () => {
		// Sin ciudad: el sitio lo dice el nombre.
		await at('Cto Individual Preferente Alavesa 2026', null)
		await at('Arabako Txapelketa 2026', null)
		await at('Cto de Castilla y León 2026', null)
		await at('Cto Castellano-Leonés Sub-12 2026', null)
		// Con ciudad: manda ella.
		await at('Open Inventado 2026', 'Vitoria-Gasteiz')
		await at('Memorial Gallego 2026', 'Gijón')
		await at('Torneo de Navidad 2026', 'Ferrol')
		await at('Open de Lugo 2026', 'Lugo')
		await at('Open Ciudad de Segovia 2026', 'Segovia')
		await at('Open Internacional de Castilla y León 2026', 'Segovia')
	})

	it('una provincia: los torneos que se juegan en ella, por su ciudad o, si no la dice, por su nombre', async () => {
		const alava = ['Arabako Txapelketa 2026', 'Cto Individual Preferente Alavesa 2026', 'Open Inventado 2026']
		expect(await search('alava')).toEqual(alava)
		expect(await search('alavesa 2026')).toEqual(alava)
	})

	it('una comunidad, con todas sus provincias', async () => {
		expect(await search('galicia')).toEqual(['Open de Lugo 2026', 'Torneo de Navidad 2026'])
		expect(await search('castilla y leon')).toEqual([
			'Cto Castellano-Leonés Sub-12 2026',
			'Cto de Castilla y León 2026',
			'Open Ciudad de Segovia 2026',
			'Open Internacional de Castilla y León 2026'
		])
	})

	it('la palabra escrita encuentra el nombre, aunque el torneo se juegue en otro sitio', async () => {
		expect(await search('memorial gallego')).toEqual(['Memorial Gallego 2026'])
		// «león» es la provincia; el open de Castilla y León se juega en Segovia, pero lo dice el nombre.
		expect(await search('leon')).toEqual([
			'Cto Castellano-Leonés Sub-12 2026',
			'Cto de Castilla y León 2026',
			'Open Internacional de Castilla y León 2026'
		])
	})

	it('las demás palabras, en el nombre o en la ciudad', async () => {
		expect(await search('gijon')).toEqual(['Memorial Gallego 2026'])
		expect(await search('navidad ferrol')).toEqual(['Torneo de Navidad 2026'])
		expect(await search('open segovia')).toEqual(['Open Ciudad de Segovia 2026', 'Open Internacional de Castilla y León 2026'])
	})
})

describe('searchTournaments: primero los que nombran el sitio', () => {
	const search = async (q: string, upcoming = false) => {
		const result = await searchTournaments(
			db,
			{ q, upcoming, withGames: false, from: '', to: '', type: null, page: 1 },
			'2026-10-20'
		)
		return result.rows.map((t) => t.name)
	}
	const at = (name: string, date: string, city: string) => tournament(name, date, date, 'individual', city)

	it('con un sitio, los que lo nombran por cualquiera de sus nombres o gentilicios, aunque sean más viejos', async () => {
		await at('Torneo de Otoño 2026', '2026-10-01', 'Ferrol')
		await at('Campeonato Gallego Veterano 2019', '2019-05-01', 'Lugo')
		await at('Open de Vigo 2025', '2025-06-01', 'Vigo')
		// El gentilicio sólo ordena: no cuela un torneo de otro sitio.
		await at('Memorial Gallego 2026', '2026-09-01', 'Gijón')
		expect(await search('galicia')).toEqual(['Campeonato Gallego Veterano 2019', 'Torneo de Otoño 2026', 'Open de Vigo 2025'])
	})

	it('también en los próximos, antes que el más cercano', async () => {
		await at('Torneo de Invierno 2026', '2026-11-01', 'Ferrol')
		await at('Campionato Galego Rápido 2027', '2027-01-10', 'Vigo')
		expect(await search('galicia', true)).toEqual(['Campionato Galego Rápido 2027', 'Torneo de Invierno 2026'])
	})

	it('con dos sitios, antes el que nombra los dos', async () => {
		await at('Torneo Galicia de Oviedo 2026', '2026-06-01', 'Oviedo')
		await at('Encuentro Asturias Galicia 2020', '2020-06-01', 'Oviedo')
		expect(await search('asturias galicia')).toEqual(['Encuentro Asturias Galicia 2020', 'Torneo Galicia de Oviedo 2026'])
	})

	it('sin sitios, el orden de siempre', async () => {
		await at('Open Galicia 2019', '2019-03-01', 'Lugo')
		await at('Open de Primavera 2026', '2026-04-01', 'Madrid')
		expect(await search('open')).toEqual(['Open de Primavera 2026', 'Open Galicia 2019'])
	})
})

describe('searchTournaments: equivalencias en inglés', () => {
	const search = async (q: string) => {
		const result = await searchTournaments(
			db,
			{ q, upcoming: false, withGames: false, from: '', to: '', type: null, page: 1 },
			'2026-10-20'
		)
		return result.rows.map((t) => t.name).sort()
	}

	beforeEach(async () => {
		await tournament('41st European Chess Club Cup 2026')
		await tournament('Campeonato Europeo de Veteranos 2026')
		await tournament('FIDE World Championship 2026')
		await tournament('Copa Galicia 2026', '2026-10-17', '2026-10-18', 'individual', 'Lugo')
		await tournament('Open de Otoño 2026', '2026-10-17', '2026-10-18', 'individual', 'Lugo')
	})

	it('cada palabra, también por su equivalente en inglés', async () => {
		expect(await search('europeo')).toEqual(['41st European Chess Club Cup 2026', 'Campeonato Europeo de Veteranos 2026'])
		expect(await search('mundial')).toEqual(['FIDE World Championship 2026'])
		expect(await search('copa')).toEqual(['41st European Chess Club Cup 2026', 'Copa Galicia 2026'])
	})

	it('las demás palabras y los sitios siguen siendo obligatorios', async () => {
		expect(await search('copa europea')).toEqual(['41st European Chess Club Cup 2026'])
		expect(await search('campeonato europeo')).toEqual(['Campeonato Europeo de Veteranos 2026'])
		expect(await search('copa lugo')).toEqual(['Copa Galicia 2026'])
	})
})

describe('countTournamentsByName', () => {
	const today = '2026-10-20'
	const shown = async (q: string) =>
		(await searchTournaments(db, { q, upcoming: false, withGames: false, from: '', to: '', type: null, page: 1 }, today)).total

	beforeEach(async () => {
		await tournament('Memorial Inventado Ficticio 2026', '2026-10-17', '2026-10-18', 'individual', 'Gijón')
		await tournament('Open de Lugo 2026', '2026-10-17', '2026-10-18', 'individual', 'Lugo')
		await tournament('Torneo de Navidad 2026', '2026-10-17', '2026-10-18', 'individual', 'Ferrol')
		await tournament('European Club Cup 2026', '2026-10-01', '2026-10-08')
		// Aún no ha empezado: /torneos lo enseña en «Próximos», no en su pestaña por defecto.
		await tournament('Memorial Inventado Ficticio 2027', '2027-03-01', '2027-03-02', 'individual', 'Gijón')
	})

	it('los empezados que enseña /torneos con ese texto, también por sitio y por equivalencia', async () => {
		expect(await countTournamentsByName(db, 'inventado', today)).toEqual({ total: 1, capped: false })
		expect(await countTournamentsByName(db, 'galicia', today)).toEqual({ total: 2, capped: false })
		expect(await countTournamentsByName(db, 'europeo', today)).toEqual({ total: 1, capped: false })
		expect(await countTournamentsByName(db, 'inexistente', today)).toEqual({ total: 0, capped: false })
		for (const q of ['inventado', 'galicia', 'europeo', 'inexistente']) {
			expect((await countTournamentsByName(db, q, today))?.total, q).toBe(await shown(q))
		}
	})

	it('sin palabras que buscar, null', async () => {
		expect(await countTournamentsByName(db, '-', today)).toBeNull()
	})
})

describe('isIndexableTournament', () => {
	it('con partidas o al menos dos jugadores, como el sitemap', () => {
		expect(isIndexableTournament(0, 0)).toBe(false)
		expect(isIndexableTournament(0, 1)).toBe(false)
		expect(isIndexableTournament(0, 2)).toBe(true)
		expect(isIndexableTournament(3, 0)).toBe(true)
	})
})

describe('grupo del torneo', () => {
	const group = [
		{ key: 'cto-inventado-absoluto-2026', label: 'Campeonato Absoluto de Inventada 2026' },
		{ key: 'cto-inventado-primera-2026', label: 'Campeonato Primera de Inventada 2026' },
		{ key: 'cto-inventado-segunda-2026', label: 'Campeonato Segunda de Inventada 2026' },
		{ key: 'cto-inventado-tercera-2026', label: 'Campeonato Tercera de Inventada 2026' }
	]

	it('getTournament da su clave y el grupo guardado, o null', async () => {
		const id = await tournament('cto-inventado-absoluto-2026')
		expect(await getTournament(db, id)).toMatchObject({ source: 'info64', sourceKey: 'cto-inventado-absoluto-2026', related: null })
		await db.prepare('UPDATE tournaments SET related = ?1 WHERE id = ?2').bind(JSON.stringify(group), id).run()
		expect((await getTournament(db, id))?.related).toEqual(group)
	})

	it('las pestañas son los guardados, en el orden de la fuente, con el rótulo recortado o el nombre', async () => {
		// Guardados en otro orden; la segunda no está (aún no ha empezado, o es de menores).
		const tercera = await tournament('cto-inventado-tercera-2026')
		const absoluto = await tournament('cto-inventado-absoluto-2026')
		const primera = await tournament('cto-inventado-primera-2026')
		expect(await getTournamentGroup(db, 'info64', group)).toEqual([
			{ id: absoluto, label: 'Absoluto' },
			{ id: primera, label: 'Primera' },
			{ id: tercera, label: 'Tercera' }
		])
		// Sin rótulo, el nombre del torneo.
		const unlabelled = [{ ...group[0], label: '' }, group[1]]
		expect(await getTournamentGroup(db, 'info64', unlabelled)).toEqual([
			{ id: absoluto, label: 'cto-inventado-absoluto-2026' },
			{ id: primera, label: 'Campeonato Primera de Inventada 2026' }
		])
		// Sólo los de la misma fuente.
		expect(await getTournamentGroup(db, 'lichess', group)).toEqual([])
	})

	it('un rótulo que dice menores o parece sensible no se enseña: va el nombre', async () => {
		const absoluto = await tournament('cto-inventado-absoluto-2026')
		const navidad = await tournament('torneo-de-navidad-grupo-c')
		const otro = await tournament('torneo-de-navidad-grupo-d')
		const labelled = [
			{ key: 'cto-inventado-absoluto-2026', label: 'Absoluto' },
			{ key: 'torneo-de-navidad-grupo-c', label: 'Sub 12' },
			{ key: 'torneo-de-navidad-grupo-d', label: 'Ciegos' }
		]
		expect(await getTournamentGroup(db, 'info64', labelled)).toEqual([
			{ id: absoluto, label: 'Absoluto' },
			{ id: navidad, label: 'torneo-de-navidad-grupo-c' },
			{ id: otro, label: 'torneo-de-navidad-grupo-d' }
		])
	})
})

describe('groupLabels', () => {
	it('quita las palabras que comparten todos al principio y al final', () => {
		expect(groupLabels(['Campeonato Absoluto de Bizkaia 2026', 'Campeonato Primera de Bizkaia 2026'])).toEqual([
			'Absoluto',
			'Primera'
		])
		expect(groupLabels(['Open Sub2400', 'open Sub1800', 'Open Blitz'])).toEqual(['Sub2400', 'Sub1800', 'Blitz'])
	})

	it('deja los rótulos que no comparten nada, y el de uno solo', () => {
		expect(groupLabels(['Preferente', 'Segunda', 'Tercera'])).toEqual(['Preferente', 'Segunda', 'Tercera'])
		expect(groupLabels(['Grupo A', 'Grupo B', 'Final'])).toEqual(['Grupo A', 'Grupo B', 'Final'])
		expect(groupLabels(['Campeonato de Inventada 2026'])).toEqual(['Campeonato de Inventada 2026'])
	})

	it('quita el guion o el «de» que queda en el borde', () => {
		expect(groupLabels(['CE Absoluto', 'CE de Veteranos S50'])).toEqual(['Absoluto', 'Veteranos S50'])
		expect(groupLabels(['Open Inventado - Fase Final', 'Open Inventado Fase Previa'])).toEqual(['Fase Final', 'Fase Previa'])
		expect(groupLabels(['Liga Regional - Primera División', 'Liga Regional - Segunda División'])).toEqual([
			'Primera',
			'Segunda'
		])
	})

	it('recorta menos, primero por el principio, si a alguno no le queda una palabra que diga algo', () => {
		expect(groupLabels(['Grupo A', 'Grupo B'])).toEqual(['Grupo A', 'Grupo B'])
		expect(groupLabels(['Open A 2026', 'Open B 2026'])).toEqual(['Open A', 'Open B'])
		expect(groupLabels(['Torneo Sub 2000', 'Torneo Sub 1600'])).toEqual(['Sub 2000', 'Sub 1600'])
	})

	it('recorta menos si dos rótulos quedan iguales', () => {
		expect(groupLabels(['CE de Veteranos', 'CE Veteranos', 'CE Absoluto'])).toEqual([
			'CE de Veteranos',
			'CE Veteranos',
			'CE Absoluto'
		])
	})

	it('separa las palabras también por el punto y deja el trozo del rótulo tal como viene', () => {
		expect(groupLabels(['Torneo Inventado 2026.GrupoA', 'Torneo Inventado 2026.GrupoB'])).toEqual(['GrupoA', 'GrupoB'])
		expect(groupLabels(['Grupo A.1 Inventado', 'Grupo A.2 Inventado'])).toEqual(['Grupo A.1', 'Grupo A.2'])
	})

	it('no cuenta el número romano de la edición como una palabra que diga algo', () => {
		expect(groupLabels(['IV Open Inventado de Ajedrez', 'III Open Inventado de Ajedrez', 'II Open Inventado de Ajedrez'])).toEqual([
			'IV Open',
			'III Open',
			'II Open'
		])
		expect(groupLabels(['Open Inventado CD', 'Open Inventado CM'])).toEqual(['CD', 'CM'])
	})

	it('devuelve sus palabras sólo al rótulo que se queda sin una que diga algo, primero por el principio', () => {
		expect(groupLabels(['Open 2026', 'Open 2026 - Rápido'])).toEqual(['Open 2026', 'Rápido'])
		expect(groupLabels(['Final X Circuito Inventado', 'Final B X Circuito Inventado'])).toEqual(['Final', 'Final B'])
	})
})

describe('tournamentSummary', () => {
	const p = (title: string | null) => ({ title })

	it('cuenta los GM y los IM y da la media de los que tienen ELO', () => {
		expect(tournamentSummary('4 jugadores', [p('GM'), p('IM'), p('IM'), p('FM')], [2600, 2401, null, 2200])).toBe(
			'4 jugadores · 1 GM · 2 IM · ELO medio 2400'
		)
	})

	it('sin titulados ni ELO, sólo el tamaño', () => {
		expect(tournamentSummary('52 equipos', [p(null), p('WGM')], [null])).toBe('52 equipos')
	})
})
