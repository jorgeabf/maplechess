import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseRoundPage, type TournamentPlayer } from '../../src/ingest/info64/parse'
import { deletePastPairings, replacePairings, replaceParticipations, upsertTournament } from '../../src/ingest/repo'
import {
	getPairedRounds,
	getTopUpcomingPairings,
	getUpcomingGames,
	getUpcomingRound,
	PAIRED_ROUNDS_SQL,
	PAIRINGS_BY_KEY_SQL
} from '../../src/lib/db/pairings'
import { formatRoundTime } from '../../src/lib/format'
import roundHtml from '../fixtures/info64/round.html?raw'

const db = env.DB
const NAME = 'Campeonato Absoluto de Bizkaia 2026'
// Antes de la ronda 2 (sábado 24 a las 16:00).
const BEFORE = '2026-10-20 12:00'

const player = (startRank: number, name: string, fideId: number, rating: number | null = null): TournamentPlayer => ({
	startRank,
	team: null,
	title: null,
	name,
	fed: 'ESP',
	rating,
	fideId
})

async function loadRound(): Promise<number> {
	const id = await upsertTournament(db, {
		source: 'info64',
		key: 'campeonato-absoluto-de-bizkaia-2026',
		type: 'individual',
		name: NAME,
		city: 'Bilbao',
		startDate: '2026-10-17',
		endDate: '2026-11-28',
		timeControl: '90 minutes + 30 seconds per move',
		url: 'https://info64.org/campeonato-absoluto-de-bizkaia-2026',
		syncedAt: '2026-10-18T00:00:00.000Z'
	})
	// Sólo algunos participantes (FIDE ID inventados): los demás se quedan con lo que trae la ronda.
	await replaceParticipations(db, id, [
		{ ...player(1, 'Vusuta Inevabume, Azene', 9000001, 2249), title: 'FM' },
		player(7, 'Barejezi Vobozu, Lura', 9000007, 2063),
		player(4, 'Lamamohof Barejezi, Mahi', 9000004)
	])
	const page = await parseRoundPage(roundHtml)
	await replacePairings(db, id, page!.round, page!.startsAt, page!.pairings)
	return id
}

