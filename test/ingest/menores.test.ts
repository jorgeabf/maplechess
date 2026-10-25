import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import { Info64SyncWorkflow, type Info64SyncParams } from '../../src/ingest/info64/sync'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import { isMinorsTournament } from '../../src/ingest/menores'
import {
	deleteTournaments,
	replacePairings,
	replaceParticipations,
	saveGames,
	saveLichessTour,
	upsertTournament,
	type TournamentInput
} from '../../src/ingest/repo'
import { applyMinorsTournaments } from '../../src/ingest/reprocess'
import { parseGames } from '../../src/lib/chess/pgn'
import { addDays, madridDateTime } from '../../src/lib/dates'
import { getPlayerTournaments } from '../../src/lib/db/players'

// Torneos de menores (hasta Sub 14 y escolares): no se guardan. Torneos y
// jugadores inventados.
const db = env.DB

const count = async (sql: string, ...params: unknown[]) =>
	(await db
		.prepare(sql)
		.bind(...params)
		.first<{ n: number }>())!.n

const clean = () =>
	db.batch([
		db.prepare('DELETE FROM lichess_tours'),
		db.prepare('DELETE FROM standings'),
		db.prepare('DELETE FROM pairings'),
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM site_totals')
	])

describe('isMinorsTournament', () => {
	it('reconoce las edades hasta Sub 14, en todas sus formas', () => {
		for (const name of [
			'CE Sub-08 2030',
			'Campeonato de Ninguna Parte Sub 8',
			'XXV Memorial Inventado sub10',
			'Campeonato Inventado SUB12',
			'Abierto Inventado Sub-13',
			'Sub 12y14 I Open de Xadrez Inventado',
			'Campeonato Sub 14Inventada 2030',
			'III Torneo de Xadrez Inventado U-10',
			'World Cadets Chess Championships 2030 U08 Girls',
			'FIDE World U9-U17 Rapid & Blitz Chess Championships',
			'European Youth Chess Championship 2030 | G12',
			'Festival Infantil Inventado | O10',
			'FIDE World Championship 2030 - O7',
			'FIDE World Championship 2030 - G9',
			'FIDE World Championship 2030 - O11',
			'FIDE World Championship 2030 - G13',
			'European Youth Inventado | G9',
			'Campeonato por Edades de Ninguna Parte S08',
			'Equipos S-12 Inventados',
			'Zonal Inventado S1416',
			'i-torneo-ajedrez-colegio-inventado-sub-08'
		]) {
			expect(isMinorsTournament(name), name).toBe(true)
		}
	})

	it('reconoce las categorías hasta infantil, también en catalán y gallego', () => {
		for (const name of [
			'Torneo de Navidad Inventado - PREBENJAMIN',
			'Juegos Municipales Inventados - Benjamín',
			'Festival Inventado - Pre_Benjamin',
			'III TORNEO INVENTADO - ALEVIN2',
			'Cto individual alevín de Ninguna Parte',
			'Campeonato Insular Infantil Masculino',
			"XIV Torneig d'Escacs Infantils",
			'Torneo de Xadrez Inventado Benxamín'
		]) {
			expect(isMinorsTournament(name), name).toBe(true)
		}
	})

	it('reconoce los de colegios y los escolares', () => {
		for (const name of [
			'I Torneo Ajedrez Colegio Inventado',
			'Campeonato de España de Colegios',
			'X Torneo CEIP Inventado',
			'VIII Torneo IES Inventado',
			'I Torneo de Ajedrez I.E.S. Sierra Inventada.',
			'Torneo C.E.I.P. Inventado',
			'Campeonato Regional Institutos 2030',
			'Torneo de ajedrez - Inventado College - Categoria A',
			'FIDE ISCF World Schools Team Championship 2030',
			'I San Inventado Ikastola - Txapelketa',
			'Juegos Escolares Municipales de Ninguna Parte',
			'Cto. Interescolar de Inventadia 2030',
			'V Torneo de Ajedrez Intercentros',
			'Circuito_JUDEX_Nacional_2030_INVENTADO',
			'Juegos Deportivos del Principado Inventado',
			'Zonal I Inventada XL Jocs Esportius C.V.',
			'Torneo do Programa Xogade',
			"XII Torneig d'Escoles - Club Inventat",
			// El slug de info64 pega la «d» del apóstrofo.
			'xii-torneig-descoles-club-inventat',
			'Inventatu III. Eskolarteko Xake Txapelketa Especial A',
			'Inventatu IV Eskolartekoa. Especial',
			'Taldekako eskolarteko txapelketa',
			'II Torneo Xadrez nas Escolas',
			"Torneo de Xadrez 'Xadrez nas Escolas'",
			'I Torneio das Escolas',
			'JDN Sub-16 Individual Masculino (Fase Final) 2030',
			'JDN EQUIPOS S18 2030',
			'Torneo Promocion JDN',
			'Final Provincial Sub 16 Inventada XXXIX JJEE C. VAL',
			'Final Provincial Sub 16 Inventada JJ.EE.',
			'PROVINCIAL CADETE DEPORTE BASE 2030',
			'Campeonato Provincial del Deporte en Edad Escolar',
			'II Torneo de Ajedrez FEC Vedruna. Especial Open',
			'I Inventatuko Eskola - Txapelketa. Especial',
			'Ajedrez en el recreo 3er Ciclo',
			'SEXTA JORNADA CIRCUITO DE AJEDREZ INTER ESC',
			'Circuito de Ajedrez Inter Escolar Inventado'
		]) {
			expect(isMinorsTournament(name), name).toBe(true)
		}
	})

	it('reconoce los de niños', () => {
		for (const name of [
			'Seronda Kids Inventada',
			'Business Meets Chess&Kids Inventado',
			'Los Viernes Inventados Opening Kids 2030',
			'I Torneo Inventado para niños',
			'Torneo de Ninguna Parte para niñas',
			'Torneo de Xadrez Inventado para nenos',
			'Xadrez Inventado para rapazas',
			'Torneig Inventat per a nens i nenes',
			"Torneig d'Escacs per a infants Inventat",
			'I Inventatuko Txapelketa Umeentzat',
			'Haurrentzat Xake Txapelketa Inventatua',
			'Inventatuko Xake Txapelketa Txikientzat'
		]) {
			expect(isMinorsTournament(name), name).toBe(true)
		}
	})

	it('reconoce los «por edades» con todas las categorías o por letras', () => {
		for (const name of [
			'Campeonato de Inventadia por Edades 2026',
			'Cto Inventadia Rapido Individual por Edades Online',
			'Por Edades CTL Inventada 2026 Previa A',
			'Finales Por Edades CTL Inventada 2022',
			'Por edades Inventada CTL 2026 Final D',
			'IV Memorial Inventado por Edades'
		]) {
			expect(isMinorsTournament(name), name).toBe(true)
		}
	})

	it('deja los «por edades» de Sub 16 y Sub 18, cadetes, juveniles y veteranos', () => {
		for (const name of [
			'Campeonato de Inventadia por Edades Sub 16 2021',
			'Campeonato de Inventadia por Edades 2025 sub-18',
			'Previa Provincial por Edades Inventada 2020 Sub18',
			'Campeonato de Inventadia Rapido por Edades S16 2024',
			'Campeonato de Inventadia por Edades Cadete',
			'Campeonato de Inventadia por Edades Juvenil',
			'Campeonato de Inventadia por Edades Veteranos +65 2021',
			'Campeonato de Inventadia Rapido por Edades 2025 +50',
			'Campeonato de Inventadia por Edades 2026 V50',
			'Previa Provincial por Edades Inventada 2020 Supra 50',
			'Por Edades CTL Inventada 2023 Previa Supra65',
			'Campeonato por Edades Inventado Veteranos',
			'Campeonato por Edades Inventado S-16',
			'Campeonato por Edades Inventado U-16',
			'Campeonato por Edades Inventado V-65',
			'Campeonato por Edades Inventado S-50',
			'Campeonato por Edades Inventado +60',
			'Campeonato por Edades Inventado Senior',
			'Campeonato por Edades Inventado Mayores de 50'
		]) {
			expect(isMinorsTournament(name), name).toBe(false)
		}
	})

	it('reconoce las categorías por años de nacimiento, con la fecha del torneo', () => {
		for (const [name, date] of [
			['IV Circuito Inventado Categ. A (2019-2018-2017)', '2026-01-25'],
			['IV Circuito Inventado Categ. B (2016-2015-2014) Inventada', '2026-02-15'],
			['III Circuito Inventado. Cat. A (2017-18-19)', '2025-02-16'],
			['IV Circuito Inventado Categ. C (2011-12-13) Y ABS. SIN ELO', '2026-04-19'],
			['III Circuito Inventado. Cat. B (2015-2016)', '2025-01-26'],
			['I Circuito Inventado. Grupo B (2011, 2012 y 2013)', '2023-02-19'],
			['I Circuito Inventado. Grupo C (2008, 2009 y 2010)', '2023-02-19'],
			['Circuit Inventat. Grup B (2011 i 2012)', '2022-11-27'],
			['Circuito Inventado. Grupo B (2011 e 2012)', '2022-11-27'],
			// Sin fecha (el slug de una pasada con keys), sólo con tres años.
			['iv-circuito-inventado-categ-a-2019-2018-2017', null]
		] as const) {
			expect(isMinorsTournament(name, date), name).toBe(true)
		}
	})

	it('deja las temporadas, los grupos de mayores y la categoría absoluta', () => {
		for (const [name, date] of [
			['Cto Inventado 2014-2015 (Fase Semifinal A) No oficial', '2015-03-09'],
			['Campeonato de Inventadia de Veteranos 2015-2016', '2016-01-11'],
			['Liga Inventada 2025-2026', '2025-10-04'],
			['Liga Inventada 2025-2026', null],
			// La temporada que añade el archivo de Cantabria, con una fecha de otro año.
			['Cto. regional inventado 2008/09 (Cantabria)', '2021-03-07'],
			['Circuito Inventado. Cat. B (2015-2016)', null],
			['Veteranos Inventados (1950-1951-1952)', '2026-01-10'],
			['IV Circuito Inventado Categ. D (ABSOLUTA)', '2026-01-25']
		] as const) {
			expect(isMinorsTournament(name, date), name).toBe(false)
		}
	})

	it('deja los topes de ELO, Sub 16 y Sub 18, cadete y juvenil, las escuelas de ajedrez y los grupos', () => {
		for (const name of [
			'Open Internacional Inventado Sub2200',
			'Campeonato Sub-1400 de Ninguna Parte',
			'Torneo B SUB 1800 FIDE',
			'XII Open Internacional de Ajedrez Ciudad Inventada | U2400',
			'Ibiza Inventada Chess Festival Under 1800',
			'Torneo Sub16 Navidad Inventado',
			'Campeonato de España Sub 18',
			'Campeonato Cadete de Inventadia',
			'Campeonato Juvenil Inventado',
			'Open Escuela de Ajedrez Inventada',
			'Xake Eskola Inventada Open',
			'Inventatuko Xake Eskola - Udako Irekia',
			'Copa Campeones 2030 Cat Especial',
			'Cto. de Inventadia Absoluto por equipos Especial Grupo A',
			'Sociedad El Recreo Inventada',
			"I IRT Sub1800 Escola d'Escacs Inventada",
			'Torneo Escolas Xadrez Inventadas Nadal 2030',
			'Escolas Inventadas Entroido 2030',
			'Jornada de Entrenamiento G6',
			'Jornada de Entrenamiento G8',
			'Jornada de Entrenamiento G9',
			'Torneo de los Santos Niños Inventado ABSOLUTO',
			'Open Inventado Aves Rapaces',
			'Memorial Txiki Inventado',
			'German University Chess Championship 2030',
			'Campeonato Absoluto de Ninguna Parte',
			'Memorial Benjamina Inventada'
		]) {
			expect(isMinorsTournament(name), name).toBe(false)
		}
	})
})

