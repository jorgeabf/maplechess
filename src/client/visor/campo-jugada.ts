// El campo para escribir una jugada (CampoJugada.astro), en el visor y en el
// explorador del repertorio. Lee lo que se escribe en SAN («Nf3», «exd5»,
// «O-O», «e8=Q») o en UCI («g1f3»), con lo que se suele escribir de otra
// manera («nf3», «0-0», «e2-e4»…), y lo juega como si se hubiera movido la
// pieza: un peón que corona sin decir a qué abre el diálogo de coronar. Lo que
// no vale se dice debajo del campo, en su región viva.
import { normalizeMove, type Position } from 'chessops/chess'
import { makeSan, parseSan } from 'chessops/san'
import type { Role } from 'chessops/types'
import { charToRole, makeSquare, parseSquare, parseUci, roleToChar } from 'chessops/util'
import { positionOf, standardUci } from '../../lib/chess/uci'
import { choosePromotion, promotes, PROMOTION_ROLES } from './coronacion'

/** Lo que se ha escrito, leído en una posición. */
export type TypedMove =
	| { kind: 'empty' }
	| { kind: 'move'; uci: string }
	/** Un peón que llega a la última fila sin decir a qué corona. */
	| { kind: 'promotion'; orig: string; dest: string }
	/** Hay varias jugadas así («Nd4» con dos caballos que llegan): su SAN. */
	| { kind: 'ambiguous'; options: string[] }
	| { kind: 'illegal' }

const UCI = /^[a-h][1-8]-?[a-h][1-8][qrbn]?$/i
const PIECE_MOVE = /^([NBRQK])([a-h])?([1-8])?x?([a-h][1-8])$/

/** Una jugada en UCI («g1f3», «e2-e4»; el enroque, también e1h1). */
function readUci(pos: Position, typed: string): TypedMove {
	const move = parseUci(typed.toLowerCase().replace('-', ''))
	if (!move || !('from' in move)) return { kind: 'illegal' }
	const normal = normalizeMove(pos, move)
	if (pos.isLegal(normal)) return { kind: 'move', uci: standardUci(pos, normal) }
	const [orig, dest] = [makeSquare(move.from), makeSquare(move.to)]
	if (!move.promotion && promotes(pos, orig, dest) && pos.isLegal({ ...move, promotion: 'queen' })) {
		return { kind: 'promotion', orig, dest }
	}
	return { kind: 'illegal' }
}

/**
 * Las formas de leer lo escrito en SAN, de la más literal a la más libre:
 * chessops no acepta el enroque con ceros ni la letra de la pieza en
 * minúscula. La «b» minúscula es primero el peón («bxc3») y, si no vale, el
 * alfil.
 */
function spellings(typed: string): string[] {
	const castle = /^[0o]-[0o](-[0o])?$/i.test(typed) ? typed.toUpperCase().replace(/0/g, 'O') : typed
	const piece = /^[nbrqk]/.test(castle) ? castle[0].toUpperCase() + castle.slice(1) : null
	return piece ? [castle, piece] : [castle]
}

/** Las jugadas que encajan con lo escrito si señala una pieza y no dice cuál de ellas. */
function candidates(pos: Position, san: string): string[] {
	const match = PIECE_MOVE.exec(san)
	const to = match ? parseSquare(match[4]) : undefined
	if (!match || to === undefined) return []
	const [, piece, file, rank] = match
	const role: Role | undefined = charToRole(piece)
	const options: string[] = []
	for (const [from, dests] of pos.allDests()) {
		const square = makeSquare(from)
		if (pos.board.getRole(from) !== role || !dests.has(to)) continue
		if ((file && square[0] !== file) || (rank && square[1] !== rank)) continue
		options.push(makeSan(pos, { from, to }))
	}
	return options
}

