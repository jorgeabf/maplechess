import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { upsertTournament } from '../../src/ingest/repo'
import {
	FIDE_LIST_KEY,
	findPlayersByName,
	getPlayer,
	getRanking,
	mayBeMinor,
	PLAYER_ORDER,
	rankingQueries,
	RANKING_CATEGORIES,
	searchPlayers,
	summarize
} from '../../src/lib/db/players'
import { playerFilters } from '../../src/lib/params'
import { formatPoints } from '../../src/lib/format'

const row = (color: 'white' | 'black', tournamentId: number, eco: string | null, result: string, n = 1) => ({
	color,
	tournamentId,
	eco,
	opening: eco ? `Apertura ${eco}` : null,
	result,
	n
})

describe('summarize', () => {
	const summary = summarize([
		row('white', 1, 'B13', '1-0', 2),
		row('white', 1, 'B13', '0-1'),
		row('black', 1, 'C40', '1/2-1/2'),
		row('black', 2, 'C40', '0-1'),
		row('black', 2, null, '*')
	])

	it('cuenta los resultados por color desde el punto de vista del jugador', () => {
		expect(summary.colors).toEqual([
			{ color: 'white', games: 3, wins: 2, draws: 0, losses: 1 },
			{ color: 'black', games: 2, wins: 1, draws: 1, losses: 0 }
		])
	})

	it('da las aperturas por color, primero las de blancas', () => {
		expect(summary.openings).toEqual([
			{ color: 'white', eco: 'B13', opening: 'Apertura B13', games: 3, score: 2 / 3 },
			{ color: 'black', eco: 'C40', opening: 'Apertura C40', games: 2, score: 0.75 }
		])
	})

	it('una apertura jugada con los dos colores sale dos veces; las partidas sin resultado cuentan, pero no puntúan', () => {
		const { openings } = summarize([row('white', 1, 'C42', '1-0'), row('black', 1, 'C42', '1-0'), row('black', 2, 'C42', '*')])
		expect(openings).toEqual([
			{ color: 'white', eco: 'C42', opening: 'Apertura C42', games: 1, score: 1 },
			{ color: 'black', eco: 'C42', opening: 'Apertura C42', games: 2, score: 0 }
		])
		expect(summarize([row('white', 1, 'C42', '*')]).openings[0].score).toBeNull()
	})

	it('junta el ECO con el nombre más repetido; uno vacío, sólo si no hay otro', () => {
		const named = (opening: string | null, n: number) => ({ ...row('white', 1, 'B20', '1-0', n), opening })
		const [b20] = summarize([named('Sicilian Defense', 1), named('Sicilian Defense: Lasker-Dunne Attack', 2), named(null, 5)]).openings
		expect(b20).toMatchObject({ opening: 'Sicilian Defense: Lasker-Dunne Attack', games: 8 })
	})

	it('como mucho cinco por color, las más jugadas', () => {
		const ecos = ['A00', 'A01', 'A02', 'A03', 'A04', 'A05']
		const { openings } = summarize(ecos.map((eco, i) => row('white', 1, eco, '1-0', i === 5 ? 2 : 1)))
		expect(openings.map((o) => o.eco)).toEqual(['A05', 'A00', 'A01', 'A02', 'A03'])
	})

	it('da partidas y puntos por torneo; las que no tienen resultado sólo suman partidas', () => {
		expect(summary.byTournament.get(1)).toEqual({ games: 4, points: 2.5, decided: 4 })
		expect(summary.byTournament.get(2)).toEqual({ games: 2, points: 1, decided: 1 })
	})

	it('sin partidas devuelve los dos colores a cero', () => {
		expect(summarize([]).colors.map((c) => c.games)).toEqual([0, 0])
	})
})

describe('formatPoints', () => {
	it('escribe los medios puntos con ½', () => {
		expect([0, 0.5, 1, 4.5, 7].map(formatPoints)).toEqual(['0', '½', '1', '4½', '7'])
	})
})

