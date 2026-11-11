import { env, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseExample, refreshExample, refreshExampleStep, summarizeExample } from '../../src/ingest/ejemplo'
import { GamesReprocessWorkflow, type GamesReprocessParams } from '../../src/ingest/reprocess'
import { saveSyncState, upsertTournament } from '../../src/ingest/repo'
import { clockSummary, MIN_CLOCK_GAMES } from '../../src/lib/chess/clock'
import { madridYear } from '../../src/lib/dates'
import { EXAMPLE_KEY, EXAMPLE_VERSION, getExample } from '../../src/lib/db/ejemplo'
import { getPlayerGames } from '../../src/lib/db/repertoire'

const db = env.DB
const year = madridYear(new Date())

// Ordenados por ELO, como el ranking: un posible menor, uno sin relojes y dos con todo.
const MINOR = 9100001
const NO_CLOCKS = 9100002
const FIRST = 9100003
const SECOND = 9100004

/**
 * Relojes de una partida de 12 jugadas (games.clocks): las negras, siempre 5400 s;
 * las blancas, bajando de 60 en 60 y, con apuro, a 100 s en las dos últimas (por
 * debajo del 5 % de su tiempo).
 */
function clocks(troubled: boolean): string {
	const values: string[] = []
	for (let move = 1; move <= 12; move++) values.push(String(troubled && move >= 11 ? 100 : 5400 - move * 60), '5400')
	return values.join(' ')
}

let tournament = 0
let round = 0

/** `n` partidas con blancas del jugador: la mitad con 1.e4 y la otra con 1.d4; una de cada tres, tablas. */
async function addWhiteGames(fideId: number, n: number, { withClocks = true } = {}) {
	await db.batch(
		Array.from({ length: n }, (_, i) =>
			db
				.prepare(
					`INSERT INTO games (tournament_id, round, board, date, white_name, black_name, white_fide_id,
						white_elo, black_elo, result, ply_count, pgn, seen_at, opening_moves, time_class, clocks)
					VALUES (?1, ?2, 1, '2026-10-01', 'Blancas Inventado, Uno', 'Negras Inventado, Dos', ?3,
						2700, ?4, ?5, 24, '', '2026-10-02', ?6, 'standard', ?7)`
				)
				.bind(
					tournament,
					++round,
					fideId,
					i % 2 ? 2500 : 2700,
					i % 3 ? '1-0' : '1/2-1/2',
					i % 2 ? 'e2e4 e7e5' : 'd2d4 d7d5',
					withClocks ? clocks(i % 4 === 0) : null
				)
		)
	)
}

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM games'),
		db.prepare('DELETE FROM players'),
		db.prepare('DELETE FROM tournaments'),
		db.prepare('DELETE FROM portada_excluidos'),
		db.prepare('DELETE FROM sync_state WHERE key = ?1').bind(EXAMPLE_KEY)
	])
	await db.batch(
		[
			[MINOR, 'Joven Inventado, Uno', year - 15, 2750],
			[NO_CLOCKS, 'Sinreloj Inventado, Dos', 1980, 2720],
			[FIRST, 'Primero Inventado, Tres', 1990, 2700],
			[SECOND, 'Segundo Inventado, Cuatro', 1985, 2650]
		].map(([id, name, born, elo]) =>
			db
				.prepare(`INSERT INTO players (fide_id, name, birth_year, rating_std, seen_at) VALUES (?1, ?2, ?3, ?4, '2026-11-01')`)
				.bind(id, name, born, elo)
		)
	)
	tournament = await upsertTournament(db, {
		source: 'info64',
		key: 'open-inventado',
		type: 'individual',
		name: 'Open inventado',
		city: null,
		startDate: '2026-10-01',
		endDate: '2026-10-02',
		timeControl: '90+30',
		url: 'https://info64.org/open-inventado',
		syncedAt: '2026-10-02T00:00:00.000Z'
	})
	await addWhiteGames(MINOR, 8)
	await addWhiteGames(NO_CLOCKS, 8, { withClocks: false })
	await addWhiteGames(FIRST, 8)
	await addWhiteGames(SECOND, 8)
})

describe('summarizeExample', () => {
	it('resume sus partidas con blancas con las funciones del dossier', async () => {
		const games = await getPlayerGames(db, FIRST, 'white', {}, { clocks: true })
		const summary = summarizeExample(games)!
		expect(summary.first.moves.map((m) => [m.uci, m.stats.games])).toEqual([
			['d2d4', 4],
			['e2e4', 4]
		])
		expect(summary.byElo.similar.games).toBe(4)
		expect(summary.byElo.weaker.games).toBe(4)
		expect(summary.timeClass).toBe('standard')
		expect(summary.clock).toEqual(clockSummary(games, 'white'))
		expect(summary.clock.trouble).toBe(2)
	})

	it('no da ejemplo si una tarjeta no tendría nada que enseñar', async () => {
		const games = await getPlayerGames(db, FIRST, 'white', {}, { clocks: true })
		expect(summarizeExample(games.slice(0, MIN_CLOCK_GAMES - 1))).toBeNull()
		expect(summarizeExample(games.map((g) => ({ ...g, clocks: null })))).toBeNull()
		expect(summarizeExample(games.map((g) => ({ ...g, openingMoves: null })))).toBeNull()
		expect(summarizeExample(games.map((g) => ({ ...g, opponentElo: null })))).toBeNull()
	})
})