describe('emparejamientos', () => {
	beforeEach(async () => {
		await db.batch([
			db.prepare('DELETE FROM games'),
			db.prepare('DELETE FROM pairings'),
			db.prepare('DELETE FROM participations'),
			db.prepare('DELETE FROM tournaments'),
			db.prepare('DELETE FROM players')
		])
	})

	it('guarda la ronda con los datos de los participantes por su número inicial', async () => {
		const id = await loadRound()
		const round = await getUpcomingRound(db, id, BEFORE)
		expect(round).toMatchObject({ round: 2, startsAt: '2026-10-24 16:00' })
		expect(round!.pairings).toHaveLength(7)
		expect(round!.pairings[0]).toEqual({
			board: 1,
			white: { name: 'Vusuta Inevabume, Azene', title: 'FM', fideId: 9000001, rating: 2249, hasDossier: 0 },
			black: { name: 'Barejezi Vobozu, Lura', title: null, fideId: 9000007, rating: 2063, hasDossier: 0 }
		})
		// El número 3 no está entre los participantes: nombre y ELO de la página de la ronda.
		expect(round!.pairings[1].black).toEqual({
			name: 'Umal Muro, Zuta Otahec',
			title: null,
			fideId: null,
			rating: 2219,
			hasDossier: 0
		})
	})

	it('deja de mostrar la ronda cuando empieza', async () => {
		const id = await loadRound()
		expect(await getUpcomingRound(db, id, '2026-10-24 16:00')).toBeNull()
		expect(await getUpcomingGames(db, 9000007, '2026-10-24 16:00')).toEqual([])
	})

	it('da las próximas partidas de un jugador con su color y su rival', async () => {
		const id = await loadRound()
		expect(await getUpcomingGames(db, 9000007, BEFORE)).toEqual([
			{
				tournamentId: id,
				tournamentName: NAME,
				round: 2,
				board: 1,
				startsAt: '2026-10-24 16:00',
				color: 'black',
				opponent: { name: 'Vusuta Inevabume, Azene', title: 'FM', fideId: 9000001, rating: 2249, hasDossier: 0 }
			}
		])
		const [game] = await getUpcomingGames(db, 9000004, BEFORE)
		expect(game).toMatchObject({ board: 2, color: 'white', opponent: { name: 'Umal Muro, Zuta Otahec', fideId: null } })
	})

	it('marca qué jugadores tienen dossier (partidas), para enlazar sólo esos', async () => {
		const id = await loadRound()
		// Una partida de la ronda 1 del 1 con negras; su rival no tiene FIDE ID.
		await db
			.prepare(
				`INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_fide_id, black_fide_id,
					result, ply_count, pgn, seen_at)
				VALUES (?1, 1, 1, '2026-10-17', 'Otro, Rival', 'Vusuta Inevabume, Azene', NULL, 9000001, '0-1', 40, '', '2026-10-18')`
			)
			.bind(id)
			.run()
		const round = await getUpcomingRound(db, id, BEFORE)
		expect([round!.pairings[0].white.hasDossier, round!.pairings[0].black.hasDossier]).toEqual([1, 0])
		expect((await getUpcomingGames(db, 9000007, BEFORE))[0].opponent.hasDossier).toBe(1)
		expect((await getUpcomingGames(db, 9000001, BEFORE))[0].opponent.hasDossier).toBe(0)
	})

	it('un posible menor no tiene dossier, aunque tenga partidas', async () => {
		const id = await loadRound()
		// El 1 tiene una partida y nació en 2008: en 2026 puede ser menor; en 2027, ya no.
		await db.batch([
			db.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (9000001, 'Vusuta Inevabume, Azene', 2008, '')"),
			db
				.prepare(
					`INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_fide_id, black_fide_id,
						result, ply_count, pgn, seen_at)
					VALUES (?1, 1, 1, '2026-10-17', 'Otro, Rival', 'Vusuta Inevabume, Azene', NULL, 9000001, '0-1', 40, '', '2026-10-18')`
				)
				.bind(id),
			// La ronda, en 2027, para poder pedirla con una hora de ese año.
			db.prepare("UPDATE pairings SET starts_at = '2027-01-02 10:00'")
		])
		const top = (await getTopUpcomingPairings(db, 8, BEFORE)).find((m) => m.board === 1)
		expect([top?.white.fideId, top?.white.hasDossier]).toEqual([9000001, 0])
		expect((await getUpcomingRound(db, id, BEFORE))!.pairings[0].white.hasDossier).toBe(0)
		expect((await getUpcomingGames(db, 9000007, BEFORE))[0].opponent.hasDossier).toBe(0)
		expect((await getUpcomingGames(db, 9000007, '2027-01-01 10:00'))[0].opponent.hasDossier).toBe(1)
	})

	it('al leer otra vez la ronda sustituye lo guardado', async () => {
		const id = await loadRound()
		await replacePairings(db, id, 3, '2026-10-31 16:00', [])
		expect(await getUpcomingRound(db, id, BEFORE)).toBeNull()
	})

	it('borra los emparejamientos de las rondas ya empezadas', async () => {
		const id = await loadRound()
		await deletePastPairings(db, BEFORE)
		expect((await getUpcomingRound(db, id, BEFORE))?.pairings).toHaveLength(7)
		await deletePastPairings(db, '2026-10-24 16:00')
		const count = await db.prepare('SELECT count(*) AS n FROM pairings').first<{ n: number }>()
		expect(count?.n).toBe(0)
	})

	describe('mesas de más nivel de todos los torneos', () => {
		const OPEN = 'Open de Otoño'

		/** Otro torneo con mesas de más nivel que las de Bizkaia y uno que ya ha empezado la ronda. */
		async function loadOthers(): Promise<number> {
			const tournament = (key: string, name: string) =>
				upsertTournament(db, {
					source: 'info64',
					key,
					type: 'individual',
					name,
					city: null,
					startDate: '2026-10-17',
					endDate: '2026-10-25',
					timeControl: '90+30',
					url: `https://info64.org/${key}`,
					syncedAt: '2026-10-18T00:00:00.000Z'
				})
			const open = await tournament('open-de-otono', OPEN)
			const started = await tournament('ya-empezado', 'Ya empezado')
			// torneo, mesa, hora, ELO de blancas y de negras; la 4 del open tiene un jugador sin ELO
			const boards: [number, number, string, number, number | null][] = [
				[open, 1, '2026-10-24 17:00', 2500, 2500],
				[open, 2, '2026-10-24 17:00', 2450, 2350],
				[open, 3, '2026-10-24 17:00', 2400, 2300],
				[open, 4, '2026-10-24 17:00', 2700, null],
				[started, 1, '2026-10-20 10:00', 2700, 2700]
			]
			await db.batch(
				boards.map(([id, board, startsAt, whiteRating, blackRating]) =>
					db
						.prepare(
							`INSERT INTO pairings (tournament_id, round, board, starts_at, white_rank, white_name, white_fide_id,
								white_rating, black_rank, black_name, black_fide_id, black_rating)
							VALUES (?1, 5, ?2, ?3, ?2, 'Blancas, Una', 9100000 + ?2, ?4, ?2 + 50, 'Negras, Otra', NULL, ?5)`
						)
						.bind(id, board, startsAt, whiteRating, blackRating)
				)
			)
			return open
		}

		const names = (top: { tournamentName: string; board: number }[]) => top.map((m) => `${m.tournamentName} ${m.board}`)

		it('de más a menos ELO medio, como mucho dos por torneo, sin las empezadas ni las que no tienen ELO', async () => {
			await loadRound()
			await loadOthers()
			expect(names(await getTopUpcomingPairings(db, 8, BEFORE))).toEqual([`${OPEN} 1`, `${OPEN} 2`, `${NAME} 2`, `${NAME} 1`])
			expect(names(await getTopUpcomingPairings(db, 3, BEFORE))).toEqual([`${OPEN} 1`, `${OPEN} 2`, `${NAME} 2`])
		})

		it('da el torneo, la ronda, la hora y los jugadores, y quién tiene partidas', async () => {
			const open = await loadOthers()
			await db
				.prepare(
					`INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_fide_id, black_fide_id,
						result, ply_count, pgn, seen_at)
					VALUES (?1, 4, 1, '2026-10-23', 'Rival, Otro', 'Blancas, Una', NULL, 9100001, '1/2-1/2', 40, '', '2026-10-23')`
				)
				.bind(open)
				.run()
			const [first] = await getTopUpcomingPairings(db, 8, BEFORE)
			expect(first).toEqual({
				tournamentId: open,
				tournamentName: OPEN,
				round: 5,
				startsAt: '2026-10-24 17:00',
				board: 1,
				white: { name: 'Blancas, Una', title: null, fideId: 9100001, rating: 2500, hasDossier: 1 },
				black: { name: 'Negras, Otra', title: null, fideId: null, rating: 2500, hasDossier: 0 }
			})
		})

		it('sin rondas por empezar, ninguna', async () => {
			await loadOthers()
			expect(await getTopUpcomingPairings(db, 8, '2026-10-24 17:00')).toEqual([])
		})

		it('lee las elegidas por la clave primaria', async () => {
			const { results } = await db
				.prepare(`EXPLAIN QUERY PLAN ${PAIRINGS_BY_KEY_SQL}`)
				.bind('[[1,2]]', 2008)
				.all<{ detail: string }>()
			expect(results.map((r) => r.detail).join(' | ')).toContain('PRIMARY KEY (tournament_id=? AND board=?)')
		})
	})

	describe('próxima ronda de cada torneo, sin los jugadores', () => {
		/** Un open de info64 con tres mesas antes que Bizkaia, uno ya empezado y uno de lichess. */
		async function loadOthers(): Promise<void> {
			const tournament = (source: string, key: string) =>
				upsertTournament(db, {
					source,
					key,
					type: 'individual',
					name: key,
					city: null,
					startDate: '2026-10-17',
					endDate: '2026-10-25',
					timeControl: null,
					url: `https://${source}.org/${key}`,
					syncedAt: '2026-10-18T00:00:00.000Z'
				})
			const open = await tournament('info64', 'open-de-otono')
			const started = await tournament('info64', 'ya-empezado')
			const lichess = await tournament('lichess', 'zK5CoVvF')
			const boards: [number, number, string][] = [
				[open, 1, '2026-10-22 17:00'],
				[open, 2, '2026-10-22 17:00'],
				[open, 3, '2026-10-22 17:00'],
				[started, 1, '2026-10-20 10:00'],
				[lichess, 1, '2026-10-22 17:00']
			]
			await db.batch(
				boards.map(([id, board, startsAt]) =>
					db
						.prepare(
							`INSERT INTO pairings (tournament_id, round, board, starts_at, white_rank, white_name, black_rank, black_name)
							VALUES (?1, 5, ?2, ?3, ?2, 'Blancas, Una', ?2 + 50, 'Negras, Otra')`
						)
						.bind(id, board, startsAt)
				)
			)
		}

		it('una por torneo de info64, con su ronda, su hora y sus mesas, por hora; sin las empezadas', async () => {
			await loadRound()
			await loadOthers()
			expect(await getPairedRounds(db, BEFORE)).toEqual([
				{ slug: 'open-de-otono', round: 5, startsAt: '2026-10-22 17:00', boards: 3 },
				{ slug: 'campeonato-absoluto-de-bizkaia-2026', round: 2, startsAt: '2026-10-24 16:00', boards: 7 }
			])
			expect(await getPairedRounds(db, '2026-10-22 17:00')).toEqual([
				{ slug: 'campeonato-absoluto-de-bizkaia-2026', round: 2, startsAt: '2026-10-24 16:00', boards: 7 }
			])
			expect(await getPairedRounds(db, '2026-10-24 16:00')).toEqual([])
		})

		it('recorre pairings y busca cada torneo por su clave primaria', async () => {
			const { results } = await db.prepare(`EXPLAIN QUERY PLAN ${PAIRED_ROUNDS_SQL}`).bind(BEFORE).all<{ detail: string }>()
			const plan = results.map((r) => r.detail)
			expect(plan).toContain('SCAN pairings')
			expect(plan).toContain('SEARCH t USING INTEGER PRIMARY KEY (rowid=?)')
		})
	})
})

describe('formatRoundTime', () => {
	it('da el día de la semana, la fecha y la hora', () => {
		expect(formatRoundTime('2026-10-24 16:00')).toBe('sáb, 24 oct, 16:00')
	})
})
