// Clasificación de aperturas (ECO + nombre) por posición.
//
// openings.json lo genera scripts/build-openings.mjs a partir de los TSV de
// lichess. Se recorre la línea principal y se queda la posición con nombre más
// profunda; al indexar por posición, las transposiciones también se nombran.
// Sólo se usa en el servidor: el JSON pesa ~450 KB.
import type { Position } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import openings from './openings.json'

export interface Opening {
	eco: string
	name: string
}

/** Plies máximos que hay que mirar: ninguna apertura del catálogo es más larga. */
export const OPENING_MAX_PLY: number = openings.maxPly

// El mapa se construye en el primer uso: este módulo está en el bundle del
// Worker y no hace falta pagar el coste en cada petición web.
let byEpd: Map<string, Opening> | undefined

function openingsByEpd(): Map<string, Opening> {
	byEpd ??= new Map(openings.positions.map(([epd, eco, name]) => [epd, { eco, name }]))
	return byEpd
}

/**
 * Clave de una posición: el FEN sin contadores de jugadas y con la casilla al
 * paso sólo si hay captura legal. Dos posiciones tienen la misma clave si y
 * sólo si equalsIgnoreMoves las da por iguales. Es la de openings.json, y la
 * del árbol del repertorio.
 */
export function positionKey(pos: Position): string {
	return makeFen(pos.toSetup(), { epd: true })
}

export function lookupOpening(pos: Position): Opening | undefined {
	return openingsByEpd().get(positionKey(pos))
}