describe('refreshExample y getExample', () => {
	it('el primero del ranking con datos para las tres tarjetas, sin posibles menores; su puesto es el del ranking', async () => {
		expect(await refreshExample(db)).toEqual({ fideId: FIRST, rank: 3 })
		const example = await getExample(db, year)
		expect(example).toMatchObject({ v: EXAMPLE_VERSION, fideId: FIRST, rank: 3, name: 'Primero Inventado, Tres' })
		expect(example?.first.total.games).toBe(8)
	})

	it('quien pide no salir deja de salir en el acto y, al recalcularlo, sale el siguiente', async () => {
		await refreshExample(db)
		await db.prepare(`INSERT INTO portada_excluidos (fide_id, peticion, creada) VALUES (?1, 'P-2026-999', '2026-11-11')`).bind(FIRST).run()
		expect(await getExample(db, year)).toBeNull()
		expect(await refreshExample(db)).toEqual({ fideId: SECOND, rank: 4 })
		expect((await getExample(db, year))?.name).toBe('Segundo Inventado, Cuatro')
	})

	it('si se retira (sin ficha) o pudiera ser menor, deja de salir sin recalcularlo', async () => {
		await refreshExample(db)
		await db.prepare('UPDATE players SET birth_year = ?1 WHERE fide_id = ?2').bind(year - 10, FIRST).run()
		expect(await getExample(db, year)).toBeNull()
		await db.prepare('DELETE FROM players WHERE fide_id = ?1').bind(FIRST).run()
		expect(await getExample(db, year)).toBeNull()
	})

	it('no enseña uno guardado con otra forma', async () => {
		const example = await chooseExample(db, year)
		await saveSyncState(db, EXAMPLE_KEY, JSON.stringify({ ...example, v: EXAMPLE_VERSION - 1 }))
		expect(await getExample(db, year)).toBeNull()
	})

	it('sin nadie con datos guarda null, y la portada no lo enseña', async () => {
		await refreshExample(db)
		await db.prepare('UPDATE games SET clocks = NULL').run()
		expect(await refreshExample(db)).toBeNull()
		expect(await getExample(db, year)).toBeNull()
	})

	it('la forma de lo guardado no cambia sin subir EXAMPLE_VERSION', async () => {
		const example = (await chooseExample(db, year))!
		const keys = (o: object) => Object.keys(o).sort()
		expect(
			{
				example: keys(example),
				first: keys(example.first),
				move: keys(example.first.moves[0]),
				byElo: keys(example.byElo),
				stats: keys(example.byElo.similar),
				clock: keys(example.clock),
				phases: keys(example.clock.phases)
			},
			'Si cambia, sube EXAMPLE_VERSION (src/lib/db/ejemplo.ts) y pon aquí las claves nuevas'
		).toEqual({
			example: ['byElo', 'clock', 'fideId', 'first', 'rank', 'timeClass', 'v'],
			first: ['moves', 'other', 'total'],
			move: ['replies', 'stats', 'uci'],
			byElo: ['similar', 'stronger', 'unknown', 'weaker'],
			stats: ['draws', 'games', 'lastDate', 'losses', 'wins'],
			clock: ['afterOpening', 'games', 'initial', 'phases', 'trouble', 'troubleMove', 'withTrouble', 'withoutTrouble'],
			phases: ['early', 'late', 'middle']
		})
	})

	it('el reprocesado {"ejemplo":true} sólo lo recalcula: nada de lo que borra el reprocesado entero', async () => {
		const steps: string[] = []
		const step = {
			do: async (name: string, ...rest: unknown[]) => {
				steps.push(name)
				return (rest.at(-1) as () => Promise<unknown>)()
			},
			sleep: async () => {}
		} as unknown as WorkflowStep
		const workflow = Object.assign(Object.create(GamesReprocessWorkflow.prototype), { env }) as GamesReprocessWorkflow
		await workflow.run({ payload: { ejemplo: true } } as WorkflowEvent<GamesReprocessParams>, step)
		expect(steps).toEqual(['ejemplo'])
		expect((await getExample(db, year))?.fideId).toBe(FIRST)
	})

	it('si falla el paso, la pasada sigue', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const step = { do: () => Promise.reject(new Error('D1 no responde')) } as unknown as WorkflowStep
		await expect(refreshExampleStep(step, db, 'prueba')).resolves.toBeUndefined()
		expect(warn).toHaveBeenCalledWith('[prueba] ejemplo: Error: D1 no responde')
		warn.mockRestore()
	})
})
