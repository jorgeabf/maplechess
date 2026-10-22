import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FidePlayer } from '../../src/ingest/fide/parse'
import { buildGameRows } from '../../src/ingest/games'
import type { TournamentPlayer } from '../../src/ingest/info64/parse'
import { anonymizePgn, isRetired, RETIRED_NAME, retiredKey } from '../../src/ingest/nombres'
import {
	replacePairings,
	replaceParticipations,
	saveGames,
	upsertFidePlayers,
	upsertTournament,
	type TournamentInput
} from '../../src/ingest/repo'
import { applyRetired } from '../../src/ingest/reprocess'
import { parseGames } from '../../src/lib/chess/pgn'
import { getPlayer } from '../../src/lib/db/players'

// Retirada de datos (tabla retiradas): anonimizar al escribir y en lo guardado.
// Nombres inventados.
const db = env.DB
const RETIRED = { fideId: 930003, name: 'Supuesto Irreal, Otro 1980' }

const tournament: TournamentInput = {
	source: 'info64',
	key: 'torneo-retiradas',
	type: 'individual',
	name: 'Torneo de las retiradas',
	city: 'Ninguna',
	startDate: '2026-09-01',
	endDate: '2026-09-02',
	timeControl: '90+30',
	url: 'https://info64.org/torneo-retiradas',
	syncedAt: '2026-10-01T00:00:00.000Z'
}

const player = (startRank: number, name: string, fideId: number | null): TournamentPlayer => ({
	startRank,
	team: null,
	title: startRank === 3 ? 'FM' : null,
	name,
	fed: 'ESP',
	rating: 1800 + startRank,
	fideId
})
const players = [
	player(1, 'Rival Uno, Alguien', 930001),
	player(2, 'Rival Dos, Otra', 930002),
	player(3, RETIRED.name, RETIRED.fideId)
]

/** Partida como las de info64: los nombres del ranking, sin FIDE ID. */
const game = (board: number, white: string, black: string) =>
	`[Event "Torneo"]\n[Round "1.${board}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "1/2-1/2"]\n\n1. d4 d5 1/2-1/2\n`

const count = async (sql: string, ...params: unknown[]) =>
	(await db
		.prepare(sql)
		.bind(...params)
		.first<{ n: number }>())!.n

const retire = () =>
	db
		.prepare("INSERT INTO retiradas (fide_id, nombre, creada) VALUES (?1, ?2, '2026-10-22')")
		.bind(RETIRED.fideId, RETIRED.name)
		.run()

describe('anonimizar a un retirado', () => {
	it('anonymizePgn cambia su nombre y quita su FIDE ID y su título, y nada más', () => {
		const pgn = [
			'[Event "Torneo"]',
			'[White "Rival Uno, Alguien"]',
			`[Black "${RETIRED.name}"]`,
			'[WhiteFideId "930001"]',
			'[BlackFideId "930003"]',
			'[BlackTitle "FM"]',
			'[BlackElo "1803"]',
			'',
			'1. d4 d5 1/2-1/2',
			''
		].join('\n')
		expect(anonymizePgn(pgn, 'Black')).toBe(
			[
				'[Event "Torneo"]',
				'[White "Rival Uno, Alguien"]',
				`[Black "${RETIRED_NAME}"]`,
				'[WhiteFideId "930001"]',
				'[BlackElo "1803"]',
				'',
				'1. d4 d5 1/2-1/2',
				''
			].join('\n')
		)
	})

	it('isRetired va por el FIDE ID y, sin él, por el nombre', () => {
		const retired = { ids: new Set([RETIRED.fideId]), names: new Set([retiredKey(RETIRED.name)]) }
		expect(isRetired(retired, RETIRED.fideId, 'Otro nombre')).toBe(true)
		// Un homónimo con otro FIDE ID es otra persona.
		expect(isRetired(retired, 999, RETIRED.name)).toBe(false)
		// Sin FIDE ID, por el nombre, con año o sin él y sin tildes.
		expect(isRetired(retired, null, 'Supuesto Irreal, Otro')).toBe(true)
		expect(isRetired(retired, null, 'Supuésto Irreal,Otro 1980')).toBe(true)
		expect(isRetired(retired, null, 'Rival Uno, Alguien')).toBe(false)
	})
})

