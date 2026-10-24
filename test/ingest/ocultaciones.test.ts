import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FidePlayer } from '../../src/ingest/fide/parse'
import { buildGameRows } from '../../src/ingest/games'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import { withoutHiddenYear } from '../../src/ingest/nombres'
import {
	replacePairings,
	replaceParticipations,
	saveGames,
	upsertFidePlayers,
	upsertTournament,
	type TournamentInput
} from '../../src/ingest/repo'
import { applyHidden } from '../../src/ingest/reprocess'
import { parseGames } from '../../src/lib/chess/pgn'
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
		db.prepare('DELETE FROM pairings'),
		db.prepare('DELETE FROM games'),
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
		const none = { players: 0, participations: 0, games: 0, pairings: 0 }
		expect(await applyHidden(db)).toEqual({ sex: 1, birthYear: 3, ...none })
		expect(await applyHidden(db)).toEqual({ sex: 0, birthYear: 0, ...none })
		expect(await stored()).toEqual([
			{ fideId: SHE.fideId, sex: null, birthYear: 1970, hidden: 1 },
			{ fideId: OTHER_WOMAN.fideId, sex: 'F', birthYear: 1990, hidden: 0 },
			{ fideId: YOUNG.fideId, sex: 'M', birthYear: 2009, hidden: 1 },
			{ fideId: VETERAN.fideId, sex: 'M', birthYear: 1960, hidden: 0 },
			{ fideId: OLDER.fideId, sex: 'M', birthYear: 1955, hidden: 1 }
		])
	})
})

