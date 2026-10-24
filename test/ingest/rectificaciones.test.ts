import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildGameRows } from '../../src/ingest/games'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import { RETIRED_NAME } from '../../src/ingest/nombres'
import {
	replacePairings,
	replaceParticipations,
	saveGames,
	upsertTournament,
	type TournamentInput
} from '../../src/ingest/repo'
import { parseGames, setPgnResult, setPgnTags } from '../../src/lib/chess/pgn'

// Rectificación y limitación (tabla rectificaciones): aplicarlas al escribir,
// también al releer el torneo. Nombres e ID inventados.
const db = env.DB

const tournament: TournamentInput = {
	source: 'info64',
	key: 'torneo-rectificaciones',
	type: 'individual',
	name: 'Torneo de las rectificaciones',
	city: 'Ninguna',
	startDate: '2026-09-01',
	endDate: '2026-09-03',
	timeControl: '90+30',
	url: 'https://info64.org/torneo-rectificaciones',
	syncedAt: '2026-10-01T00:00:00.000Z'
}

const player = (startRank: number, name: string, fideId: number | null, title: string | null = null): TournamentPlayer => ({
	startRank,
	team: null,
	title,
	name,
	fed: 'ESP',
	rating: 1800 + startRank,
	fideId
})
// La fuente le da a Supuesto Irreal el FIDE ID de otra persona (930001). La
// cuarta no tiene partidas.
const players = [
	player(1, 'Supuesto Irreal, Otro', 930001, 'FM'),
	player(2, 'Rival Dos, Otra', 930002),
	player(3, 'Rival Tres, Alguien', 930003),
	player(4, 'Sin Partidas, Cuarta', 930004)
]
const [A, B, C] = players.map((p) => p.name)

/** Partida como las de info64: los nombres del ranking, sin FIDE ID. */
const game = (round: number, white: string, black: string, result = '1/2-1/2') =>
	`[Event "Torneo"]\n[Round "${round}.1"]\n[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n\n1. d4 d5 ${result}\n`
const PGN = [game(1, A, B), game(2, C, A), game(3, A, C, '1-0')].join('\n')

/**
 * Lee el torneo de la fuente y lo guarda, como una pasada de info64 con
 * `keys`: participantes y partidas. Devuelve su id.
 */
async function read(pgn = PGN, source = players, checkedAt = new Date().toISOString()): Promise<number> {
	const id = await upsertTournament(db, tournament)
	await replaceParticipations(db, id, source)
	await saveGames(db, id, buildGameRows(parseGames(pgn), source, tournament), checkedAt, { name: 'info64', url: null })
	return id
}

interface Row {
	fideId?: number
	nombre?: string
	ronda?: number
	campo: string
	valor: string | null
}

/** Apunta una rectificación de este torneo, como la guía de operación. Devuelve su id. */
const rectify = async ({ fideId, nombre, ronda, campo, valor }: Row, key = tournament.key) =>
	(await db
		.prepare(
			`INSERT INTO rectificaciones (peticion, source, source_key, fide_id, nombre, ronda, campo, valor, creada)
			VALUES ('P-2026-001', 'info64', ?1, ?2, ?3, ?4, ?5, ?6, '2026-10-24') RETURNING id`
		)
		.bind(key, fideId ?? null, nombre ?? null, ronda ?? null, campo, valor)
		.first<{ id: number }>())!.id

const games = async () =>
	(
		await db
			.prepare(
				`SELECT round, white_name AS w, black_name AS b, white_fide_id AS wid, black_fide_id AS bid,
					white_elo AS welo, black_elo AS belo, result, pgn
				FROM games ORDER BY round`
			)
			.all<{
				round: number
				w: string
				b: string
				wid: number | null
				bid: number | null
				welo: number | null
				belo: number | null
				result: string
				pgn: string
			}>()
	).results

