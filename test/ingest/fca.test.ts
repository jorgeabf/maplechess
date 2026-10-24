import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { fcaPageUrl, fcaTournaments, tournamentName, type FcaFile } from '../../src/ingest/fca/archivo'
import { fcaParticipants, FideMatcher, type FidePlayer } from '../../src/ingest/fca/jugadores'
import { importFile } from '../../src/ingest/fca/sync'
import { FCA_NOTICE, fcaUrl, licensedPgn } from '../../src/lib/licenses'
import archivoPgn from '../fixtures/fca/archivo.pgn?raw'

const db = env.DB
const FILE: FcaFile = { path: '2008/liga_2008', season: '2008/09' }
const FILE_URL = 'https://www.fcajedrez.es/assets/partidas/2008/liga_2008.pgn'

/** La lista FIDE de los tests, con nombres inventados. */
const FIDE: FidePlayer[] = [
	{ fideId: 900001, name: 'Irreal Lejano, Supuesto Ramón', birthYear: 1970 },
	{ fideId: 900002, name: 'Inventado Falso, Otro', birthYear: 1980 },
	{ fideId: 900003, name: 'Inventado Raro, Otro', birthYear: 1985 },
	{ fideId: 900004, name: 'Ficticio Pérez, Joven', birthYear: 2005 },
	{ fideId: 900005, name: 'Imaginario Ruiz, Sin Año', birthYear: null },
	{ fideId: 900006, name: 'Supuesto Gómez, Nombre Largo', birthYear: 1990 }
]

describe('tournamentName', () => {
	it('con la temporada si no lleva año, y Cantabria si no la nombra', () => {
		expect(tournamentName('Liga Regional - Primera Division', '2008/09')).toBe(
			'Liga Regional - Primera Division 2008/09 (Cantabria)'
		)
		expect(tournamentName('Cto. Regional Absoluto 2008', '2007/08')).toBe('Cto. Regional Absoluto 2008 (Cantabria)')
		expect(tournamentName('Campeonato Cantabria Sub-16 M. 12/13', '2012/13')).toBe('Campeonato Cantabria Sub-16 M. 12/13')
	})
})

describe('fcaTournaments', () => {
	const tournaments = fcaTournaments(FILE, archivoPgn)
	const byName = new Map(tournaments.map((t) => [t.name, t]))

	it('un torneo por Event, con su clave, fechas, ciudad y modalidad', () => {
		expect([...byName.keys()]).toEqual([
			'Liga Regional - Primera Division 2008/09 (Cantabria)',
			'Cto. Regional Sub-14 2008/09 (Cantabria)',
			'Cto. Regional Absoluto 2008 (Cantabria)',
			'Cto. regional absoluto 2008/09 (Cantabria)'
		])
		const liga = byName.get('Liga Regional - Primera Division 2008/09 (Cantabria)')!
		expect(liga).toMatchObject({
			key: '2008/liga_2008/liga-regional-primera-division',
			type: 'team',
			city: 'Cantabria',
			startDate: '2008-01-12',
			endDate: '2008-02-09',
			year: 2008
		})
		expect(byName.get('Cto. regional absoluto 2008/09 (Cantabria)')).toMatchObject({
			type: 'individual',
			city: 'Torrelavega',
			year: 2021
		})
	})

	it('sin las partidas a las que les falta un jugador, y con espacios limpios', () => {
		expect(byName.get('Cto. Regional Absoluto 2008 (Cantabria)')!.games).toHaveLength(1)
		expect(byName.get('Cto. regional absoluto 2008/09 (Cantabria)')!.games[0].white).toBe('Nombre Largo Supuesto')
	})

	it('cada partida lleva en Source el archivo del que sale', () => {
		for (const t of tournaments) for (const g of t.games) expect(g.game.headers.get('Source')).toBe(FILE_URL)
	})
})

describe('FideMatcher', () => {
	const matcher = new FideMatcher(FIDE)

	it('casa si los apellidos y el nombre del archivo son el principio de los de la lista', () => {
		expect(matcher.match('Irreal, Supuesto', 2008)?.fideId).toBe(900001)
		expect(matcher.match('Irreal Lejano, Supuesto Ramon', 2008)?.fideId).toBe(900001)
	})

	it('sin coma, prueba todas las formas de partir el nombre', () => {
		expect(matcher.match('Nombre Largo Supuesto', 2021)?.fideId).toBe(900006)
	})

	it('no casa con varios candidatos, ni sin nombre de pila', () => {
		expect(matcher.candidates('Inventado, Otro')).toHaveLength(2)
		expect(matcher.match('Inventado, Otro', 2008)).toBeNull()
		expect(matcher.match('Irreal', 2008)).toBeNull()
		expect(matcher.match('Irreal,', 2008)).toBeNull()
	})

	it('no casa con quien no pudo jugar la partida por su año de nacimiento', () => {
		expect(matcher.match('Ficticio, Joven', 2008)).toBeNull()
		expect(matcher.match('Ficticio, Joven', 2011)?.fideId).toBe(900004)
		expect(matcher.match('Imaginario, Sin', 2008)?.fideId).toBe(900005)
	})
})

