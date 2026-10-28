// Reprocesado de las partidas ya guardadas, como Cloudflare Workflow.
//
// La ingesta deriva algunas columnas del PGN (opening_moves, time_class y
// clocks, ver derivedColumns en games.ts). Cuando una migración añade una de esas columnas
// o cambia cómo se calcula, las partidas que ya había se quedan sin ella: este
// Workflow la recalcula a partir del PGN guardado y del ritmo del torneo, sin
// volver a pedir nada a las fuentes. Recorre la tabla por id en
// lotes y cada lote es un paso, así que si algo falla se reintenta sólo ese.
// De paso cuenta las partidas de lichess de cada torneo (lichess_games), que
// se guardan al final de la pasada.
//
// También aplica a lo guardado las reglas de los nombres de la ingesta
// (nombres.ts): quita el año de los menores de los nombres de las partidas
// (columnas y cabeceras del PGN), de los participantes y de los emparejamientos,
// y anonimiza a los retirados (tabla retiradas). Oculta el sexo y el año de
// quien lo ha pedido (tabla ocultaciones), también el del nombre. Y borra los
// torneos sensibles (tabla torneos_sensibles) y los de menores (menores.ts),
// que no se guardan. Vuelve a decidir dónde se juega cada torneo (lugares.ts).
// Y vacía la columna Fed. de los torneos en que no es la de federaciones
// (federaciones.ts).
//
//   POST /api/admin/sync  {"workflow":"reprocess"}
//   wrangler workflows trigger games-reprocess '{}'
//   wrangler workflows trigger games-reprocess '{"retiradas":true}'    (sólo la retirada)
//   wrangler workflows trigger games-reprocess '{"ocultaciones":true}' (sólo el sexo y el año ocultos)
//   wrangler workflows trigger games-reprocess '{"sensibles":true}'    (sólo los torneos sensibles)
//   wrangler workflows trigger games-reprocess '{"menores":true}'      (sólo los torneos de menores)
//   wrangler workflows trigger games-reprocess '{"lugares":true}'      (sólo dónde se juegan los torneos)
//   wrangler workflows trigger games-reprocess '{"federaciones":true}' (sólo la columna Fed.)
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { normalizeName } from '../lib/chess/names'
import { parseGames } from '../lib/chess/pgn'
import { timeClassOf } from '../lib/chess/timecontrol'
import { madridYear } from '../lib/dates'
import { withoutHomonymYear } from '../lib/format'
import { lichessUrl } from '../lib/licenses'
import { tournamentPlace } from '../lib/lugares'
import { derivedColumns, type DerivedColumns } from './games'
import { LICHESS_STEP, parseBroadcastUrl, resolveTourId, type BroadcastRef } from './lichess/api'
import { isListedMinors, isMinorsTournament } from './menores'
import { isRetired, nameKey, publicName, publicPgnNames, RETIRED_NAME, withoutHiddenYear } from './nombres'
import {
	anonymizeRetiredParticipations,
	applyHiddenFields,
	clearNonFederations,
	deleteExcludedTournaments,
	deleteRetiredPlayers,
	deleteTournaments,
	excludeBroadcasts,
	loadExcludedBroadcasts,
	loadGameCandidates,
	loadGamesForReprocess,
	loadHiddenYearPlayers,
	loadHiddenYears,
	loadHomonymParticipations,
	loadPairingNames,
	loadPairingPlayers,
	loadRetired,
	loadTournamentPlaces,
	proposeSensitive,
	refreshTotals,
	renameGames,
	renameParticipations,
	renamePairings,
	renamePlayers,
	saveLichessGames,
	updateDerivedColumns,
	updateGamePlayers,
	updatePairingPlayers,
	updateTournamentPlaces,
	withoutHiddenYears,
	withoutRetired,
	type BroadcastKey,
	type StoredGame
} from './repo'
import { looksSensitive } from './sensibles'