describe('retiradas en la ingesta', () => {
	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM pairings'),
			db.prepare('DELETE FROM games'),
			db.prepare('DELETE FROM participations'),
			db.prepare('DELETE FROM tournaments'),
			db.prepare('DELETE FROM players'),
			db.prepare('DELETE FROM retiradas')
		])
	})

	it('anonimiza al retirado en participantes, partidas y emparejamientos; sus rivales siguen', async () => {
		await retire()
		const id = await upsertTournament(db, tournament)
		await replaceParticipations(db, id, players)
		// Se cruza con los participantes de la fuente, con su nombre real.
		const pgn = [game(1, players[0].name, RETIRED.name), game(2, players[1].name, players[0].name)].join('\n')
		await saveGames(db, id, buildGameRows(parseGames(pgn), players, tournament), '2026-10-01T00:00:00.000Z', {
			name: 'info64',
			url: null
		})
		const side = (startRank: number, name: string) => ({ startRank, name, rating: null })
		await replacePairings(db, id, 2, '2026-09-02 10:00', [
			{ board: 1, white: side(3, 'ignorado'), black: side(2, 'ignorado') },
			// Sin participante con ese número: el nombre de la página, también por nombre.
			{ board: 2, white: side(9, 'Supuesto Irreal, Otro'), black: side(1, 'ignorado') }
		])

		const participations = await db
			.prepare('SELECT name, fide_id AS fideId, title FROM participations ORDER BY start_rank')
			.all()
		expect(participations.results).toEqual([
			{ name: 'Rival Uno, Alguien', fideId: 930001, title: null },
			{ name: 'Rival Dos, Otra', fideId: 930002, title: null },
			{ name: RETIRED_NAME, fideId: null, title: null }
		])
		const games = await db.prepare('SELECT white_name AS w, black_name AS b, black_fide_id AS bid, pgn FROM games ORDER BY board').all<{
			w: string
			b: string
			bid: number | null
			pgn: string
		}>()
		expect(games.results.map(({ w, b, bid }) => ({ w, b, bid }))).toEqual([
			{ w: 'Rival Uno, Alguien', b: RETIRED_NAME, bid: null },
			{ w: 'Rival Dos, Otra', b: 'Rival Uno, Alguien', bid: 930001 }
		])
		expect(games.results[0].pgn).toContain(`[Black "${RETIRED_NAME}"]`)
		expect(games.results[0].pgn).not.toContain('930003')
		expect(games.results[0].pgn).not.toContain('Irreal')
		expect(await db.prepare('SELECT white_name AS w, white_fide_id AS wid FROM pairings ORDER BY board').all()).toMatchObject({
			results: [
				{ w: RETIRED_NAME, wid: null },
				{ w: RETIRED_NAME, wid: null }
			]
		})
	})

	it('anonimiza por el nombre las partidas que la fuente da sin FIDE ID ni participante', async () => {
		await retire()
		const id = await upsertTournament(db, tournament)
		const rows = buildGameRows(parseGames(game(1, 'Supuesto Irreal, Otro', 'Rival Uno, Alguien')), [], tournament)
		await saveGames(db, id, rows, '2026-10-01T00:00:00.000Z', { name: 'info64', url: null })
		expect(await count('SELECT count(*) AS n FROM games WHERE white_name = ?1', RETIRED_NAME)).toBe(1)
	})

	it('la lista FIDE no importa a los retirados: sin ficha', async () => {
		await retire()
		const fide = (fideId: number, name: string): FidePlayer => ({
			fideId,
			name,
			fed: 'ESP',
			sex: 'M',
			title: null,
			birthYear: 1980,
			ratingStd: 1800,
			ratingRapid: null,
			ratingBlitz: null,
			inactive: false
		})
		await upsertFidePlayers(db, [fide(930001, 'Rival Uno, Alguien'), fide(RETIRED.fideId, RETIRED.name)], '2026-10', '2026-10-03T06:00:00.000Z')
		expect(await count('SELECT count(*) AS n FROM players')).toBe(1)
		expect(await getPlayer(db, RETIRED.fideId)).toBeNull()
	})

	it('el reprocesado lo aplica a lo guardado antes, y repetirlo no cambia nada', async () => {
		// Todo guardado antes de la retirada, con el nombre y el FIDE ID.
		const id = await upsertTournament(db, tournament)
		await replaceParticipations(db, id, players)
		const pgn = [
			game(1, players[0].name, RETIRED.name),
			// En otra fuente, sin FIDE ID: sólo por el nombre.
			game(2, 'Supuesto Irreal, Otro', players[1].name)
		].join('\n')
		await saveGames(db, id, buildGameRows(parseGames(pgn), players.slice(0, 2).concat(players[2]), tournament), '2026-10-01T00:00:00.000Z', {
			name: 'info64',
			url: null
		})
		await db.prepare('UPDATE games SET white_fide_id = NULL WHERE board = 2').run()
		await db
			.prepare("INSERT INTO players (fide_id, name, seen_at) VALUES (?1, ?2, '2026-10-01')")
			.bind(RETIRED.fideId, RETIRED.name)
			.run()
		const side = (startRank: number) => ({ startRank, name: 'ignorado', rating: null })
		await replacePairings(db, id, 2, '2026-09-02 10:00', [{ board: 1, white: side(3), black: side(1) }])
		expect(await getPlayer(db, RETIRED.fideId)).not.toBeNull()

		await retire()
		expect(await applyRetired(db)).toEqual({ players: 1, participations: 1, games: 2, pairings: 1 })
		expect(await getPlayer(db, RETIRED.fideId)).toBeNull()
		expect(await count('SELECT count(*) AS n FROM games WHERE pgn LIKE ?1 OR pgn LIKE ?2', '%Irreal%', '%930003%')).toBe(0)
		expect(await count('SELECT count(*) AS n FROM participations WHERE name = ?1 AND fide_id IS NULL', RETIRED_NAME)).toBe(1)
		expect(await count('SELECT count(*) AS n FROM pairings WHERE white_name = ?1 AND white_fide_id IS NULL', RETIRED_NAME)).toBe(1)
		// El FTS sigue a los nombres: ya no se le encuentra.
		expect(await count(`SELECT count(*) AS n FROM games_fts WHERE games_fts MATCH '"irreal"'`)).toBe(0)
		// Sus rivales siguen con su nombre y su FIDE ID.
		expect(await count('SELECT count(*) AS n FROM games WHERE black_fide_id = 930002 OR white_fide_id = 930001')).toBe(2)

		expect(await applyRetired(db)).toEqual({ players: 0, participations: 0, games: 0, pairings: 0 })
	})
})
