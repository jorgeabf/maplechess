import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { replaceParticipations, upsertTournament } from '../../src/ingest/repo'
import { importTournament, loadTarget, type StoredTournament } from '../../src/ingest/sichess/sync'
import { SICHESS_TOURNAMENTS, type SichessTournament } from '../../src/ingest/sichess/torneos'
import { isListedMinors, isMinorsTournament } from '../../src/ingest/menores'
import { RETIRED_NAME } from '../../src/ingest/nombres'
import { LISTED_COPIES } from '../../src/ingest/repetidos'
import { normalizeName } from '../../src/lib/chess/names'
import { LICHESS_NOTICE, licensedPgn, lichessUrl } from '../../src/lib/licenses'
import { sourceUrl } from '../../src/lib/urls'

const db = env.DB
const NOW = '2026-11-06T22:00:00.000Z'
const KEY = 'ce-torneo-inventado-2023'
const ENTRY: SichessTournament = {
	key: KEY,
	viewer: 'https://sichess.com/feda/inventado2023/',
	files: ['https://sichess.com/feda/inventado/01/games.pgn']
}

/** Una partida con la forma de los PGN de SICHESS (nombres inventados). */
const game = (round: string, white: string, black: string, moves = '1. e4 e5 2. Nf3 1-0', extra = ''): string =>
	`[Event "CE_INVENTADO"]\n[Site "?"]\n[Date "2023.10.13"]\n[Round "${round}"]\n[White "${white}"]\n[Black "${black}"]\n[Result "1-0"]\n[WhiteElo "0"]\n${extra}\n${moves}\n\n`

const WHITE = 'Irreal Lejano,Supuesto'
const BLACK = 'Inventado Falso,Otro'

async function store(key = KEY, name = 'CE Torneo Inventado 2023'): Promise<number> {
	const id = await upsertTournament(db, {
		source: 'info64',
		key,
		type: 'individual',
		name,
		city: 'Ciudad Inventada',
		startDate: '2023-10-13',
		endDate: '2023-10-21',
		timeControl: "90'+30''",
		url: `https://info64.org/${key}`,
		syncedAt: NOW
	})
	await replaceParticipations(db, id, [
		{ name: 'Irreal Lejano, Supuesto', fideId: 900001, title: 'IM', rating: 2400, fed: 'ESP', team: '', startRank: 1 },
		{ name: 'Inventado Falso, Otro', fideId: 900002, title: null, rating: 2300, fed: 'ESP', team: '', startRank: 2 }
	])
	return id
}

const target = async (key = KEY): Promise<StoredTournament> => (await loadTarget(db, key))!

const storedGames = () =>
	db
		.prepare(
			`SELECT g.round, g.board, g.white_name AS white, g.black_name AS black, g.white_fide_id AS whiteFide,
				g.black_fide_id AS blackFide, g.white_elo AS whiteElo, g.pgn
			FROM games g ORDER BY g.round, g.board`
		)
		.all<{ round: number; board: number; white: string; black: string; whiteFide: number; blackFide: number; whiteElo: number; pgn: string }>()

const tournamentRow = (id: number) =>
	db
		.prepare(
			`SELECT games_count AS gamesCount, games_source AS gamesSource, games_source_url AS url, lichess_games AS lichessGames
			FROM tournaments WHERE id = ?1`
		)
		.bind(id)
		.first()

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM torneos_sensibles')
	])
})

describe('la lista de SICHESS', () => {
	it('son los 14 torneos medidos, sin repetir clave ni archivo', () => {
		expect(SICHESS_TOURNAMENTS).toHaveLength(14)
		expect(new Set(SICHESS_TOURNAMENTS.map((t) => t.key)).size).toBe(14)
		const files = SICHESS_TOURNAMENTS.flatMap((t) => t.files)
		expect(files).toHaveLength(183)
		expect(new Set(files).size).toBe(183)
	})

	it('todo es de SICHESS y el visor se puede enlazar', () => {
		for (const t of SICHESS_TOURNAMENTS) {
			expect(sourceUrl(t.viewer), t.key).toBe(t.viewer)
			for (const file of t.files) {
				expect(sourceUrl(file), file).toBe(file)
				expect(file).toMatch(/\/\d\d\/games\d?\.pgn$/)
			}
		}
	})

	it('ninguno es de menores por su clave o por la lista', () => {
		for (const t of SICHESS_TOURNAMENTS) {
			expect(isMinorsTournament(t.key), t.key).toBe(false)
			expect(isListedMinors('info64', t.key), t.key).toBe(false)
		}
	})
})