export interface GamesReprocessParams {
	/**
	 * Empieza después de este id (para retomar a mano una ejecución cortada).
	 * Así no guarda las partidas de lichess de cada torneo (lichess_games): hay que contarlas todas.
	 */
	after?: number
	/** Sólo aplica la lista de retiradas, sin recorrer todas las partidas: tras añadir a alguien. */
	retiradas?: boolean
	/** Sólo aplica la tabla ocultaciones a lo guardado (applyHidden), sin recorrer todas las partidas: tras añadir a alguien. */
	ocultaciones?: boolean
	/** Sólo los torneos sensibles (applySensitive), sin recorrer las partidas: tras marcar alguno. */
	sensibles?: boolean
	/** Sólo los torneos de menores (applyMinorsTournaments), sin recorrer las partidas: si cambia la regla. */
	menores?: boolean
	/** Sólo dónde se juegan los torneos (applyPlaces), sin recorrer las partidas: tras la migración o si cambian los datos. */
	lugares?: boolean
	/** Sólo la columna Fed. de los participantes (clearNonFederations), sin recorrer las partidas: si cambia la regla. */
	federaciones?: boolean
}

/** Partidas por paso: unos 2 MB de PGN y unas décimas de segundo de CPU. */
export const REPROCESS_BATCH = 1000

export interface ReprocessedBatch {
	games: number
	/** Partidas que entran en el repertorio (con jugadas y desde la posición inicial). */
	withMoves: number
	/** Partidas con ritmo conocido. */
	withTimeClass: number
	/** Partidas con algún reloj en el PGN. */
	withClocks: number
	/** Partidas cuyo valor ha cambiado (las demás no se reescriben). */
	updated: number
	/** Partidas cuyos nombres han cambiado (nombres.ts). */
	renamed: number
	/** Partidas de lichess del lote (lichessUrl), por torneo: [id del torneo, partidas]. */
	lichess: [number, number][]
	lastId: number
}

export class GamesReprocessWorkflow extends WorkflowEntrypoint<Env, GamesReprocessParams> {
	async run(event: WorkflowEvent<GamesReprocessParams>, step: WorkflowStep): Promise<void> {
		const { retiradas, ocultaciones, sensibles, menores, lugares, federaciones } = event.payload
		const all = !retiradas && !ocultaciones && !sensibles && !menores && !lugares && !federaciones
		// Lo primero: las partidas de los torneos borrados ya no se recorren.
		if (all || sensibles) {
			// Puede preguntar a lichess de qué torneo es una ronda: con sus reintentos.
			const sensitive = await step.do('torneos sensibles', LICHESS_STEP, () => applySensitive(this.env.DB))
			console.log(`[reprocess] torneos sensibles: ${JSON.stringify(sensitive)}`)
		}
		if (all || menores) {
			const minors = await step.do('torneos de menores', () => applyMinorsTournaments(this.env.DB))
			console.log(`[reprocess] torneos de menores: ${JSON.stringify(minors)}`)
		}
		if (all || lugares) {
			const places = await step.do('lugares de los torneos', () => applyPlaces(this.env.DB))
			console.log(`[reprocess] lugares de los torneos: ${JSON.stringify(places)}`)
		}
		if (all || federaciones) {
			const cleared = await step.do('columna Fed.', () => clearNonFederations(this.env.DB))
			console.log(`[reprocess] columna Fed.: ${JSON.stringify({ cleared })}`)
		}
		if (all) {
			let after = event.payload.after ?? 0
			const totals = { games: 0, withMoves: 0, withTimeClass: 0, withClocks: 0, updated: 0, renamed: 0 }
			const lichess = new Map<number, number>()
			for (;;) {
				const batch = await step.do(`lote ${after}`, () => reprocessGames(this.env.DB, after))
				if (!batch) break
				totals.games += batch.games
				totals.withMoves += batch.withMoves
				totals.withTimeClass += batch.withTimeClass
				totals.withClocks += batch.withClocks
				totals.updated += batch.updated
				totals.renamed += batch.renamed
				for (const [id, n] of batch.lichess) lichess.set(id, (lichess.get(id) ?? 0) + n)
				after = batch.lastId
			}
			// Retomada con after, faltarían las partidas de los lotes de antes.
			const lichessTournaments = event.payload.after
				? null
				: await step.do('partidas de lichess', () => saveLichessGames(this.env.DB, [...lichess]))
			const participations = await step.do('nombres de participantes', () => renameStoredParticipations(this.env.DB))
			const pairings = await step.do('nombres de emparejamientos', () => renameStoredPairings(this.env.DB))
			console.log(`[reprocess] ${JSON.stringify({ ...totals, lichessTournaments, participations, pairings })}`)
		}
		if (all || retiradas) {
			const retired = await step.do('retiradas', () => applyRetired(this.env.DB))
			console.log(`[reprocess] retiradas: ${JSON.stringify(retired)}`)
		}
		if (all || ocultaciones) {
			const hidden = await step.do('ocultaciones', () => applyHidden(this.env.DB))
			console.log(`[reprocess] ocultaciones: ${JSON.stringify(hidden)}`)
		}
	}
}