/** Lee lo escrito en la posición `fen`. Se quitan los signos de detrás («+», «#», «!?»). */
export function readMove(fen: string, text: string): TypedMove {
	const typed = text.trim().replace(/[+#!?]+$/, '')
	if (!typed) return { kind: 'empty' }
	const pos = positionOf(fen)
	if (!pos) return { kind: 'illegal' }
	if (UCI.test(typed)) return readUci(pos, typed)
	const forms = spellings(typed)
	for (const san of forms) {
		const move = parseSan(pos, san)
		if (move) return { kind: 'move', uci: standardUci(pos, move) }
	}
	// Sin la pieza de la coronación («e8», «exd8»): con dama sería legal.
	for (const san of forms) {
		const move = parseSan(pos, `${san}q`)
		if (move && 'from' in move && promotes(pos, makeSquare(move.from), makeSquare(move.to))) {
			return { kind: 'promotion', orig: makeSquare(move.from), dest: makeSquare(move.to) }
		}
	}
	for (const san of forms) {
		const options = candidates(pos, san)
		if (options.length > 1) return { kind: 'ambiguous', options }
	}
	return { kind: 'illegal' }
}

/** Las jugadas legales de la posición en SAN, para las sugerencias del campo; las coronaciones, a las cuatro piezas. */
export function legalMoves(fen: string): string[] {
	const pos = positionOf(fen)
	if (!pos) return []
	const sans: string[] = []
	for (const [from, dests] of pos.allDests()) {
		for (const to of dests) {
			const roles = promotes(pos, makeSquare(from), makeSquare(to)) ? PROMOTION_ROLES : [undefined]
			for (const promotion of roles) sans.push(makeSan(pos, { from, to, promotion }))
		}
	}
	return sans
}

export interface MoveInputHost {
	/** La posición en la que se juega: la que se ve en el tablero. */
	fen(): string
	/** Juega la jugada (UCI estándar), legal en esa posición. */
	play(uci: string): void
}

/**
 * El formulario del campo. Las sugerencias se rellenan al entrar en el campo
 * y tras cada jugada (update), no en cada cambio de posición: con el foco en
 * otra parte no se ven. Tras jugar, el campo se vacía y se queda con el foco,
 * para escribir la siguiente; el visor ya anuncia la jugada.
 */
export class MoveInput {
	private readonly input: HTMLInputElement
	private readonly suggestions: HTMLDataListElement
	private readonly note: HTMLElement

	constructor(
		form: HTMLFormElement,
		private readonly dialog: HTMLDialogElement,
		private readonly host: MoveInputHost,
		signal: AbortSignal
	) {
		this.input = form.querySelector('input')!
		this.suggestions = form.querySelector('datalist')!
		this.note = form.querySelector('[role="status"]')!
		form.addEventListener(
			'submit',
			(event) => {
				event.preventDefault()
				void this.submit()
			},
			{ signal }
		)
		this.input.addEventListener('focus', () => this.suggest(), { signal })
		this.input.addEventListener('input', () => this.say(''), { signal })
	}

	/** La posición ha cambiado: sus sugerencias, si se está en el campo. */
	update(): void {
		if (document.activeElement === this.input) this.suggest()
	}

	/**
	 * Pone el foco en el campo, con las sugerencias ya puestas: si el datalist
	 * pasa de vacío a lleno con el foco dentro, Chrome desplaza la página hasta
	 * el campo aunque se pida preventScroll. En el explorador, tras escribir
	 * una jugada, el campo va detrás de la tabla, y en el móvil el tablero
	 * quedaba fuera de la vista.
	 */
	focus(options?: FocusOptions): void {
		this.suggest()
		this.input.focus(options)
	}

	private suggest(): void {
		this.suggestions.replaceChildren(...legalMoves(this.host.fen()).map((san) => new Option(san)))
	}

	private async submit(): Promise<void> {
		const fen = this.host.fen()
		const typed = this.input.value.trim()
		const read = readMove(fen, typed)
		let uci: string
		switch (read.kind) {
			case 'empty':
				return
			case 'illegal':
				return this.say(`«${typed}» no es una jugada legal en esta posición.`)
			case 'ambiguous':
				return this.say('Puede ser ', read.options)
			case 'promotion': {
				const pos = positionOf(fen)
				const role = pos ? await choosePromotion(this.dialog, pos.turn) : null
				if (!role) return
				uci = `${read.orig}${read.dest}${roleToChar(role)}`
				break
			}
			case 'move':
				uci = read.uci
		}
		// Mientras se elegía la pieza no se puede navegar (el diálogo es modal),
		// pero por si acaso: la jugada es de la posición en que se escribió.
		if (fen !== this.host.fen()) return
		this.input.value = ''
		this.say('')
		this.host.play(uci)
	}

	/**
	 * El aviso bajo el campo; vacío, sin aviso. Las jugadas, cada una en su
	 * .move-name con las figuras (fuera de la frase, cuyas mayúsculas no son
	 * piezas), separadas por comas y «o».
	 */
	private say(text: string, moves: string[] = []): void {
		const parts: (string | Node)[] = [text]
		moves.forEach((san, i) => {
			if (i > 0) parts.push(i === moves.length - 1 ? ' o ' : ', ')
			parts.push(Object.assign(document.createElement('span'), { className: 'move-name', textContent: san }))
		})
		if (moves.length > 0) parts.push('.')
		this.note.replaceChildren(...parts)
		// aria-invalid vacío vale «false»: hay que darle el valor.
		if (text) this.input.setAttribute('aria-invalid', 'true')
		else this.input.removeAttribute('aria-invalid')
	}
}