describe('loadTarget', () => {
	it('sólo devuelve un torneo guardado y sin partidas de otra fuente', async () => {
		expect(await loadTarget(db, KEY)).toBeNull()
		const id = await store()
		expect(await target()).toMatchObject({ id, name: 'CE Torneo Inventado 2023', startDate: '2023-10-13' })

		await db.prepare("UPDATE tournaments SET games_count = 90, games_source = 'info64' WHERE id = ?1").bind(id).run()
		expect(await loadTarget(db, KEY)).toBeNull()
		await db.prepare("UPDATE tournaments SET games_count = 90, games_source = 'lichess' WHERE id = ?1").bind(id).run()
		expect(await loadTarget(db, KEY)).toBeNull()
		await db.prepare("UPDATE tournaments SET games_count = 90, games_source = 'sichess' WHERE id = ?1").bind(id).run()
		expect(await loadTarget(db, KEY)).not.toBeNull()
	})

	it('no devuelve un torneo sensible ni uno de menores', async () => {
		await store()
		await db
			.prepare("INSERT INTO torneos_sensibles (source, source_key, nombre, excluido, creado) VALUES ('info64', ?1, 'x', 1, '2026-11-06')")
			.bind(KEY)
			.run()
		expect(await loadTarget(db, KEY)).toBeNull()

		await store('ce-sub-12-inventado-2023', 'CE Sub 12 Inventado 2023')
		expect(await loadTarget(db, 'ce-sub-12-inventado-2023')).toBeNull()
	})

	it('no devuelve un torneo repetido', async () => {
		await store(LISTED_COPIES[0])
		expect(await loadTarget(db, LISTED_COPIES[0])).toBeNull()
	})

	it('no devuelve un torneo con un jugador retirado ni uno sin participantes', async () => {
		const id = await store()
		await db
			.prepare('UPDATE participations SET name = ?1, name_norm = ?2, fide_id = NULL WHERE tournament_id = ?3 AND start_rank = 2')
			.bind(RETIRED_NAME, normalizeName(RETIRED_NAME), id)
			.run()
		expect(await loadTarget(db, KEY)).toBeNull()

		await db.prepare('DELETE FROM participations').run()
		expect(await loadTarget(db, KEY)).toBeNull()
	})
})