/** Recalcula un lote de partidas con id mayor que `after`; null si no queda ninguna. */
export async function reprocessGames(
	db: D1Database,
	after: number,
	limit = REPROCESS_BATCH
): Promise<ReprocessedBatch | null> {
	const games = await loadGamesForReprocess(db, after, limit)
	if (games.length === 0) return null
	const rows = games.map((g) => ({ id: g.id, ...derive(g) }))
	const year = madridYear(new Date())
	const renamed = games.flatMap((g) => {
		const names = { whiteName: publicName(g.whiteName, year), blackName: publicName(g.blackName, year) }
		const pgn = publicPgnNames(g.pgn, year)
		const changed = names.whiteName !== g.whiteName || names.blackName !== g.blackName || pgn !== g.pgn
		return changed ? [{ id: g.id, ...names, pgn }] : []
	})
	await renameGames(db, renamed)
	const lichess = new Map<number, number>()
	for (const g of games) {
		if (lichessUrl(g.pgn) !== null) lichess.set(g.tournamentId, (lichess.get(g.tournamentId) ?? 0) + 1)
	}
	return {
		games: rows.length,
		withMoves: rows.filter((r) => r.openingMoves !== null).length,
		withTimeClass: rows.filter((r) => r.timeClass !== null).length,
		withClocks: rows.filter((r) => r.clocks !== null).length,
		updated: await updateDerivedColumns(db, rows),
		renamed: renamed.length,
		lichess: [...lichess],
		lastId: games[games.length - 1].id
	}
}

function derive(game: StoredGame): DerivedColumns {
	const parsed = parseGames(game.pgn)[0]
	return parsed
		? derivedColumns(parsed, game.timeControl)
		: { openingMoves: null, timeClass: timeClassOf(game.timeControl), clocks: null }
}

/** Quita el año de los menores de los participantes guardados. Devuelve cuántos cambian. */
export async function renameStoredParticipations(db: D1Database): Promise<number> {
	const year = madridYear(new Date())
	const rows = (await loadHomonymParticipations(db)).flatMap((p) => {
		const name = publicName(p.name, year)
		return name === p.name ? [] : [{ ...p, name }]
	})
	await renameParticipations(db, rows)
	return rows.length
}

/** Lo mismo con los emparejamientos guardados. */
export async function renameStoredPairings(db: D1Database): Promise<number> {
	const year = madridYear(new Date())
	const rows = (await loadPairingNames(db)).flatMap((p) => {
		const names = { whiteName: publicName(p.whiteName, year), blackName: publicName(p.blackName, year) }
		return names.whiteName === p.whiteName && names.blackName === p.blackName ? [] : [{ ...p, ...names }]
	})
	await renamePairings(db, rows)
	return rows.length
}

/** Lo que applyRetired ha cambiado. */
export interface RetiredCleanup {
	players: number
	participations: number
	games: number
	pairings: number
}

/**
 * Aplica la lista de retiradas a lo guardado, como la ingesta al escribir:
 * fuera de players (sin ficha) y «Jugador retirado», sin FIDE ID ni título,
 * en participantes, partidas (columnas y PGN) y emparejamientos. Las partidas
 * de sus rivales se quedan. Repetirlo no cambia nada.
 */
