import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StandingsPage, TournamentPlayer } from '../../src/ingest/info64/parse'
import { RETIRED_NAME } from '../../src/ingest/nombres'
import { replaceParticipations, replaceStandings, upsertTournament } from '../../src/ingest/repo'
import { getTournamentStandings, standingProgress, standingsHeading, standingsOver } from '../../src/lib/db/standings'

const db = env.DB

const tournament = (key: string, type: 'individual' | 'team') =>
	upsertTournament(db, {
		source: 'info64',
		key,
		type,
		name: key,
		city: null,
		startDate: '2026-09-01',
		endDate: '2026-09-07',
		timeControl: null,
		url: `https://info64.org/${key}`,
		syncedAt: '2026-10-01T00:00:00.000Z'
	})

const player = (startRank: number, name: string, fideId: number): TournamentPlayer => ({
	startRank,
	team: null,
	title: startRank === 1 ? 'FM' : null,
	name,
	fed: 'ESP',
	rating: 2100 - startRank,
	fideId
})

const page = (rows: [pos: number, startRank: number, points: number][]): StandingsPage => ({
	round: 4,
	rounds: 7,
	tiebreaks: ['BH', 'WON'],
	rows: rows.map(([pos, startRank, points]) => ({ pos, startRank, name: `Fuente ${startRank}`, points, tiebreaks: [points * 3, null], rating: 1 }))
})

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM standings'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM players'),
		db.prepare('DELETE FROM retiradas')
	])
})

describe('getTournamentStandings', () => {
	it('da cada jugador con sus datos de participante, en el orden de la clasificación', async () => {
		const id = await tournament('open-de-prueba', 'individual')
		await db
			.prepare("INSERT INTO retiradas (fide_id, nombre, creada) VALUES (9400003, 'Retirada Inventada, Alguien', '2026-10-22')")
			.run()
		await replaceParticipations(db, id, [
			player(1, 'Primero Inventado, Uno', 9400001),
			// Menor con homónimo en la lista FIDE: el año no sale.
			player(2, 'Segundo Inventado, Dos 2013', 9400002),
			player(3, 'Retirada Inventada, Alguien', 9400003)
		])
		// Una partida del primero y otra del segundo, en cualquier torneo. El
		// primero tiene dossier; el segundo nació en 2013, puede ser menor y no lo tiene.
		await db.batch([
			db.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (9400002, 'Segundo Inventado, Dos 2013', 2013, '')"),
			...[9400001, 9400002].map((fideId, i) =>
				db
					.prepare(
						`INSERT INTO games (tournament_id, round, board, white_name, black_name, white_fide_id, result, ply_count, pgn, seen_at)
						VALUES (?1, 1, ?2, 'Inventado', 'Otro, Alguien', ?3, '1-0', 10, '', '2026-10-01')`
					)
					.bind(id, i + 1, fideId)
			)
		])
		await replaceStandings(
			db,
			id,
			'individual',
			page([
				[1, 2, 3.5],
				[2, 1, 3],
				[3, 3, 0.5]
			])
		)

		const standings = await getTournamentStandings(db, id, 'individual', 2026)
		expect(standings).toMatchObject({ round: 4, rounds: 7, tiebreaks: ['BH', 'WON'] })
		expect(standings!.rows).toEqual([
			{
				pos: 1,
				startRank: 2,
				points: 3.5,
				tiebreaks: [10.5, null],
				name: 'Segundo Inventado, Dos',
				rating: 2098,
				fideId: 9400002,
				title: null,
				fed: 'ESP',
				hasDossier: 0
			},
			expect.objectContaining({ pos: 2, name: 'Primero Inventado, Uno', title: 'FM', fideId: 9400001, hasDossier: 1 }),
			expect.objectContaining({ pos: 3, name: RETIRED_NAME, fideId: null, title: null, hasDossier: 0 })
		])
	})

	it('en los de equipos da el nombre y el ELO medio de cada equipo', async () => {
		const id = await tournament('team/liga-de-prueba', 'team')
		await replaceStandings(db, id, 'team', {
			round: null,
			rounds: 3,
			tiebreaks: ['MatPnt'],
			rows: [{ pos: 1, startRank: 2, name: 'Club Inventado', points: 5, tiebreaks: [5], rating: 2050 }]
		})
		expect(await getTournamentStandings(db, id, 'team')).toEqual({
			round: null,
			rounds: 3,
			tiebreaks: ['MatPnt'],
			rows: [
				{
					pos: 1,
					startRank: 2,
					points: 5,
					tiebreaks: [5],
					name: 'Club Inventado',
					rating: 2050,
					fideId: null,
					title: null,
					fed: null,
					hasDossier: 0
				}
			]
		})
	})

	it('sin clasificación guardada, null', async () => {
		const id = await tournament('sin-clasificacion', 'individual')
		expect(await getTournamentStandings(db, id, 'individual')).toBeNull()
	})
})

