// Tablero pintado en el servidor (components/visor/Tablero.astro): lo que
// chessground pinta de una posición, con su mismo marcado, para que se vea en
// el primer pintado y sin JavaScript. Al montarse, chessground vacía el
// elemento y pone el suyo; las reglas de board.css valen para los dos.
import { Chess } from 'chessops/chess'
import { parseFen } from 'chessops/fen'
import { parseSquare, squareFile, squareRank } from 'chessops/util'

export type Orientation = 'white' | 'black'

/** Una casilla en pantalla: columna y fila, de 0 a 7 desde arriba a la izquierda. */
export interface ScreenSquare {
	x: number
	y: number
}

export interface StaticPiece extends ScreenSquare {
	/** Color y pieza, como las clases de chessground: «white pawn». */
	className: string
}

export interface StaticBoard {
	pieces: StaticPiece[]
	/** Las casillas de salida y de llegada de la última jugada. */
	lastMove: ScreenSquare[]
	/** El rey del bando que mueve, si está en jaque. */
	check: ScreenSquare | null
}

/** Dónde cae una casilla en pantalla con el tablero visto desde `orientation`. */
function onScreen(square: number, orientation: Orientation): ScreenSquare {
	const file = squareFile(square)
	const rank = squareRank(square)
	return orientation === 'white' ? { x: file, y: 7 - rank } : { x: 7 - file, y: rank }
}

/**
 * Las piezas, la última jugada (UCI estándar: el enroque, «e1g1», como la
 * marca chessground) y el jaque de un FEN. Uno que no se lee, tablero vacío.
 */
export function staticBoard(fen: string, orientation: Orientation, lastMove?: string): StaticBoard {
	const setup = parseFen(fen)
	if (setup.isErr) return { pieces: [], lastMove: [], check: null }
	const pieces = [...setup.value.board].map(([square, piece]) => ({
		className: `${piece.color} ${piece.role}`,
		...onScreen(square, orientation)
	}))
	const moved = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)].map((name) => parseSquare(name)) : []
	const pos = Chess.fromSetup(setup.value)
	const king = pos.isOk && pos.value.isCheck() ? pos.value.board.kingOf(pos.value.turn) : undefined
	return {
		pieces,
		lastMove: moved.flatMap((square) => (square === undefined ? [] : [onScreen(square, orientation)])),
		check: king === undefined ? null : onScreen(king, orientation)
	}
}

/**
 * La casilla de una pieza o de una marca, como la pone chessground: un
 * desplazamiento desde la esquina de arriba a la izquierda. En tantos por
 * ciento de su propio tamaño (una casilla), porque el servidor no sabe cuánto
 * mide el tablero; chessground lo pone en píxeles.
 */
export function placement({ x, y }: ScreenSquare): string {
	return `transform:translate(${x * 100}%,${y * 100}%)`
}