export async function applyRetired(db: D1Database): Promise<RetiredCleanup> {
	const retired = await loadRetired(db)
	// Todos tienen nombre; no todos, FIDE ID.
	if (retired.names.size === 0) return { players: 0, participations: 0, games: 0, pairings: 0 }
	const { results } = await db.prepare('SELECT nombre FROM retiradas').all<{ nombre: string }>()
	// Los participantes sin FIDE ID se comparan por name_norm, que lleva el año
	// de los homónimos adultos: con él y sin él.
	const nameNorms = [...new Set(results.flatMap(({ nombre }) => [normalizeName(nombre), nameKey(nombre)]))]
	// Las partidas sin FIDE ID, por las palabras del nombre en el FTS.
	const matches = results.map(({ nombre }) => matchAllWords(nameKey(nombre))).filter(Boolean)

	const candidates = await loadGameCandidates(db, [...retired.ids], matches)
	const games = candidates.map((g) => withoutRetired(g, retired)).filter((g, i) => g !== candidates[i])
	await updateGamePlayers(db, games)

	const side = (fideId: number | null, name: string) => isRetired(retired, fideId, name)
	const pairings = (await loadPairingPlayers(db)).flatMap((p) => {
		const white = side(p.whiteFideId, p.whiteName)
		const black = side(p.blackFideId, p.blackName)
		if (!white && !black) return []
		return [
			{
				...p,
				...(white ? { whiteName: RETIRED_NAME, whiteFideId: null, whiteTitle: null } : {}),
				...(black ? { blackName: RETIRED_NAME, blackFideId: null, blackTitle: null } : {})
			}
		]
	})
	await updatePairingPlayers(db, pairings)

	return {
		players: await deleteRetiredPlayers(db),
		participations: await anonymizeRetiredParticipations(db, nameNorms),
		games: games.length,
		pairings: pairings.length
	}
}

/** Consulta MATCH del FTS con todas las palabras de `text`, cada una entre comillas; vacía si no tiene ninguna. */
function matchAllWords(text: string): string {
	return text
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.map((word) => `"${word}"`)
		.join(' ')
}

/** Lo que applyHidden ha cambiado. */
export interface HiddenCleanup {
	/** Fichas sin el sexo y fichas con el año marcado (applyHiddenFields). */
	sex: number
	birthYear: number
	/** Nombres sin el año de homónimo. */
	players: number
	participations: number
	games: number
	pairings: number
}

/**
 * Aplica la tabla ocultaciones a lo guardado, como la ingesta al escribir: en
 * las fichas, el sexo y la marca del año (applyHiddenFields), y el año de
 * homónimo del nombre de quien ha ocultado el suyo, en su ficha, en los
 * participantes, en las partidas (columnas y PGN) y en los emparejamientos.
 * Las partidas, sólo las candidatas: por su FIDE ID y, sin él, por su nombre y
 * su año en el FTS. Los participantes, entre los homónimos, recorriendo la
 * tabla como renameStoredParticipations. Repetirlo no cambia nada.
 */
export async function applyHidden(db: D1Database): Promise<HiddenCleanup> {
	const fields = await applyHiddenFields(db)
	const hidden = await loadHiddenYears(db)
	if (hidden.ids.size === 0) return { ...fields, players: 0, participations: 0, games: 0, pairings: 0 }

	// En su ficha, por su FIDE ID: es suya.
	const players = (await loadHiddenYearPlayers(db)).flatMap((p) => {
		const name = withoutHomonymYear(p.name)
		return name === p.name ? [] : [{ ...p, name }]
	})
	await renamePlayers(db, players)

	const participations = (await loadHomonymParticipations(db)).flatMap((p) => {
		const name = withoutHiddenYear(hidden, p.fideId, p.name)
		return name === p.name ? [] : [{ ...p, name }]
	})
	await renameParticipations(db, participations)

	const candidates = await loadGameCandidates(db, [...hidden.ids], [...hidden.names].map(matchAllWords))
	const games = candidates.map((g) => withoutHiddenYears(g, hidden)).filter((g, i) => g !== candidates[i])
	await renameGames(db, games)

	const pairings = (await loadPairingPlayers(db)).flatMap((p) => {
		const whiteName = withoutHiddenYear(hidden, p.whiteFideId, p.whiteName)
		const blackName = withoutHiddenYear(hidden, p.blackFideId, p.blackName)
		return whiteName === p.whiteName && blackName === p.blackName ? [] : [{ ...p, whiteName, blackName }]
	})
	await renamePairings(db, pairings)

	return {
		...fields,
		players: players.length,
		participations: participations.length,
		games: games.length,
		pairings: pairings.length
	}
}

/** Lo que applySensitive ha hecho. */
export interface SensitiveCleanup {
	/** Torneos guardados que parecen sensibles y se han apuntado para revisarlos. */
	proposed: number
	/** Retransmisiones de lichess de los marcados que se han marcado también. */
	broadcasts: number
	/** Torneos marcados (excluido = 1) que se han borrado, con todo lo suyo. */
	deleted: number
}