/** Participante de este torneo, por su número del ranking inicial. */
const participant = (startRank: number) =>
	db
		.prepare(
			`SELECT p.name, p.name_norm AS nameNorm, p.fide_id AS fideId, p.title, p.rating
			FROM participations p JOIN tournaments t ON t.id = p.tournament_id
			WHERE t.source_key = ?1 AND p.start_rank = ?2`
		)
		.bind(tournament.key, startRank)
		.first()

const count = async (sql: string, ...params: unknown[]) =>
	(await db
		.prepare(sql)
		.bind(...params)
		.first<{ n: number }>())!.n

const applied = (id: number) =>
	db
		.prepare('SELECT aplicada FROM rectificaciones WHERE id = ?1')
		.bind(id)
		.first<{ aplicada: string | null }>()
		.then((r) => r!.aplicada)

describe('cabeceras del PGN', () => {
	const pgn =
		'[Event "Torneo"]\n[White "Uno, Alguien"]\n[Black "Dos, \\"Otra\\""]\n[WhiteFideId "930001"]\n[Result "1-0"]\n\n1. d4 { 1-0 } d5 1-0\n'

	it('setPgnTags cambia, quita y añade cabeceras, y nada más', () => {
		expect(setPgnTags(pgn, { White: 'Nuevo, "Nombre"', WhiteFideId: null, BlackElo: '1850' })).toBe(
			'[Event "Torneo"]\n[White "Nuevo, \\"Nombre\\""]\n[Black "Dos, \\"Otra\\""]\n[Result "1-0"]\n[BlackElo "1850"]\n\n1. d4 { 1-0 } d5 1-0\n'
		)
		expect(setPgnTags(pgn, { BlackTitle: null })).toBe(pgn)
	})

	it('setPgnResult cambia la cabecera y la marca final, no un resultado dentro de un comentario', () => {
		expect(setPgnResult(pgn, '0-1')).toBe(pgn.replace('[Result "1-0"]', '[Result "0-1"]').replace('d5 1-0\n', 'd5 0-1\n'))
	})
})