describe('searchPlayers', () => {
	const db = env.DB

	beforeEach(async () => {
		await db.batch([db.prepare('DELETE FROM games'), db.prepare('DELETE FROM players'), db.prepare('DELETE FROM tournaments')])
		await db.batch(
			[
				[9000001, 'Garcia Blancas, Ana', 2100],
				[9000002, 'Garcia Negras, Berta', 2000],
				[9000003, 'Garcia Sin Partidas, Carla', 2200]
			].map(([id, name, elo]) =>
				db
					.prepare(`INSERT INTO players (fide_id, name, rating_std, seen_at) VALUES (?1, ?2, ?3, '2026-10-01')`)
					.bind(id, name, elo)
			)
		)
		const tournament = await upsertTournament(db, {
			source: 'info64',
			key: 'open-de-prueba',
			type: 'individual',
			name: 'Open de prueba',
			city: null,
			startDate: '2026-10-17',
			endDate: '2026-10-18',
			timeControl: null,
			url: 'https://info64.org/open-de-prueba',
			syncedAt: '2026-10-18T00:00:00.000Z'
		})
		await db
			.prepare(
				`INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_fide_id, black_fide_id,
					result, ply_count, pgn, seen_at)
				VALUES (?1, 1, 1, '2026-10-17', 'Garcia Blancas, Ana', 'Garcia Negras, Berta', 9000001, 9000002, '1-0', 40, '', '2026-10-18')`
			)
			.bind(tournament)
			.run()
	})

	const names = async (query: string) =>
		(await searchPlayers(db, playerFilters(new URLSearchParams(query)))).rows.map((p) => p.name)

	it('«Sólo con partidas» deja a quien tiene alguna, con cualquier color', async () => {
		expect(await names('q=garcia')).toEqual(['Garcia Sin Partidas, Carla', 'Garcia Blancas, Ana', 'Garcia Negras, Berta'])
		expect(await names('q=garcia&con_partidas=1')).toEqual(['Garcia Blancas, Ana', 'Garcia Negras, Berta'])
	})

	it('«Sólo activos» quita a los inactivos de la lista FIDE', async () => {
		await db.prepare('UPDATE players SET inactive = 1 WHERE fide_id = 9000003').run()
		expect(await names('q=garcia&activos=1')).toEqual(['Garcia Blancas, Ana', 'Garcia Negras, Berta'])
		expect(await names('elo_min=2050&activos=1')).toEqual(['Garcia Blancas, Ana'])
	})

	it('cuenta sólo los que pasan el filtro', async () => {
		const page = await searchPlayers(db, playerFilters(new URLSearchParams('q=garcia&con_partidas=1')))
		expect(page.total).toBe(2)
	})

	describe('findPlayersByName', () => {
		const rival = 9000002
		const found = async (name: string, limit?: number) => {
			const { rows, more } = await findPlayersByName(db, name, rival, limit)
			return { names: rows.map((p) => p.name), more }
		}

		it('en el orden de /jugadores, sin el rival y también sin partidas', async () => {
			expect(await found('garcia')).toEqual({ names: ['Garcia Sin Partidas, Carla', 'Garcia Blancas, Ana'], more: false })
		})

		it('dice si hay más de los que enseña', async () => {
			expect(await found('garcia', 1)).toEqual({ names: ['Garcia Sin Partidas, Carla'], more: true })
			expect(await found('garcia', 2)).toEqual({ names: ['Garcia Sin Partidas, Carla', 'Garcia Blancas, Ana'], more: false })
		})

		it('cada palabra es un prefijo, en cualquier orden y sin tildes', async () => {
			expect((await found('Ána garc')).names).toEqual(['Garcia Blancas, Ana'])
		})

		it('sin palabras que buscar o sin nadie que case, la lista vacía', async () => {
			expect(await found('-')).toEqual({ names: [], more: false })
			expect(await found('lopez')).toEqual({ names: [], more: false })
		})
	})

	it('ni la búsqueda, ni la ficha ni «¿Cuál eres tú?» dan el año de nacimiento de un menor', async () => {
		await db.batch([
			db.prepare('UPDATE players SET birth_year = 2008 WHERE fide_id = 9000001'),
			db.prepare('UPDATE players SET birth_year = 2007 WHERE fide_id = 9000003')
		])
		const born = (rows: { name: string; birthYear: number | null }[]) => rows.map((p) => [p.name, p.birthYear])
		const search = await searchPlayers(db, playerFilters(new URLSearchParams('q=garcia')), 2026)
		expect(born(search.rows)).toEqual([
			['Garcia Sin Partidas, Carla', 2007],
			['Garcia Blancas, Ana', null],
			['Garcia Negras, Berta', null]
		])
		expect(born((await findPlayersByName(db, 'garcia', 9000002, undefined, 2026)).rows)).toEqual([
			['Garcia Sin Partidas, Carla', 2007],
			['Garcia Blancas, Ana', null]
		])
		expect((await getPlayer(db, 9000001, 2026))?.birthYear).toBeNull()
		expect((await getPlayer(db, 9000003, 2026))?.birthYear).toBe(2007)
	})

	it('la ficha dice quién puede ser menor; sin año, como un adulto', async () => {
		await db.batch([
			db.prepare('UPDATE players SET birth_year = 2008 WHERE fide_id = 9000001'),
			db.prepare('UPDATE players SET birth_year = 2007 WHERE fide_id = 9000003')
		])
		const minor = async (fideId: number, year: number) => (await getPlayer(db, fideId, year))?.minor
		expect(await minor(9000001, 2026)).toBe(true)
		expect(await minor(9000001, 2027)).toBe(false)
		expect(await minor(9000003, 2026)).toBe(false)
		expect(await minor(9000002, 2026)).toBe(false)
	})
})