describe('fcaParticipants', () => {
	it('con el nombre y el FIDE ID de la lista si casan, y por equipos', () => {
		const [liga] = fcaTournaments(FILE, archivoPgn)
		const { players, names } = fcaParticipants(liga.games, new FideMatcher(FIDE), liga.year)
		expect(names.get('Irreal, Supuesto')).toBe('Irreal Lejano, Supuesto Ramón')
		expect(names.get('Inventado, Otro')).toBe('Inventado, Otro')
		expect(players).toEqual([
			{ name: 'Imaginario Ruiz, Sin Año', fideId: 900005, title: null, rating: null, fed: 'ESP', team: 'Club Imaginario', startRank: 1 },
			{ name: 'Inventado, Otro', fideId: null, title: null, rating: null, fed: null, team: 'Club Imaginario', startRank: 2 },
			{ name: 'Irreal Lejano, Supuesto Ramón', fideId: 900001, title: null, rating: null, fed: 'ESP', team: 'Club Ficticio', startRank: 1 }
		])
	})
})

describe('importFile', () => {
	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM games'),
			db.prepare('DELETE FROM participations'),
			db.prepare('DELETE FROM tournaments'),
			db.prepare('DELETE FROM players'),
			...FIDE.map((p) =>
				db
					.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (?1, ?2, ?3, '2026-10-24')")
					.bind(p.fideId, p.name, p.birthYear)
			)
		])
	})

	const stored = () =>
		db
			.prepare(
				`SELECT t.name, t.source, t.type, t.url, t.games_source AS gamesSource, g.white_name AS white, g.black_name AS black,
					g.white_fide_id AS whiteFideId, g.black_fide_id AS blackFideId, g.pgn
				FROM games g JOIN tournaments t ON t.id = g.tournament_id ORDER BY g.date, g.id`
			)
			.all<Record<string, string | number | null>>()

	it('guarda los torneos sin los de menores, con los jugadores cruzados', async () => {
		const summary = await importFile(db, FILE, archivoPgn, '2026-10-24T20:00:00.000Z')
		expect(summary).toEqual({ tournaments: 3, games: 4, players: 7, linked: 5, avisos: 0 })
		const { results } = await stored()
		expect(results.map((r) => [r.white, r.whiteFideId, r.black, r.blackFideId])).toEqual([
			['Irreal Lejano, Supuesto Ramón', 900001, 'Inventado, Otro', null],
			['Imaginario Ruiz, Sin Año', 900005, 'Irreal Lejano, Supuesto Ramón', 900001],
			// Nacido en 2005: no pudo jugar en 2008, así que se queda sin FIDE ID.
			['Ficticio, Joven', null, 'Irreal Lejano, Supuesto Ramón', 900001],
			['Supuesto Gómez, Nombre Largo', 900006, 'Irreal Lejano, Supuesto Ramón', 900001]
		])
		for (const r of results) {
			expect(r).toMatchObject({ source: 'fca', gamesSource: 'fca', url: fcaPageUrl(FILE.path) })
			expect(fcaUrl(r.pgn as string)).toBe(FILE_URL)
			expect(licensedPgn(r.pgn as string)).toContain(`{ ${FCA_NOTICE} }`)
		}
		expect(results.some((r) => String(r.white).startsWith('Menor'))).toBe(false)
	})

	it('relanzarla no duplica nada', async () => {
		await importFile(db, FILE, archivoPgn, '2026-10-24T20:00:00.000Z')
		const before = await db.prepare('SELECT id FROM games ORDER BY id').all()
		await importFile(db, FILE, archivoPgn, '2026-10-24T21:00:00.000Z')
		expect(await db.prepare('SELECT id FROM games ORDER BY id').all()).toEqual(before)
		expect(await db.prepare('SELECT count(*) AS n FROM tournaments').first('n')).toBe(3)
	})
})

describe('fcaUrl', () => {
	it('sólo con una dirección de fcajedrez.es en Source', () => {
		expect(fcaUrl('[Source "https://www.fcajedrez.es.example.com/x"]\n\n1. e4 *')).toBeNull()
		expect(fcaUrl('[Source "ChessBase"]\n\n1. e4 *')).toBeNull()
		expect(fcaUrl(`[Source "${FILE_URL}"]\n\n1. e4 *`)).toBe(FILE_URL)
	})
})