describe('rectificaciones en la ingesta', () => {
	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM pairings'),
			db.prepare('DELETE FROM games'),
			db.prepare('DELETE FROM participations'),
			db.prepare('DELETE FROM tournaments'),
			db.prepare('DELETE FROM retiradas'),
			db.prepare('DELETE FROM rectificaciones')
		])
	})

	it('desvincula a quien no es: el participante y sus partidas del torneo, también en el PGN, y no las de otro torneo', async () => {
		await rectify({ fideId: 930001, campo: 'fide_id', valor: null })
		// En otro torneo, ese FIDE ID sí es suyo.
		const otherTournament = { ...tournament, key: 'otro-torneo', name: 'Otro torneo' }
		const other = await upsertTournament(db, otherTournament)
		await replaceParticipations(db, other, players)
		await saveGames(
			db,
			other,
			buildGameRows(parseGames(game(1, A, B)), players, otherTournament),
			'2026-10-01T00:00:00.000Z',
			{ name: 'info64', url: null }
		)
		const id = await read()

		expect(await participant(1)).toMatchObject({ name: A, fideId: null })
		const own = (await games()).filter((g) => g.pgn.includes(`[Event "${tournament.name}"]`))
		expect(own.map(({ wid, bid }) => ({ wid, bid }))).toEqual([
			{ wid: null, bid: 930002 },
			{ wid: 930003, bid: null },
			{ wid: null, bid: 930003 }
		])
		for (const g of own) expect(g.pgn).not.toContain('930001')
		// Su ficha sólo lista la del otro torneo.
		expect(await count('SELECT count(*) AS n FROM games WHERE white_fide_id = 930001 OR black_fide_id = 930001')).toBe(1)
		expect(await count('SELECT count(*) AS n FROM games WHERE tournament_id = ?1 AND white_fide_id = 930001', other)).toBe(1)
		expect(id).not.toBe(other)
	})

	it('sobrevive a la relectura: la fuente vuelve a traer el dato mal y se guarda bien', async () => {
		await rectify({ fideId: 930001, campo: 'fide_id', valor: '930009' })
		await read()
		await read()
		expect(await participant(1)).toMatchObject({ fideId: 930009 })
		const [first] = await games()
		expect(first).toMatchObject({ w: A, wid: 930009 })
		expect(first.pgn).toContain('[WhiteFideId "930009"]')
		expect(await count('SELECT count(*) AS n FROM games WHERE white_fide_id = 930001 OR black_fide_id = 930001')).toBe(0)
	})

	it('corrige el nombre en participantes, partidas, PGN y búsqueda; con el año de un menor, sin él', async () => {
		await rectify({ fideId: 930002, campo: 'nombre', valor: 'Verdadero Nombre, Otra 2015' })
		await read()
		expect(await participant(2)).toMatchObject({ name: 'Verdadero Nombre, Otra', nameNorm: 'verdadero nombre, otra' })
		const [first] = await games()
		expect(first.b).toBe('Verdadero Nombre, Otra')
		expect(first.pgn).toContain('[Black "Verdadero Nombre, Otra"]')
		expect(first.pgn).not.toContain('2015')
		expect(await count(`SELECT count(*) AS n FROM games_fts WHERE games_fts MATCH '"verdadero"'`)).toBe(1)
		expect(await count(`SELECT count(*) AS n FROM games_fts WHERE games_fts MATCH '"dos"'`)).toBe(0)
	})

	it('el ELO y el título, en participantes, partidas y emparejamientos', async () => {
		await rectify({ fideId: 930001, campo: 'elo', valor: '1950' })
		await rectify({ fideId: 930001, campo: 'titulo', valor: null })
		const id = await read()
		await replacePairings(db, id, 4, '2026-09-04 10:00', [
			{ board: 1, white: { startRank: 1, name: 'ignorado', rating: null }, black: { startRank: 2, name: 'ignorado', rating: null } }
		])

		expect(await participant(1)).toMatchObject({ title: null, rating: 1950 })
		const [first, second] = await games()
		expect(first).toMatchObject({ welo: 1950, belo: 1802 })
		expect(second).toMatchObject({ welo: 1803, belo: 1950 })
		expect(first.pgn).toContain('[WhiteElo "1950"]')
		expect(first.pgn).not.toContain('WhiteTitle')
		expect(
			await db.prepare('SELECT white_title AS title, white_rating AS rating, white_fide_id AS fideId FROM pairings').first()
		).toEqual({ title: null, rating: 1950, fideId: 930001 })
	})

	it('el resultado de una ronda, sin tocar las demás', async () => {
		await rectify({ fideId: 930001, ronda: 3, campo: 'resultado', valor: '0-1' })
		await read()
		const [first, , third] = await games()
		expect(first.result).toBe('1/2-1/2')
		expect(third.result).toBe('0-1')
		expect(third.pgn).toContain('[Result "0-1"]')
		expect(third.pgn.trimEnd().endsWith('d5 0-1')).toBe(true)
	})

	it('oculta una partida: se borra y no cuenta; sin la fila, vuelve', async () => {
		const id = await read()
		const row = await rectify({ fideId: 930001, ronda: 2, campo: 'oculta', valor: null })
		await read()
		expect((await games()).map((g) => g.round)).toEqual([1, 3])
		expect(await count('SELECT games_count AS n FROM tournaments WHERE id = ?1', id)).toBe(2)

		await db.prepare('DELETE FROM rectificaciones WHERE id = ?1').bind(row).run()
		await read()
		expect((await games()).map((g) => g.round)).toEqual([1, 2, 3])
	})

	it('por el nombre, sin tildes ni año; la de una ronda gana a la de todo el torneo', async () => {
		// Sin FIDE ID ni participante: la partida lleva el nombre del PGN.
		const pgn = [game(1, A, 'Sin Ficha, Alguno'), game(2, 'Sin Ficha, Alguno', B)].join('\n')
		await rectify({ nombre: 'Sin Fícha, Alguno 1990', campo: 'elo', valor: '1700' })
		await rectify({ nombre: 'Sin Ficha, Alguno', ronda: 2, campo: 'elo', valor: '1750' })
		await read(pgn)
		expect((await games()).map(({ welo, belo }) => ({ welo, belo }))).toEqual([
			{ welo: 1801, belo: 1700 },
			{ welo: 1750, belo: 1802 }
		])
	})

	it('la retirada gana: si el FIDE ID bueno es de un retirado, sale anonimizado', async () => {
		await db.prepare("INSERT INTO retiradas (fide_id, nombre, creada) VALUES (930009, 'Otra Persona, Cualquiera', '2026-10-24')").run()
		await rectify({ fideId: 930001, campo: 'fide_id', valor: '930009' })
		await read()
		expect(await participant(1)).toMatchObject({ name: RETIRED_NAME, fideId: null, title: null })
		const [first] = await games()
		expect(first).toMatchObject({ w: RETIRED_NAME, wid: null })
		expect(first.pgn).not.toContain('930009')
	})

	it('aplicada: la hora al aplicarla; sin cambios si una guarda conserva lo guardado; NULL si la fuente ya no lo trae', async () => {
		const unlink = await rectify({ fideId: 930001, campo: 'fide_id', valor: null })
		const result = await rectify({ fideId: 930001, ronda: 3, campo: 'resultado', valor: '0-1' })
		// Sin partidas: la del torneo no se pone a NULL por eso.
		const noGames = await rectify({ fideId: 930004, campo: 'elo', valor: '1900' })
		for (const id of [unlink, result, noGames]) expect(await applied(id)).toBeNull()

		const id = await read()
		const first = await Promise.all([unlink, result, noGames].map(applied))
		for (const at of first) expect(at).not.toBeNull()

		// La página viene vacía y las partidas, a medias: no se guarda nada.
		await replaceParticipations(db, id, [])
		await saveGames(db, id, [], new Date().toISOString(), { name: 'info64', url: null })
		expect(await Promise.all([unlink, result, noGames].map(applied))).toEqual(first)

		// La fuente lo corrige: ya no le da ese FIDE ID.
		const fixed = players.map((p) => (p.startRank === 1 ? { ...p, fideId: 930011 } : p))
		await read(PGN, fixed)
		expect(await applied(unlink)).toBeNull()
		expect(await applied(result)).toBeNull()
		expect(await applied(noGames)).not.toBeNull()
		expect(await participant(1)).toMatchObject({ fideId: 930011 })
	})

	it('la tabla rechaza filas mal escritas', async () => {
		const bad: Row[] = [
			{ campo: 'fide_id', valor: null },
			{ fideId: 930001, campo: 'oculta', valor: null },
			{ fideId: 930001, campo: 'resultado', valor: '1-0' },
			{ fideId: 930001, ronda: 1, campo: 'resultado', valor: 'gana' },
			{ fideId: 930001, ronda: 1, campo: 'resultado', valor: null },
			{ fideId: 930001, ronda: 1, campo: 'oculta', valor: 'sí' },
			{ fideId: 930001, campo: 'titulo', valor: 'XM' },
			{ fideId: 930001, campo: 'elo', valor: 'mil' },
			{ fideId: 930001, campo: 'fide_id', valor: '93-0001' },
			{ fideId: 930001, campo: 'nombre', valor: null },
			{ fideId: 930001, campo: 'nombre', valor: ' ' },
			{ fideId: 930001, campo: 'ritmo', valor: '90+30' }
		]
		for (const row of bad) await expect(rectify(row), JSON.stringify(row)).rejects.toThrow()

		// Un valor por dato y persona.
		await rectify({ fideId: 930001, campo: 'elo', valor: '1900' })
		await expect(rectify({ fideId: 930001, campo: 'elo', valor: '1950' })).rejects.toThrow()
		await rectify({ fideId: 930001, ronda: 1, campo: 'elo', valor: '1950' })
	})
})