/**
 * Aplica la tabla torneos_sensibles a lo guardado: apunta para revisarlos los
 * torneos que lo parecen por el nombre (looksSensitive) y aún no están en ella,
 * marca también las retransmisiones de lichess de los marcados y borra éstos,
 * que la ingesta ya no lee. Recorre los nombres de todos los torneos: sólo lo
 * usa el reprocesado. Repetirlo no cambia nada.
 */
export async function applySensitive(
	db: D1Database,
	resolve: (ref: BroadcastRef) => Promise<string | null> = resolveTourId
): Promise<SensitiveCleanup> {
	const { results } = await db
		.prepare('SELECT source, source_key AS key, name FROM tournaments')
		.all<{ source: string; key: string; name: string }>()
	const proposed = await proposeSensitive(
		db,
		results.filter((t) => looksSensitive(t.name))
	)
	const broadcasts = await excludeBroadcasts(db, await excludedBroadcasts(db, resolve))
	const deleted = await deleteExcludedTournaments(db)
	if (deleted > 0) await refreshTotals(db)
	return { proposed, broadcasts, deleted }
}

/**
 * Las retransmisiones de lichess de los torneos marcados, antes de borrarlos:
 * borrado el torneo de info64, la pasada de lichess no reconocería su
 * retransmisión (ya no hay participantes con los que cruzarla) y la guardaría
 * como torneo propio. Son las que esa pasada ha decidido de ellos y la que
 * enlaza info64, de la que salen sus partidas; para un enlace a una ronda se
 * pregunta a lichess de qué torneo es.
 */
async function excludedBroadcasts(
	db: D1Database,
	resolve: (ref: BroadcastRef) => Promise<string | null>
): Promise<BroadcastKey[]> {
	const { tours, links } = await loadExcludedBroadcasts(db)
	const found = new Map(tours.map((t) => [t.key, t.name]))
	for (const link of links) {
		const ref = parseBroadcastUrl(link.url)
		const id = ref && (await resolve(ref))
		if (id && !found.has(id)) found.set(id, link.name)
	}
	return [...found].map(([key, name]) => ({ key, name }))
}

/** Lo que applyPlaces ha hecho. */
export interface PlacesCleanup {
	/** Torneos con provincia, sólo con comunidad y sin sitio, tras la pasada. */
	province: number
	community: number
	nowhere: number
	/** Torneos cuyo sitio ha cambiado. */
	updated: number
}

/**
 * Vuelve a decidir dónde se juega cada torneo guardado (tournamentPlace), como
 * upsertTournament al guardarlo: tras la migración que añade las columnas, si
 * cambian los datos de lugares.json o si cambia la regla. Recorre la tabla de
 * torneos y sólo reescribe los que cambian. Repetirlo no cambia nada.
 */
export async function applyPlaces(db: D1Database): Promise<PlacesCleanup> {
	const stored = await loadTournamentPlaces(db)
	const places = stored.map((t) => ({ id: t.id, ...tournamentPlace(t.city, t.name) }))
	const changed = places.filter((p, i) => p.province !== stored[i].province || p.community !== stored[i].community)
	return {
		province: places.filter((p) => p.province).length,
		community: places.filter((p) => !p.province && p.community).length,
		nowhere: places.filter((p) => !p.community).length,
		updated: await updateTournamentPlaces(db, changed)
	}
}

/**
 * Borra los torneos de menores guardados (isMinorsTournament, por el nombre, o
 * isListedMinors, por la lista), que la ingesta ya no lee. Recorre los nombres
 * de todos los torneos: sólo lo usa el reprocesado. Repetirlo no cambia nada.
 * Devuelve cuántos ha borrado.
 */
export async function applyMinorsTournaments(db: D1Database): Promise<{ deleted: number }> {
	const { results } = await db
		.prepare('SELECT id, source, source_key AS key, name, start_date AS startDate FROM tournaments')
		.all<{ id: number; source: string; key: string; name: string; startDate: string | null }>()
	const ids = results
		.filter((t) => isListedMinors(t.source, t.key) || isMinorsTournament(t.name, t.startDate))
		.map((t) => t.id)
	await deleteTournaments(db, ids)
	if (ids.length > 0) await refreshTotals(db)
	return { deleted: ids.length }
}