describe('mayBeMinor', () => {
	it('los sub-18 por año natural: en 2026, los nacidos desde 2008', () => {
		expect(mayBeMinor(2008, 2026)).toBe(true)
		expect(mayBeMinor(2015, 2026)).toBe(true)
		expect(mayBeMinor(2007, 2026)).toBe(false)
		expect(mayBeMinor(null, 2026)).toBe(false)
	})
})

describe('getRanking', () => {
	const db = env.DB

	beforeEach(async () => {
		await db.batch([db.prepare('DELETE FROM games'), db.prepare('DELETE FROM players'), db.prepare('DELETE FROM sync_state')])
		// fide_id, nombre, sexo, nacimiento, ELO, ELO anterior, inactivo
		const players: [number, string, string, number, number | null, number | null, number][] = [
			[9100001, 'A, Primero', 'M', 1990, 2600, 2590, 0],
			[9100002, 'B, Inactivo', 'M', 1970, 2700, 2700, 1],
			[9100003, 'C, Jugadora', 'F', 1995, 2400, 2420, 0],
			[9100004, 'D, Juvenil', 'M', 2008, 2300, 2200, 0],
			[9100005, 'E, Ya no es sub-18', 'M', 2007, 2350, null, 0],
			[9100006, 'F, Sin ELO', 'M', 2010, null, null, 0],
			[9100007, 'G, Empatada', 'F', 1999, 2400, null, 0],
			[9100008, 'H, Veterano', 'M', 1961, 2250, 2245, 0],
			[9100009, 'I, Cincuentón', 'M', 1976, 2200, null, 0],
			[9100010, 'J, Aún no', 'M', 1977, 2150, null, 0]
		]
		await db.batch(
			players.map(([id, name, sex, born, elo, prev, inactive]) =>
				db
					.prepare(
						`INSERT INTO players (fide_id, name, sex, birth_year, rating_std, rating_std_prev, inactive, seen_at)
						VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '2026-10-17')`
					)
					.bind(id, name, sex, born, elo, prev, inactive)
			)
		)
		await db
			.prepare(`INSERT INTO sync_state (key, value, updated_at) VALUES (?1, 'Fri, 26 Sep 2026', '2026-10-17T10:00:00.000Z')`)
			.bind(FIDE_LIST_KEY)
			.run()
	})

	const ranking = async (category: (typeof RANKING_CATEGORIES)[number]) => {
		const r = await getRanking(db, category, 2026)
		return { top: r.top.map((p) => p.name), risers: r.risers.map((p) => `${p.name} +${p.gain}`) }
	}

	it('por ELO y, si empatan, por nombre; sin inactivos ni quien no tiene ELO', async () => {
		expect((await ranking('')).top).toEqual([
			'A, Primero',
			'C, Jugadora',
			'G, Empatada',
			'E, Ya no es sub-18',
			'D, Juvenil',
			'H, Veterano',
			'I, Cincuentón',
			'J, Aún no'
		])
	})

	it('femenino y sub-18 (en 2026, nacidos desde 2008)', async () => {
		expect((await ranking('femenino')).top).toEqual(['C, Jugadora', 'G, Empatada'])
		expect((await ranking('sub18')).top).toEqual(['D, Juvenil'])
	})

	it('+50 y +65 por año natural (en 2026, nacidos hasta 1976 y hasta 1961)', async () => {
		expect((await ranking('mas50')).top).toEqual(['H, Veterano', 'I, Cincuentón'])
		expect((await ranking('mas65')).top).toEqual(['H, Veterano'])
	})

	it('los que suben, por lo que suben; no los que bajan ni los que no tienen lista anterior', async () => {
		expect((await ranking('')).risers).toEqual(['D, Juvenil +100', 'A, Primero +10', 'H, Veterano +5'])
		expect((await ranking('femenino')).risers).toEqual([])
		expect((await ranking('sub18')).risers).toEqual(['D, Juvenil +100'])
		expect((await ranking('mas65')).risers).toEqual(['H, Veterano +5'])
	})

	it('sin el año de nacimiento de los menores', async () => {
		const { top, risers } = await getRanking(db, '', 2026)
		const born = (name: string) => top.find((p) => p.name === name)?.birthYear
		expect(born('D, Juvenil')).toBeNull()
		expect(born('E, Ya no es sub-18')).toBe(2007)
		expect(risers.find((p) => p.name === 'D, Juvenil')?.birthYear).toBeNull()
	})

	it('da cuándo se importó la lista FIDE', async () => {
		expect((await getRanking(db, '', 2026)).listDate).toBe('2026-10-17T10:00:00.000Z')
	})

	it('las dos listas recorren su índice sin ordenar los jugadores', async () => {
		const plan = async (sql: string, params: number[]) =>
			(
				await db
					.prepare(`EXPLAIN QUERY PLAN ${sql}`)
					.bind(...params)
					.all<{ detail: string }>()
			).results
				.map((r) => r.detail)
				.join(' | ')
		for (const category of RANKING_CATEGORIES) {
			const { top, risers, params } = rankingQueries(category, 2026)
			const topPlan = await plan(top, params)
			// En femenino, sólo por las jugadoras.
			expect(topPlan, category).toContain(category === 'femenino' ? 'players_sex' : 'players_rating_std')
			expect(topPlan, category).not.toContain('TEMP B-TREE')
			// Las que suben, también en femenino: con players_sex se ordenaba a todas (de 206 filas a 11.885).
			const risersPlan = await plan(risers, params)
			expect(risersPlan, category).toContain('players_rating_gain')
			expect(risersPlan, category).not.toContain('TEMP B-TREE')
		}
	})

	it('la búsqueda por nombre sigue entrando por el FIDE ID de los que casan', async () => {
		const { results } = await db
			.prepare(
				`EXPLAIN QUERY PLAN SELECT p.fide_id FROM players p
				WHERE p.fide_id IN (SELECT rowid FROM players_fts WHERE players_fts MATCH ?1) ${PLAYER_ORDER} LIMIT 25`
			)
			.bind('garcia*')
			.all<{ detail: string }>()
		expect(results.map((r) => r.detail).join(' | ')).toContain('INTEGER PRIMARY KEY')
	})

	it('el título y el sexo van por su índice, también al contar: sin él, el recuento recorría la tabla', async () => {
		for (const [query, index] of [
			['titulo=GM', 'players_title'],
			['titulo=WFM&activos=1', 'players_title'],
			['sexo=F', 'players_sex'],
			['sexo=F&elo_min=2000', 'players_sex']
		]) {
			// El SQL y los parámetros de cada consulta de la búsqueda.
			const statements: { sql: string; params: unknown[] }[] = []
			const spying = new Proxy(db, {
				get(target, prop) {
					if (prop !== 'prepare') {
						const value: unknown = Reflect.get(target, prop)
						return typeof value === 'function' ? value.bind(target) : value
					}
					return (sql: string) => {
						const statement = target.prepare(sql)
						return { bind: (...params: unknown[]) => (statements.push({ sql, params }), statement.bind(...params)) }
					}
				}
			})
			await searchPlayers(spying, playerFilters(new URLSearchParams(query)), 2026)
			expect(statements, query).toHaveLength(2)
			for (const { sql, params } of statements) {
				const { results } = await db
					.prepare(`EXPLAIN QUERY PLAN ${sql}`)
					.bind(...params)
					.all<{ detail: string }>()
				expect(results.map((r) => r.detail).join(' | '), query).toContain(index)
			}
		}
	})
})