describe('standingsHeading', () => {
	const today = '2026-10-23'

	it('final tras la última ronda; si no, la de la última jugada', () => {
		expect(standingsHeading({ round: 9, rounds: 9 }, '2026-10-20', today)).toBe('Clasificación final')
		expect(standingsHeading({ round: 4, rounds: 9 }, '2026-10-30', today)).toBe('Clasificación tras la ronda 4')
		// Acabado, pero sin los resultados de la última ronda: no es la final.
		expect(standingsHeading({ round: 8, rounds: 9 }, '2026-10-01', today)).toBe('Clasificación tras la ronda 8')
	})

	it('sin ronda (por equipos) o sin rondas, final cuando ha terminado', () => {
		expect(standingsHeading({ round: null, rounds: 7 }, '2026-10-22', today)).toBe('Clasificación final')
		expect(standingsHeading({ round: null, rounds: 7 }, today, today)).toBe('Clasificación')
		expect(standingsHeading({ round: null, rounds: null }, null, today)).toBe('Clasificación')
		expect(standingsHeading({ round: 5, rounds: null }, '2026-10-01', today)).toBe('Clasificación final')
		expect(standingsHeading({ round: 5, rounds: null }, '2026-10-30', today)).toBe('Clasificación tras la ronda 5')
	})
})

describe('standingsOver', () => {
	const today = '2026-10-23'

	it('la regla del título: tras la última ronda o, sin ronda o sin rondas, cuando el torneo ha terminado', () => {
		expect(standingsOver({ round: 9, rounds: 9 }, '2026-10-30', today)).toBe(true)
		expect(standingsOver({ round: 8, rounds: 9 }, '2026-10-01', today)).toBe(false)
		expect(standingsOver({ round: null, rounds: 7 }, '2026-10-22', today)).toBe(true)
		expect(standingsOver({ round: null, rounds: 7 }, today, today)).toBe(false)
		expect(standingsOver({ round: null, rounds: null }, null, today)).toBe(false)
	})
})

describe('standingProgress', () => {
	const today = '2026-10-23'

	it('final: sin nota, y los puntos sobre las rondas del torneo', () => {
		expect(standingProgress({ round: 9, rounds: 9 }, '2026-10-20', today)).toEqual({ note: null, played: 9 })
		expect(standingProgress({ round: null, rounds: 7 }, '2026-10-22', today)).toEqual({ note: null, played: 7 })
		expect(standingProgress({ round: 5, rounds: null }, '2026-10-01', today)).toEqual({ note: null, played: 5 })
	})

	it('sin terminar: tras qué ronda va y los puntos sobre las jugadas; sin ronda (por equipos), en juego', () => {
		expect(standingProgress({ round: 5, rounds: 9 }, '2026-10-30', today)).toEqual({ note: 'tras la ronda\u00a05', played: 5 })
		expect(standingProgress({ round: null, rounds: 7 }, '2027-03-31', today)).toEqual({ note: 'en juego', played: null })
		expect(standingProgress({ round: null, rounds: null }, null, today)).toEqual({ note: 'en juego', played: null })
	})
})