describe('el año en el nombre de los homónimos', () => {
	// La FIDE distingue a los homónimos con su año de nacimiento.
	const HOMONYM = player(9400011, 'Supuesto Irreal, Otro 1980', 'M', 1980, 1900) // oculta el año
	const OTHER = player(9400012, 'Supuesto Irreal, Otro 1975', 'M', 1975, 1950) // no
	const RIVAL = player(9400013, 'Inventado Ficticio, Rival', 'M', 1990, 1800)
	const BARE = 'Supuesto Irreal, Otro'

	const tournament = (key: string): TournamentInput => ({
		source: 'info64',
		key,
		type: 'individual',
		name: `Torneo ${key}`,
		city: 'Ninguna',
		startDate: '2026-09-01',
		endDate: '2026-09-02',
		timeControl: '90+30',
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z'
	})
	const participant = (startRank: number, p: FidePlayer, fideId: number | null = p.fideId): TournamentPlayer => ({
		startRank,
		team: null,
		title: null,
		name: p.name,
		fed: 'ESP',
		rating: p.ratingStd,
		fideId
	})
	const game = (board: number, white: string, black: string) =>
		`[Event "Torneo"]\n[Round "1.${board}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "1/2-1/2"]\n\n1. d4 d5 1/2-1/2\n`
	const CHECKED = '2026-10-01T00:00:00.000Z'

	/**
	 * Lo que traen las fuentes, con los nombres de la lista FIDE: un torneo con
	 * los tres y sus FIDE ID, otro en el que el homónimo va sin él, y los
	 * emparejamientos del primero, uno con un número que no está en el ranking.
	 */
	const ingest = async () => {
		const first = await upsertTournament(db, tournament('con-fide-id'))
		const players = [participant(1, HOMONYM), participant(2, OTHER), participant(3, RIVAL)]
		await replaceParticipations(db, first, players)
		const pgn = [game(1, HOMONYM.name, RIVAL.name), game(2, RIVAL.name, OTHER.name)].join('\n')
		await saveGames(db, first, buildGameRows(parseGames(pgn), players, tournament('con-fide-id')), CHECKED, {
			name: 'info64',
			url: null
		})
		const side = (startRank: number, name = 'ignorado') => ({ startRank, name, rating: null })
		await replacePairings(db, first, 2, '2026-09-02 10:00', [
			{ board: 1, white: side(1), black: side(2) },
			// Sin participante con ese número: el nombre de la página, sin FIDE ID.
			{ board: 2, white: side(9, HOMONYM.name), black: side(3) }
		])
		const second = await upsertTournament(db, tournament('sin-fide-id'))
		await replaceParticipations(db, second, [participant(1, HOMONYM, null), participant(2, RIVAL)])
		const rows = buildGameRows(parseGames(game(1, RIVAL.name, HOMONYM.name)), [], tournament('sin-fide-id'))
		await saveGames(db, second, rows, CHECKED, { name: 'info64', url: null })
	}

	const names = async (sql: string) => (await db.prepare(sql).all<{ name: string }>()).results.map((r) => r.name)
	const fts = async (table: 'players_fts' | 'games_fts', word: string) =>
		(await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table} MATCH ?1`).bind(`"${word}"`).first<{ n: number }>())!.n

	/** Que no quede el año del homónimo en ninguna parte, y sí el del otro. */
	const expectHidden = async () => {
		expect(await names('SELECT name FROM players WHERE fide_id > 9400010 ORDER BY fide_id')).toEqual([BARE, OTHER.name, RIVAL.name])
		expect(await names('SELECT name FROM participations ORDER BY tournament_id, start_rank')).toEqual([
			BARE,
			OTHER.name,
			RIVAL.name,
			BARE,
			RIVAL.name
		])
		const games = await db
			.prepare('SELECT white_name AS w, black_name AS b, pgn FROM games ORDER BY tournament_id, board')
			.all<{ w: string; b: string; pgn: string }>()
		expect(games.results.map(({ w, b }) => [w, b])).toEqual([
			[BARE, RIVAL.name],
			[RIVAL.name, OTHER.name],
			[RIVAL.name, BARE]
		])
		expect(games.results[0].pgn).toContain(`[White "${BARE}"]`)
		expect(games.results[2].pgn).toContain(`[Black "${BARE}"]`)
		expect(games.results.filter((g) => g.pgn.includes('1980'))).toEqual([])
		expect(games.results[1].pgn).toContain(`[Black "${OTHER.name}"]`)
		const pairings = await db.prepare('SELECT white_name AS w, black_name AS b FROM pairings ORDER BY board').all()
		expect(pairings.results).toEqual([
			{ w: BARE, b: OTHER.name },
			{ w: BARE, b: RIVAL.name }
		])
		// Los índices FTS siguen a los nombres: buscar el año ya no le encuentra.
		expect(await fts('players_fts', '1980')).toBe(0)
		expect(await fts('games_fts', '1980')).toBe(0)
		expect(await fts('players_fts', '1975')).toBe(1)
		expect(await fts('games_fts', '1975')).toBe(1)
		const search = await searchPlayers(db, playerFilters(new URLSearchParams('q=irreal')), 2026)
		expect(search.rows.map((p) => p.name)).toEqual([OTHER.name, BARE])
	}

	it('se quita con el FIDE ID y, sin él, por el nombre y el año; el de otro homónimo, no', () => {
		const hidden = { ids: new Set([HOMONYM.fideId]), names: new Set(['supuesto irreal, otro 1980']) }
		expect(withoutHiddenYear(hidden, HOMONYM.fideId, HOMONYM.name)).toBe(BARE)
		expect(withoutHiddenYear(hidden, HOMONYM.fideId, 'Supuesto Irreal, Otro 1980 I')).toBe(BARE)
		expect(withoutHiddenYear(hidden, null, 'Supuésto Irreal,Otro 1980')).toBe('Supuésto Irreal, Otro')
		// Con FIDE ID, sólo por él: otro con el mismo nombre y año es otra persona.
		expect(withoutHiddenYear(hidden, OTHER.fideId, HOMONYM.name)).toBe(HOMONYM.name)
		expect(withoutHiddenYear(hidden, null, OTHER.name)).toBe(OTHER.name)
		expect(withoutHiddenYear(hidden, HOMONYM.fideId, RIVAL.name)).toBe(RIVAL.name)
	})

	it('la ingesta lo quita al escribir: la ficha, los participantes, las partidas con su PGN y los emparejamientos', async () => {
		await hide(HOMONYM.fideId, 'anio')
		await upsertFidePlayers(db, [HOMONYM, OTHER, RIVAL], '2026-10', '2026-10-03T06:00:00.000Z')
		await ingest()
		await expectHidden()
	})

	it('el reprocesado lo quita de lo guardado antes, sin tocar a los demás; repetirlo no cambia nada', async () => {
		await upsertFidePlayers(db, [HOMONYM, OTHER, RIVAL], '2026-10', '2026-10-03T06:00:00.000Z')
		await ingest()
		expect(await fts('games_fts', '1980')).toBe(2)

		await hide(HOMONYM.fideId, 'anio')
		expect(await applyHidden(db)).toEqual({ sex: 0, birthYear: 1, players: 1, participations: 2, games: 2, pairings: 2 })
		await expectHidden()
		expect(await applyHidden(db)).toEqual({ sex: 0, birthYear: 0, players: 0, participations: 0, games: 0, pairings: 0 })
	})
})