describe('importTournament', () => {
	it('guarda las partidas en el torneo de info64, cruzadas con sus participantes', async () => {
		const id = await store()
		const summary = await importTournament(db, await target(), ENTRY, [game('1.1', WHITE, BLACK)], NOW)
		expect(summary).toEqual({ tournaments: 1, games: 1, identified: 2, illegal: 0, skipped: 0, avisos: 0 })
		expect(await tournamentRow(id)).toEqual({ gamesCount: 1, gamesSource: 'sichess', url: ENTRY.viewer, lichessGames: 0 })

		const [row] = (await storedGames()).results
		expect(row).toMatchObject({
			round: 1,
			board: 1,
			white: 'Irreal Lejano, Supuesto',
			black: 'Inventado Falso, Otro',
			whiteFide: 900001,
			blackFide: 900002,
			whiteElo: 2400
		})
		expect(row.pgn).toContain('[Event "CE Torneo Inventado 2023"]')
		expect(row.pgn).toContain('[Site "Ciudad Inventada"]')
		expect(row.pgn).toContain(`[Source "${ENTRY.viewer}"]`)
		// Sin licencia que citar: el PGN se entrega tal cual.
		expect(licensedPgn(row.pgn)).toBe(row.pgn)
	})

	it('no toca los participantes', async () => {
		const id = await store()
		const rows = async () =>
			(await db.prepare('SELECT * FROM participations WHERE tournament_id = ?1 ORDER BY start_rank').bind(id).all()).results
		const before = await rows()
		expect(before).toHaveLength(2)
		await importTournament(db, await target(), ENTRY, [game('1.1', WHITE, BLACK)], NOW)
		expect(await rows()).toEqual(before)
	})

	it('sin las que no tienen jugadas ni las que no son de sus participantes', async () => {
		await store()
		const texts = [
			game('1.1', WHITE, BLACK),
			game('1.2', WHITE, BLACK, '1-0'),
			game('1.3', 'Ajeno Del Todo,Nombre', 'Otro Ajeno,Nombre'),
			// Una partida suelta sin cabeceras, como la de la 1.ª de 2024.
			'1. d4 d5 2. c4 *\n\n'
		]
		const summary = await importTournament(db, await target(), ENTRY, [texts.join('')], NOW)
		expect(summary.games).toBe(1)
		expect((await storedGames()).results.map((r) => r.board)).toEqual([1])
	})

	it('lee las partidas que vienen sin Event, como en los de equipos', async () => {
		await store()
		const sinEvent = game('1.2', BLACK, WHITE).replace('[Event "CE_INVENTADO"]\n', '')
		const summary = await importTournament(db, await target(), ENTRY, [game('1.1', WHITE, BLACK) + sinEvent], NOW)
		expect(summary.games).toBe(2)
	})

	it('junta las partidas de todos los archivos', async () => {
		await store()
		const summary = await importTournament(db, await target(), ENTRY, [game('1.1', WHITE, BLACK), game('2.1', BLACK, WHITE)], NOW)
		expect(summary.games).toBe(2)
		expect((await storedGames()).results.map((r) => r.round)).toEqual([1, 2])
	})

	describe('la fecha de cada partida', () => {
		const dates = async () =>
			(await db.prepare('SELECT round, date, pgn FROM games ORDER BY round, board').all<{ round: number; date: string; pgn: string }>()).results

		const AJENO = 'Ajeno Del Todo,Nombre'
		const utc = (day: string) => `[UTCDate "${day}"]`

		it('es la más repetida de su ronda, también en el PGN', async () => {
			await store()
			const onDay = (text: string, day: string) => text.replace('2023.10.13', day)
			const texts = [
				// La ronda 1, en el primer día: la 2, que se queda en él, sigue a las demás de su ronda.
				game('1.1', WHITE, BLACK),
				game('2.1', WHITE, BLACK),
				onDay(game('2.2', BLACK, WHITE), '2023.10.14'),
				onDay(game('2.3', WHITE, AJENO), '2023.10.14')
			]
			await importTournament(db, await target(), ENTRY, [texts.join('')], NOW)
			const rows = await dates()
			expect(rows.map((r) => [r.round, r.date])).toEqual([
				[1, '2023-10-13'],
				[2, '2023-10-14'],
				[2, '2023-10-14'],
				[2, '2023-10-14']
			])
			expect(rows[1].pgn).toContain('[Date "2023.10.14"]')
		})

		it('con UTCDate, aunque Date diga lo mismo en todas y alguna UTCDate falle', async () => {
			await store()
			const texts = [
				game('1.1', WHITE, BLACK, undefined, utc('2023.10.13')),
				game('2.1', WHITE, BLACK, undefined, utc('2023.10.14')),
				game('2.2', BLACK, WHITE, undefined, utc('2023.10.14')),
				game('2.3', WHITE, AJENO, undefined, utc('2023.10.08'))
			]
			await importTournament(db, await target(), ENTRY, [texts.join('')], NOW)
			expect((await dates()).map((r) => r.date)).toEqual(['2023-10-13', '2023-10-14', '2023-10-14', '2023-10-14'])
		})

		it('a igual número, la primera; sin ninguna, el principio del torneo', async () => {
			await store()
			const texts = [
				game('1.1', WHITE, BLACK).replace('2023.10.13', '2023.10.15'),
				game('1.2', BLACK, WHITE).replace('2023.10.13', '2023.10.14'),
				game('2.1', WHITE, BLACK).replace('2023.10.13', '????.??.??')
			]
			await importTournament(db, await target(), ENTRY, [texts.join('')], NOW)
			expect((await dates()).map((r) => r.date)).toEqual(['2023-10-14', '2023-10-14', '2023-10-13'])
		})
	})

	it('no guarda nada si un PGN no se lee entero', async () => {
		const id = await store()
		const cortado = game('1.1', WHITE, BLACK, '1. e4 { sin cerrar e5 2. Nf3 1-0') + game('1.2', BLACK, WHITE)
		const summary = await importTournament(db, await target(), ENTRY, [game('1.1', WHITE, BLACK), cortado], NOW)
		expect(summary).toMatchObject({ tournaments: 0, games: 0, avisos: 1 })
		expect(await tournamentRow(id)).toMatchObject({ gamesCount: 0, gamesSource: null })
	})

	it('sin partidas de sus participantes, no guarda nada y avisa', async () => {
		const id = await store()
		const summary = await importTournament(db, await target(), ENTRY, [game('1.1', 'Ajeno,Uno', 'Ajeno,Dos')], NOW)
		expect(summary).toMatchObject({ tournaments: 0, games: 0, avisos: 1 })
		expect(await tournamentRow(id)).toMatchObject({ gamesCount: 0, gamesSource: null })
	})

	it('las exportadas de lichess llevan su aviso de licencia', async () => {
		const id = await store()
		const url = 'https://lichess.org/broadcast/inventado/round-1/abcd1234/efgh5678'
		const exported = game('1.1', WHITE, BLACK, undefined, `[GameURL "${url}"]`)
		await importTournament(db, await target(), ENTRY, [exported], NOW)
		expect(await tournamentRow(id)).toMatchObject({ gamesSource: 'sichess', lichessGames: 1 })
		const [row] = (await storedGames()).results
		expect(lichessUrl(row.pgn)).toBe(url)
		expect(licensedPgn(row.pgn)).toContain(`{ ${LICHESS_NOTICE} }`)
	})

	// Sólo los id: el resultado entero de D1 lleva también lo que ha tardado la consulta.
	const gameIds = async () => (await db.prepare('SELECT id FROM games ORDER BY id').all<{ id: number }>()).results.map((r) => r.id)

	it('relanzarla no duplica nada y conserva los id', async () => {
		await store()
		await importTournament(db, await target(), ENTRY, [game('1.1', WHITE, BLACK)], NOW)
		const before = await gameIds()
		await importTournament(db, await target(), ENTRY, [game('1.1', WHITE, BLACK)], '2026-11-06T23:00:00.000Z')
		expect(await gameIds()).toEqual(before)
	})
})