describe('torneos de menores en la pasada de info64', () => {
	const MINORS = 'campeonato-inventado-sub-12'
	const OTHER = 'open-inventado'
	// El calendario quita el último paréntesis del título (la ciudad): los años
	// de nacimiento sólo se ven en la página.
	const BY_YEARS = 'circuito-inventado-cat-b'
	const tomorrow = addDays(madridDateTime(new Date()).slice(0, 10), 1)
	let requested: string[] = []

	const cell = (cls: string, text: string | number) => `<td class="${cls}">${text}</td>`
	const ranking = (prefix: string) =>
		[1, 2]
			.map(
				(rank) =>
					`<tr>${cell('playerstartrank', rank)}${cell('playertitle', '')}${cell('playername', `${prefix} Inventado, Jugador ${rank}`)}` +
					`${cell('playerfederation', 'ESP')}${cell('playerfiderat', 1500 + rank)}${cell('playerfideratid', 930300 + rank)}</tr>`
			)
			.join('')
	const pgn = (prefix: string) =>
		`[Event "Torneo"]\n[Round "1.1"]\n[White "${prefix} Inventado, Jugador 1"]\n[Black "${prefix} Inventado, Jugador 2"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`
	const pages: Record<string, string> = {
		// Del primero, una ronda jugada y la siguiente, mañana.
		'events.json': JSON.stringify([
			{ title: 'R.1 - Campeonato Inventado Sub 12', url: `/${MINORS}/`, start: '2026-09-01T17:00:00' },
			{ title: 'R.2 - Campeonato Inventado Sub 12', url: `/${MINORS}/`, start: `${tomorrow}T17:00:00` },
			{ title: 'R.1 - Open Inventado', url: `/${OTHER}/`, start: '2026-09-01T17:00:00' },
			{ title: 'R.1 - Circuito Inventado. Cat. B (2015-2016)', url: `/${BY_YEARS}/`, start: '2026-09-01T10:00:00' }
		]),
		[BY_YEARS]: `<h1>Circuito Inventado. Cat. B (2015-2016)</h1><table id="initial-ranking-table"><tbody>${ranking('Niño')}</tbody></table>`,
		[MINORS]: `<h1>Campeonato Inventado Sub 12</h1><table id="initial-ranking-table"><tbody>${ranking('Menor')}</tbody></table>`,
		[`${MINORS}/games`]: `<textarea id="pgnText">${pgn('Menor')}</textarea>`,
		[OTHER]: `<h1>Open Inventado</h1><table id="initial-ranking-table"><tbody>${ranking('Abierto')}</tbody></table>`,
		[`${OTHER}/games`]: `<textarea id="pgnText">${pgn('Abierto')}</textarea>`
	}

	// Pasos de verdad, sin Workflow: cada uno se ejecuta y su salida pasa por JSON.
	const step = {
		do: async (_name: string, ...rest: unknown[]) =>
			JSON.parse(JSON.stringify((await (rest.at(-1) as () => Promise<unknown>)()) ?? null)),
		sleep: async () => {}
	} as unknown as WorkflowStep
	const run = (payload: Info64SyncParams) =>
		(Object.assign(Object.create(Info64SyncWorkflow.prototype), { env }) as Info64SyncWorkflow).run(
			{ payload } as WorkflowEvent<Info64SyncParams>,
			step
		)
	const window: Info64SyncParams = { from: '2026-08-01', to: '2026-10-01' }
	const minorsRequests = () => requested.filter((path) => path.startsWith(MINORS))

	beforeEach(async () => {
		await clean()
		requested = []
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const path = new URL(String(input instanceof Request ? input.url : input)).pathname.replace(/^\//, '')
			requested.push(path)
			const page = pages[path]
			return page === undefined ? new Response('no encontrado', { status: 404 }) : new Response(page)
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('ni la diaria ni una pasada a mano (por el slug) lo piden ni lo guardan', async () => {
		await run(window)
		await run({ from: '', to: '', keys: [MINORS], force: true })
		expect(minorsRequests()).toEqual([])
		expect(requested).toContain(OTHER)
		expect(await count('SELECT count(*) AS n FROM tournaments WHERE source_key = ?1', MINORS)).toBe(0)
		expect(await count('SELECT count(*) AS n FROM tournaments')).toBe(1)
	})

	it('no guarda el que sólo por el nombre y la fecha de su página es de menores', async () => {
		await run(window)
		expect(requested).toContain(BY_YEARS)
		expect(requested).not.toContain(`${BY_YEARS}/games`)
		expect(await count('SELECT count(*) AS n FROM tournaments WHERE source_key = ?1', BY_YEARS)).toBe(0)
		expect(await count('SELECT count(*) AS n FROM participations')).toBe(2)
	})

	it('la pasada de emparejamientos no pide su ronda', async () => {
		await run({ from: '', to: '', pairings: 'only' })
		expect(requested).toEqual(['events.json'])
		expect(await count('SELECT count(*) AS n FROM tournaments')).toBe(0)
	})

	it('la de sólo clasificación tampoco lo lee, aunque siga guardado', async () => {
		await run(window)
		// Guardado de antes, sin reprocesar.
		await upsertTournament(db, {
			source: 'info64',
			key: MINORS,
			type: 'individual',
			name: 'Campeonato Inventado Sub 12',
			city: null,
			startDate: '2026-09-01',
			endDate: '2026-09-02',
			timeControl: null,
			url: `https://info64.org/${MINORS}`,
			syncedAt: '2026-09-01T00:00:00.000Z'
		})
		requested = []
		await run({ from: '2026-08-01', to: '2026-10-01', standings: 'only' })
		expect(requested).toEqual([`${OTHER}/standings`])
	})
})

describe('applyMinorsTournaments', () => {
	const tournament = (key: string, name: string): TournamentInput => ({
		source: 'info64',
		key,
		type: 'individual',
		name,
		city: 'Ninguna',
		startDate: '2026-09-01',
		endDate: '2026-09-02',
		timeControl: '90+30',
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z'
	})
	const player = (startRank: number, name: string, fideId: number): TournamentPlayer => ({
		startRank,
		team: null,
		title: null,
		name,
		fed: 'ESP',
		rating: 1500 + startRank,
		fideId
	})
	// Uno de los dos sólo juega el torneo de menores; el otro, también un open.
	const players = [player(1, 'Menor Inventado, Uno', 930401), player(2, 'Menor Inventado, Dos', 930402)]

	/** Guarda el torneo con esos participantes y, si hay dos, una partida entre ellos. */
	async function store(input: TournamentInput, entrants: TournamentPlayer[]): Promise<number> {
		const id = await upsertTournament(db, input)
		await replaceParticipations(db, id, entrants)
		if (entrants.length < 2) return id
		const [white, black] = entrants
		const game = `[Event "Torneo"]\n[Round "1.1"]\n[White "${white.name}"]\n[Black "${black.name}"]\n[Result "1-0"]\n\n1. d4 d5 1-0\n`
		await saveGames(db, id, buildGameRows(parseGames(game), entrants, input), '2026-10-01T00:00:00.000Z', {
			name: 'info64',
			url: null
		})
		return id
	}

	beforeEach(clean)

	it('borra los de menores con todo lo suyo y no toca los demás', async () => {
		const minors = await store(tournament('torneo-escolar-inventado', 'Torneo Escolar Inventado'), players)
		await replacePairings(db, minors, 2, '2030-09-02 10:00', [
			{ board: 1, white: { startRank: 1, name: 'x', rating: null }, black: { startRank: 2, name: 'x', rating: null } }
		])
		await db
			.prepare("INSERT INTO standings (tournament_id, pos, start_rank, points, tiebreaks) VALUES (?1, 1, 1, 1, '[]')")
			.bind(minors)
			.run()
		await saveLichessTour(
			db,
			{ tourId: 'Inventad', name: 'Torneo Escolar Inventado', url: null, status: 'enlazado', tournamentId: minors, espPlayers: 2, finished: true },
			'2026-10-01T00:00:00.000Z'
		)
		await store(tournament('campeonato-inventado-sub-08', 'Campeonato Inventado Sub 08'), [])
		await store(tournament('open-inventado', 'Open Inventado'), [player(1, 'Menor Inventado, Dos', 930402), player(2, 'Rival Inventado, Tres', 930403)])
		await store(tournament('campeonato-inventado-sub-16', 'Campeonato Inventado Sub 16'), [])

		expect(await applyMinorsTournaments(db)).toEqual({ deleted: 2 })

		expect(await count('SELECT count(*) AS n FROM tournaments WHERE id = ?1', minors)).toBe(0)
		for (const table of ['participations', 'games', 'pairings', 'standings']) {
			expect(await count(`SELECT count(*) AS n FROM ${table} WHERE tournament_id = ?1`, minors), table).toBe(0)
		}
		// Ni en la búsqueda de partidas ni en las fichas.
		expect(await count(`SELECT count(*) AS n FROM games_fts WHERE games_fts MATCH '"uno"'`)).toBe(0)
		expect(await getPlayerTournaments(db, 930401)).toEqual([])
		expect((await getPlayerTournaments(db, 930402)).map((t) => t.tournamentName)).toEqual(['Open Inventado'])
		expect(await db.prepare('SELECT tournament_id AS id FROM lichess_tours').first()).toEqual({ id: null })
		expect(await db.prepare('SELECT tournaments FROM site_totals').first()).toEqual({ tournaments: 2 })

		// Repetirlo no cambia nada.
		expect(await applyMinorsTournaments(db)).toEqual({ deleted: 0 })
	})

	it('mira la fecha de cada torneo para los años de nacimiento', async () => {
		const at = (key: string, name: string, startDate: string | null) =>
			store({ ...tournament(key, name), startDate, endDate: startDate }, [])
		const minors = await at('cat-b', 'Circuito Inventado. Cat. B (2015-2016)', '2025-01-26')
		const byAge = await at('por-edades', 'Campeonato de Inventadia por Edades 2026', '2026-01-17')
		await at('liga', 'Liga Inventada 2025-2026', '2025-10-04')
		// Sin fecha, dos años no bastan.
		await at('cat-b-sin-fecha', 'Circuito Inventado. Cat. B (2015-2016)', null)

		expect(await applyMinorsTournaments(db)).toEqual({ deleted: 2 })
		const kept = (await db.prepare('SELECT id, source_key AS key FROM tournaments ORDER BY id').all<{ id: number; key: string }>())
			.results
		expect(kept.map((t) => t.key)).toEqual(['liga', 'cat-b-sin-fecha'])
		expect(kept.map((t) => t.id)).not.toContain(minors)
		expect(kept.map((t) => t.id)).not.toContain(byAge)
	})

	it('borra por trozos', async () => {
		const ids = [
			await store(tournament('uno', 'Uno'), []),
			await store(tournament('dos', 'Dos'), []),
			await store(tournament('tres', 'Tres'), [])
		]
		const keep = await store(tournament('cuatro', 'Cuatro'), [])
		await deleteTournaments(db, ids, 2)
		expect((await db.prepare('SELECT id FROM tournaments').all<{ id: number }>()).results).toEqual([{ id: keep }])
	})
})
