import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { sitemapCounts, sitemapIds } from '../../src/lib/db/sitemap'

const db = env.DB
// Trozos de 3 en vez de 50.000: así bastan unas pocas filas para cruzar sus límites.
const SIZE = 3

beforeAll(async () => {
	const seen = '2026-10-22T00:00:00.000Z'
	const game = (id: number, plies: number, white: number | null, black: number | null) =>
		db
			.prepare(
				`INSERT INTO games (id, tournament_id, round, board, white_name, black_name, white_fide_id, black_fide_id,
					result, ply_count, pgn, seen_at)
				VALUES (?1, 1, 1, ?1, 'Blancas', 'Negras', ?3, ?4, '1-0', ?2, '', ?5)`
			)
			.bind(id, plies, white, black, seen)
	await db.batch([
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM participations'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM players'),
		db.prepare('DELETE FROM site_totals'),
		// Torneos 1, 2 y 5: el 5 abre el segundo trozo.
		...[1, 2, 5].map((id) =>
			db
				.prepare("INSERT INTO tournaments (id, source, source_key, name, type, url) VALUES (?1, 'info64', ?1, 'Torneo', 'individual', '')")
				.bind(id)
		),
		// Siete jugadores; con torneos, el 200 y el 500; con una partida con
		// blancas, el 300, y con negras, el 700. El 200 nació en 2008: en 2026
		// puede ser menor y su ficha no se indexa. El 500, en 2007.
		...[100, 200, 300, 400, 500, 600, 700].map((id) =>
			db
				.prepare("INSERT INTO players (fide_id, name, birth_year, seen_at) VALUES (?1, 'Supuesto Irreal, Otro', ?2, ?3)")
				.bind(id, id === 200 ? 2008 : id === 500 ? 2007 : null, seen)
		),
		...[200, 500].map((id, i) =>
			db
				.prepare(
					"INSERT INTO participations (tournament_id, start_rank, name, name_norm, fide_id) VALUES (1, ?1, 'Supuesto Irreal, Otro', 'supuesto irreal otro', ?2)"
				)
				.bind(i + 1, id)
		),
		// La 2 no tiene jugadas.
		game(1, 40, null, null),
		game(2, 0, null, null),
		game(3, 51, 300, null),
		game(4, 12, null, null),
		game(7, 80, null, 700),
		db.prepare("INSERT INTO site_totals (id, players, games, tournaments, updated_at) VALUES (1, 7, 5, 3, '')")
	])
})

describe('sitemapCounts', () => {
	it('trozos de partidas y torneos por su id más alto, y de jugadores por su total', async () => {
		expect(await sitemapCounts(db, SIZE)).toEqual({ jugadores: 3, torneos: 2, partidas: 3 })
	})
})

describe('sitemapIds', () => {
	const ids = async (kind: 'jugadores' | 'torneos' | 'partidas', n: number, year = 2026) =>
		(await sitemapIds(db, kind, n, SIZE, year)).sort((a, b) => a - b)

	it('partidas con jugadas, por rangos de id', async () => {
		expect(await ids('partidas', 1)).toEqual([1, 3])
		expect(await ids('partidas', 2)).toEqual([4])
		expect(await ids('partidas', 3)).toEqual([7])
		expect(await ids('partidas', 4)).toEqual([])
	})

	it('todos los torneos, por rangos de id', async () => {
		expect(await ids('torneos', 1)).toEqual([1, 2])
		expect(await ids('torneos', 2)).toEqual([5])
	})

	it('jugadores con torneos o partidas que no pueden ser menores, de tres en tres por posición', async () => {
		expect(await ids('jugadores', 1)).toEqual([300])
		expect(await ids('jugadores', 2)).toEqual([500])
		expect(await ids('jugadores', 3)).toEqual([700])
	})

	it('el nacido en 2008 entra en 2027, cuando ya no puede ser menor', async () => {
		expect(await ids('jugadores', 1, 2027)).toEqual([200, 300])
	})
})
