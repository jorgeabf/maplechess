// <explorador-repertorio>: tablero del repertorio. La página funciona sin
// JavaScript (cada jugada es un enlace, y el servidor pinta el tablero con la
// posición); esto monta chessground en ese tablero, con una flecha al pasar
// por una jugada de la tabla y la posibilidad de mover piezas para ir a
// cualquier otra posición, también por transposición, y el análisis de
// Stockfish de la posición. Pulsar una de sus líneas juega su primera jugada,
// como moverla en el tablero.
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Config } from '@lichess-org/chessground/config'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { Chess, normalizeMove } from 'chessops/chess'
import { chessgroundDests } from 'chessops/compat'
import { parseFen } from 'chessops/fen'
import { parseUci, roleToChar } from 'chessops/util'
import { standardUci } from '../../lib/chess/uci'
import { MoveInput } from '../visor/campo-jugada'
import { choosePromotion, promotes } from '../visor/coronacion'
import { EnginePanel } from '../visor/panel-motor'

const squares = (uci: string): [Key, Key] => [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key]

function arrow(uci: string): { orig: Key; dest: Key } {
	const [orig, dest] = squares(uci)
	return { orig, dest }
}

/**
 * Ancla de la página que sigue a una jugada escrita en el campo: ningún
 * elemento la lleva, así que el navegador no se desplaza, y el explorador se
 * pone a la vista y devuelve el foco al campo para escribir la siguiente.
 */
const MOVE_INPUT_HASH = 'jugada'

class ExploradorRepertorio extends HTMLElement {
	private cg?: Api
	private panel?: EnginePanel
	/** Flecha de la jugada de la tabla señalada y de la mejor del motor. */
	private hoverShape: DrawShape | null = null
	private engineShape: DrawShape | null = null
	private abort = new AbortController()

	connectedCallback(): void {
		const fen = this.dataset.fen ?? ''
		const setup = parseFen(fen)
		if (setup.isErr) return
		const created = Chess.fromSetup(setup.value)
		if (created.isErr) return
		const pos = created.value
		const position = this.position(pos)
		const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

		this.cg = Chessground(this.querySelector<HTMLElement>('.board')!, {
			...position,
			animation: { enabled: !reducedMotion.matches },
			orientation: this.dataset.orientation === 'black' ? 'black' : 'white',
			coordinates: true,
			movable: {
				...position.movable,
				free: false,
				showDests: true,
				events: { after: (orig, dest) => void this.play(pos, orig, dest) }
			},
			premovable: { enabled: false },
			drawable: { enabled: false, visible: true }
		})

		const signal = this.abort.signal
		reducedMotion.addEventListener('change', () => this.cg?.set({ animation: { enabled: !reducedMotion.matches } }), {
			signal
		})
		this.addEventListener('pointerover', (event) => this.showArrow(event), { signal })
		this.addEventListener('focusin', (event) => this.showArrow(event), { signal })
		this.addEventListener('pointerleave', () => this.setHover(null), { signal })
		this.addEventListener('focusout', () => this.setHover(null), { signal })

		this.panel = new EnginePanel(
			this.querySelector<HTMLElement>('.engine')!,
			{
				// La mejor jugada, en el azul del visor; el verde es el de «ganada».
				onAnalysis: (view) => {
					this.engineShape = view?.best ? { ...arrow(view.best), brush: 'paleBlue' } : null
					this.drawShapes()
				},
				// Las líneas llevan su primera jugada en data-uci: al señalarlas, la
				// flecha gris de showArrow, como las jugadas de la tabla.
				onLine: this.movable ? (_fen, moves) => this.go(pos, moves[0].uci) : undefined
			},
			signal
		)
		this.panel.show(fen)
		this.panel.restore()

		// El campo para escribir jugadas no está en la última jugada del repertorio.
		const form = this.querySelector<HTMLFormElement>('[data-move-input]')
		if (!form) return
		const moveInput = new MoveInput(
			form,
			this.querySelector<HTMLDialogElement>('[data-promotion]')!,
			{ fen: () => fen, play: (uci) => this.go(pos, uci, MOVE_INPUT_HASH) },
			signal
		)
		if (location.hash === `#${MOVE_INPUT_HASH}`) {
			this.scrollIntoView()
			moveInput.focus({ preventScroll: true })
		}
	}

	disconnectedCallback(): void {
		this.abort.abort()
		this.panel?.destroy()
		this.cg?.destroy()
	}

	/** Al llegar a la última jugada del repertorio ya no se mueve (ni se pulsan las líneas del motor). */
	private get movable(): boolean {
		return this.dataset.movable !== 'false'
	}

	/**
	 * La posición de la página en el tablero: el FEN, el turno, el jaque, la
	 * última jugada y los destinos. Con ella se monta el tablero y se devuelve
	 * la pieza si se cancela la coronación: tras mover, chessground ya ha
	 * cambiado el turno y quitado los destinos.
	 */
	private position(pos: Chess): Config {
		const lastMove = this.dataset.lastMove
		return {
			fen: this.dataset.fen,
			turnColor: pos.turn,
			check: pos.isCheck(),
			lastMove: lastMove ? squares(lastMove) : undefined,
			movable: { color: this.movable ? pos.turn : undefined, dests: chessgroundDests(pos) }
		}
	}

	/** Flecha de la jugada de la tabla sobre la que está el puntero o el foco. */
	private showArrow(event: Event): void {
		const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-uci]') : null
		this.setHover(row?.dataset.uci ?? null)
	}

	/** En gris, para no confundirla con la del motor. */
	private setHover(uci: string | null): void {
		this.hoverShape = uci ? { ...arrow(uci), brush: 'paleGrey' } : null
		this.drawShapes()
	}

	private drawShapes(): void {
		this.cg?.setAutoShapes([this.engineShape, this.hoverShape].filter((s): s is DrawShape => s !== null))
	}

	/** Jugada hecha en el tablero: un peón que corona, a la pieza que se elija; si se cancela, vuelve. */
	private async play(pos: Chess, orig: Key, dest: Key): Promise<void> {
		const dialog = this.querySelector<HTMLDialogElement>('[data-promotion]')!
		const promotion = promotes(pos, orig, dest) ? await choosePromotion(dialog, pos.turn) : undefined
		if (promotion === null) this.cg?.set(this.position(pos))
		else this.go(pos, `${orig}${dest}${promotion ? roleToChar(promotion) : ''}`)
	}

	/**
	 * Se va a la página de la posición tras la jugada (UCI), si es legal, con
	 * el explorador en el mismo sitio (`hash`).
	 */
	private go(pos: Chess, uci: string, hash = this.id): void {
		const parsed = parseUci(uci)
		if (!parsed) return
		const move = normalizeMove(pos, parsed)
		if (!pos.isLegal(move)) return

		const url = new URL(location.href)
		const moves = this.dataset.moves ? this.dataset.moves.split(' ') : []
		url.searchParams.set('jugadas', [...moves, standardUci(pos, move)].join(' '))
		url.searchParams.delete('p')
		// Como los enlaces de la tabla: la página nueva se abre con el explorador en el mismo sitio.
		url.hash = hash
		location.assign(url)
	}
}

customElements.define('explorador-repertorio', ExploradorRepertorio)
