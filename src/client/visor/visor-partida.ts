// <visor-partida>: tablero, navegación por jugadas y variantes, gráfico de la
// evaluación anotada y análisis con Stockfish. El árbol de jugadas (FEN de
// cada nodo, UCI, reloj…) llega ya calculado del servidor en un
// <script type="application/json">. En el tablero se pueden mover las piezas
// para probar una idea, y pulsar una línea del motor para recorrerla: las dos
// cosas hacen una variante propia, que no se guarda ni cambia el PGN.
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { chessgroundDests } from 'chessops/compat'
import { makeSquare } from 'chessops/util'
import type { ViewerNode } from '../../lib/chess/movetree'
import { annotatedScore, formatScore, positionOf, sideToMove } from '../../lib/chess/uci'
import { enterVariation, exitVariation } from '../../lib/chess/variations'
import { formatMove } from '../../lib/format'
import { EnginePanel, type EngineView } from './panel-motor'
import { boardMove, extendVariant, type LineMove } from './variante'

/** "1:23:05" o "4:07" a partir de segundos. */
function formatClock(seconds: number): string {
	const s = Math.max(0, Math.round(seconds))
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const ss = String(s % 60).padStart(2, '0')
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Posición pedida en el enlace (#j12): id de nodo. */
function hashNode(): number | null {
	const match = /^#j(\d+)$/.exec(location.hash)
	return match ? Number(match[1]) : null
}

/**
 * La jugada se escribe en la URL cuando se deja de navegar, no en cada una:
 * Safari (y todo navegador en iOS) lanza una excepción tras 100 llamadas a
 * history.replaceState en 10 s (en 30 s hasta Safari 16), y Chrome deja de
 * hacerlas en silencio. Con la flecha pulsada se llegaba en unos segundos. Con
 * 300 ms entre escritura y escritura caben, como mucho, 34 en 10 s.
 */
const URL_DELAY_MS = 300

/** Lo que se ve en el tablero: un nodo de la partida o una jugada de la variante propia. */
type Shown = Pick<ViewerNode, 'ply' | 'san' | 'uci' | 'fen' | 'check' | 'comment'>

class VisorPartida extends HTMLElement {
	private nodes: ViewerNode[] = []
	private pgn = ''
	/** Nodo de la partida; dentro de la variante propia, del que sale. */
	private current = 0
	/** La variante propia: sale de `current`. Vacía fuera de ella. */
	private variant: LineMove[] = []
	/**
	 * Dónde se está en la variante: 0, la posición de la partida de la que
	 * sale; k, tras su jugada k. null fuera de ella.
	 */
	private step: number | null = null
	private cg?: Api
	private panel?: EnginePanel
	private movesResize?: ResizeObserver
	private copiedTimer?: ReturnType<typeof setTimeout>
	/** Escritura pendiente de la jugada en la URL (URL_DELAY_MS). */
	private urlTimer?: ReturnType<typeof setTimeout>
	private engineShape: DrawShape | null = null
	/** Flecha de la primera jugada de la línea del motor señalada. */
	private previewShape: DrawShape | null = null
	private abort = new AbortController()

	private get movesBox(): HTMLElement {
		return this.querySelector('.moves')!
	}

	private get variantBox(): HTMLElement {
		return this.querySelector('[data-variant]')!
	}

	private get shown(): Shown {
		return this.step ? this.variant[this.step - 1] : this.nodes[this.current]
	}

	connectedCallback(): void {
		const data = JSON.parse(this.querySelector('script[data-game]')?.textContent ?? '{"nodes":[],"pgn":""}') as {
			nodes: ViewerNode[]
			pgn: string
		}
		this.nodes = data.nodes
		this.pgn = data.pgn
		if (this.nodes.length === 0) return

		const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
		// Las piezas del bando que mueve se mueven (showPosition pone sus destinos):
		// como en el explorador del repertorio, se arrastran o se pulsan pieza y casilla.
		this.cg = Chessground(this.querySelector<HTMLElement>('.board')!, {
			fen: this.nodes[0].fen,
			// El servidor ya ha ordenado las barras de los jugadores con este lado.
			orientation: this.dataset.orientation === 'black' ? 'black' : 'white',
			coordinates: true,
			animation: { enabled: !reducedMotion.matches, duration: 180 },
			movable: { free: false, showDests: true, events: { after: (orig, dest) => this.onBoardMove(orig, dest) } },
			premovable: { enabled: false },
			drawable: { enabled: false, visible: true }
		})

		const signal = this.abort.signal
		reducedMotion.addEventListener('change', () => this.cg?.set({ animation: { enabled: !reducedMotion.matches } }), {
			signal
		})
		this.addEventListener('click', (event) => this.onClick(event), { signal })
		// La flecha de la línea del motor señalada, como la de las jugadas del explorador.
		this.addEventListener('pointerover', (event) => this.showPreview(event), { signal })
		this.addEventListener('focusin', (event) => this.showPreview(event), { signal })
		this.addEventListener('pointerleave', () => this.setPreview(null), { signal })
		this.addEventListener('focusout', () => this.setPreview(null), { signal })
		document.addEventListener('click', (event) => this.onBack(event), { signal })
		document.addEventListener('keydown', (event) => this.onKey(event), { signal })
		this.listenSwipe(this.querySelector<HTMLElement>('.board-box')!, signal)
		// Un enlace a otra jugada de la misma partida (o el historial) cambia el
		// #j. La jugada pendiente de escribir ya no vale: pisaría la entrada a la
		// que se acaba de llegar.
		window.addEventListener(
			'hashchange',
			() => {
				this.cancelUrl()
				const id = hashNode()
				if (id !== null && this.nodes[id] && id !== this.current) this.goTo(id, false)
			},
			{ signal }
		)
		// Al salir de la página, la jugada pendiente, para volver a ella con Atrás.
		window.addEventListener(
			'pagehide',
			() => {
				if (this.urlTimer !== undefined) this.writeUrl()
			},
			{ signal }
		)
		this.panel = new EnginePanel(
			this.querySelector<HTMLElement>('.engine')!,
			{
				onToggle: (on) => (this.dataset.engine = on ? 'on' : 'off'),
				onAnalysis: (view) => this.showAnalysis(view),
				// Una línea de la posición que se ve (si llega tarde, de otra, nada).
				onLine: (fen, moves) => {
					if (fen === this.shown.fen) this.play(moves)
				}
			},
			signal
		)
		// En dos columnas la lista llena el alto que deja el resto: al encender
		// el motor o cambiar la ventana encoge, y la jugada actual quedaría fuera.
		this.movesResize = new ResizeObserver(() => this.revealCurrent())
		this.movesResize.observe(this.movesBox)

		// Posición del enlace (#j12) o, si no, el final de la partida.
		const fromHash = hashNode()
		this.goTo(fromHash !== null && this.nodes[fromHash] ? fromHash : this.lastOf(0), false)
		this.panel.restore()
	}

	disconnectedCallback(): void {
		this.abort.abort()
		clearTimeout(this.copiedTimer)
		this.cancelUrl()
		this.movesResize?.disconnect()
		this.panel?.destroy()
		this.cg?.destroy()
	}

	private onClick(event: Event): void {
		const target = event.target
		if (!(target instanceof Element)) return
		// Botones de la lista y franjas del gráfico de evaluación (SVG). Pulsar
		// una jugada le da el foco: Safari no enfoca los botones al hacer clic,
		// y sin foco en la lista no irían ↑, ↓ ni F (onKey).
		const move = target.closest<HTMLElement | SVGElement>('[data-node]')
		if (move) {
			if (move instanceof HTMLElement) move.focus({ preventScroll: true })
			this.goTo(Number(move.dataset.node))
			return
		}
		// Las jugadas de la variante propia, en su franja.
		const step = target.closest<HTMLElement>('[data-step]')
		if (step) {
			step.focus({ preventScroll: true })
			this.stepTo(Number(step.dataset.step))
			return
		}
		const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
		if (action) this.run(action)
	}

	/**
	 * «← Volver a …», en la cabecera de la página, fuera del visor: si lleva a
	 * la página de antes, con el historial, que la deja donde estaba y no la
	 * vuelve a pedir (el dossier y el repertorio leen todas las partidas del
	 * jugador). Abierta en otra pestaña no hay historial, y Ctrl o Mayús abren
	 * el enlace aparte.
	 */
	private onBack(event: MouseEvent): void {
		const target = event.target
		if (!(target instanceof Element)) return
		const back = target.closest<HTMLAnchorElement>('a[data-back]')
		const modified = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
		if (back && !modified && document.referrer === back.href && history.length > 1) {
			event.preventDefault()
			history.back()
		}
	}

	/**
	 * Atajos. ← y → valen en toda la página, que no los usa para nada; con
	 * Mayús, entran en la variante que sale de la posición y salen de la que se
	 * está, como en lichess (de la propia, a la partida: run). ↑, ↓, Inicio y
	 * Fin desplazan la página, así que sólo se toman con el foco en el tablero
	 * o la lista (tras pulsar una jugada o un botón), no en la barra de
	 * acciones de debajo. F también, y por otra razón: un atajo de una sola
	 * letra en toda la página lo puede disparar sin querer quien navega por
	 * voz o con un lector de pantalla (WCAG 2.1.4). En los campos las teclas
	 * son suyas; no en una casilla (el interruptor del motor), donde las
	 * flechas no hacen nada y el foco se queda al pulsarla.
	 */
	private onKey(event: KeyboardEvent): void {
		if (event.altKey || event.ctrlKey || event.metaKey) return
		const target = event.target
		if (target instanceof Element && target.closest("input:not([type='checkbox']), select, textarea, [contenteditable]")) {
			return
		}
		const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
		const arrows = event.shiftKey ? { ArrowLeft: 'exit', ArrowRight: 'enter' } : { ArrowLeft: 'prev', ArrowRight: 'next' }
		const global: Record<string, string> = arrows
		const inside: Record<string, string> = { ArrowUp: 'first', Home: 'first', ArrowDown: 'last', End: 'last', f: 'flip' }
		const inBoard = target instanceof Element && this.contains(target) && target.closest('.board-col, .side') !== null
		const action = global[key] ?? (inBoard ? inside[key] : undefined)
		if (!action) return
		event.preventDefault()
		this.run(action)
	}

	/**
	 * Deslizar el dedo sobre el tablero: hacia la izquierda, la jugada
	 * siguiente (como al pasar página); hacia la derecha, la anterior. Una
	 * jugada por gesto. El gesto vertical es del navegador (touch-action:
	 * pan-y), que lo anula con pointercancel; un segundo dedo también. El que
	 * empieza en una pieza que se puede mover, o con una ya elegida, es de
	 * chessground: arrastra la pieza o la juega (onlyBoard).
	 */
	private listenSwipe(box: HTMLElement, signal: AbortSignal): void {
		let start: { id: number; x: number; y: number } | null = null
		box.addEventListener(
			'pointerdown',
			(event) => {
				start =
					event.pointerType === 'touch' && event.isPrimary && !this.onlyBoard(event)
						? { id: event.pointerId, x: event.clientX, y: event.clientY }
						: null
			},
			{ signal }
		)
		box.addEventListener(
			'pointerup',
			(event) => {
				if (!start || event.pointerId !== start.id) return
				const dx = event.clientX - start.x
				const dy = event.clientY - start.y
				start = null
				if (Math.abs(dx) < Math.max(40, box.clientWidth / 8) || Math.abs(dx) <= 1.5 * Math.abs(dy)) return
				this.run(dx < 0 ? 'next' : 'prev')
			},
			{ signal }
		)
		box.addEventListener('pointercancel', () => (start = null), { signal })
	}

	/**
	 * El gesto es para mover: empieza en una pieza del bando que mueve o con
	 * una pieza elegida (tocar una casilla de destino la juega). Medido en
	 * 1.405 posiciones de 15 partidas, deslizar sigue valiendo en el 76 % del
	 * tablero en la apertura, el 82 % en el medio juego y el 92 % en el final.
	 */
	private onlyBoard(event: PointerEvent): boolean {
		const state = this.cg?.state
		if (!this.cg || !state) return false
		if (state.selected) return true
		const key = this.cg.getKeyAtDomPos([event.clientX, event.clientY])
		const piece = key ? state.pieces.get(key) : undefined
		return piece !== undefined && piece.color === state.movable.color
	}

	/**
	 * Botones y atajos. Dentro de la variante propia, la navegación la recorre
	 * (runInVariant); girar y copiar, igual que en la partida.
	 */
	private run(action: string): void {
		if (this.step !== null && this.runInVariant(action, this.step)) return
		const node = this.nodes[this.current]
		switch (action) {
			case 'first':
				return this.goTo(0)
			case 'prev':
				return node.parent >= 0 ? this.goTo(node.parent) : undefined
			case 'next':
				return node.children.length > 0 ? this.goTo(node.children[0]) : undefined
			case 'enter': {
				const id = enterVariation(this.nodes, this.current)
				return id === null ? undefined : this.goTo(id)
			}
			case 'exit': {
				const id = exitVariation(this.nodes, this.current)
				return id === null ? undefined : this.goTo(id)
			}
			case 'last':
				return this.goTo(this.lastOf(this.current))
			case 'flip':
				return this.flip()
			// La posición del tablero, también la de la variante propia. El PGN es
			// el de la partida, sin ella, y el enlace, el de la jugada de la que sale.
			case 'copy-fen':
				return void this.copy(action, this.shown.fen, 'FEN copiado')
			case 'copy-pgn':
				return void this.copy(action, this.pgn, 'PGN copiado')
			case 'copy-link':
				return void this.copy(action, this.currentLink(), 'Enlace copiado')
		}
	}

	/**
	 * La navegación dentro de la variante propia: del principio (la posición
	 * de la partida de la que sale) a su última jugada. Mayús+← y «Volver a la
	 * partida» salen a esa posición, y Mayús+→ no hace nada. false si la
	 * acción no es de navegar.
	 */
	private runInVariant(action: string, step: number): boolean {
		const steps: Record<string, number> = {
			first: 0,
			prev: Math.max(0, step - 1),
			next: Math.min(this.variant.length, step + 1),
			last: this.variant.length
		}
		if (action in steps) {
			if (steps[action] !== step) this.stepTo(steps[action])
			return true
		}
		if (action === 'exit' || action === 'leave-variant') {
			this.goTo(this.current)
			return true
		}
		return action === 'enter'
	}

	/** Último nodo siguiendo la línea en la que se está. */
	private lastOf(id: number): number {
		let node = this.nodes[id]
		while (node.children.length > 0) node = this.nodes[node.children[0]]
		return node.id
	}

	/**
	 * Muestra un nodo de la partida (y sale de la variante propia, si se estaba
	 * en ella): lista, gráfico, relojes y la posición (showPosition). La URL va
	 * después y con retardo (URL_DELAY_MS): si fallara antes, el motor seguiría
	 * con la posición anterior y pintaría su flecha en esta.
	 */
	private goTo(id: number, updateHash = true): void {
		const node = this.nodes[id]
		if (!node || !this.cg) return
		this.cancelUrl()
		// La franja de la variante se oculta: si el foco estaba en ella, a la lista.
		const inVariant = this.variantBox.contains(document.activeElement)
		this.current = id
		this.variant = []
		this.step = null
		this.renderVariant()
		this.markCurrent(id)
		if (inVariant) this.focusCurrent()
		this.markChart(node)
		this.showClocks(node)
		this.showPosition()
		if (updateHash) this.urlTimer = setTimeout(() => this.writeUrl(), URL_DELAY_MS)
	}

	/**
	 * Va a la jugada `step` de la variante propia (0, la posición de la partida
	 * de la que sale). La lista, el gráfico, los relojes y la URL se quedan en
	 * esa posición de la partida.
	 */
	private stepTo(step: number): void {
		this.step = step
		this.markStep()
		this.showPosition()
	}

	/**
	 * Jugadas nuevas desde lo que se ve: una, hecha en el tablero, o una línea
	 * del motor. Si la primera es la de la partida (o una variante del PGN),
	 * se sigue la partida. Si no, entran en la variante propia, que empieza o
	 * cambia desde aquí, y se va a la primera. Con el foco en la línea del
	 * motor pulsada o en las jugadas de la franja, que se rehacen, el foco
	 * pasa a la jugada actual: si no, se perdería con ellas.
	 */
	private play(moves: LineMove[]): void {
		const [first] = moves
		if (!first) return
		const active = document.activeElement
		const follow = active instanceof Element && active.closest('.engine-lines, [data-variant-moves]') !== null
		const step = this.step ?? 0
		const child =
			step === 0 ? this.nodes[this.current].children.find((id) => this.nodes[id].uci === first.uci) : undefined
		if (child !== undefined) {
			this.goTo(child)
		} else {
			this.variant = extendVariant(this.variant, step, moves)
			this.renderVariant()
			this.stepTo(step + 1)
		}
		if (follow) this.focusCurrent()
	}

	/**
	 * Jugada hecha en el tablero. Los destinos ya son los legales: si aun así
	 * no lo fuera, el tablero vuelve a la posición.
	 */
	private onBoardMove(orig: Key, dest: Key): void {
		const move = boardMove(this.shown.fen, orig, dest)
		if (move) this.play([move])
		else this.cg?.set({ fen: this.shown.fen })
	}

	/** El foco, en la jugada actual: la de la franja dentro de la variante y, si no, la de la lista. */
	private focusCurrent(): void {
		const box = this.step === null ? this.movesBox : this.variantBox
		box.querySelector<HTMLElement>('.move[tabindex="0"]')?.focus({ preventScroll: true })
	}

	/**
	 * La posición que se ve en el tablero, sus destinos (se mueve el bando al
	 * que le toca), la jugada actual, los extremos de los botones y el motor.
	 */
	private showPosition(): void {
		const shown = this.shown
		const pos = positionOf(shown.fen)
		const turn = sideToMove(shown.fen)
		this.cg?.set({
			fen: shown.fen,
			turnColor: turn,
			check: shown.check,
			lastMove: shown.uci ? [shown.uci.slice(0, 2) as Key, shown.uci.slice(2, 4) as Key] : undefined,
			movable: { color: pos ? turn : undefined, dests: pos ? chessgroundDests(pos) : new Map() }
		})
		this.engineShape = null
		this.previewShape = null
		this.drawShapes()
		this.showCurrent()
		this.markEnds()
		this.panel?.show(shown.fen)
	}

	/**
	 * La jugada actual en la URL (#j12; la inicial, sin nada), para recargar o
	 * volver a ella. Si el navegador limita la llamada, sólo se queda atrás la
	 * URL: «Copiar enlace» no la lee (currentLink).
	 */
	private writeUrl(): void {
		this.cancelUrl()
		try {
			history.replaceState(null, '', this.current === 0 ? location.pathname + location.search : `#j${this.current}`)
		} catch {
			// SecurityError por exceso de llamadas: la siguiente jugada lo vuelve a intentar.
		}
	}

	private cancelUrl(): void {
		clearTimeout(this.urlTimer)
		this.urlTimer = undefined
	}

	/**
	 * Marca la jugada actual en la lista. Es también la única jugada a la que
	 * llega el tabulador (tabindex itinerante; las demás, con ← y →): con una
	 * parada por jugada, para llegar a la barra de debajo había que pasar por
	 * todas. Si el foco estaba en la lista, la sigue. En la posición inicial no
	 * hay botón: la parada es la primera jugada.
	 */
	private markCurrent(id: number): void {
		const box = this.movesBox
		const focused = box.contains(document.activeElement)
		box.querySelector('[aria-current]')?.removeAttribute('aria-current')
		box.querySelector('.move[tabindex="0"]')?.setAttribute('tabindex', '-1')
		const button = box.querySelector<HTMLElement>(`[data-node="${id}"]`)
		button?.setAttribute('aria-current', 'true')
		const stop = button ?? box.querySelector<HTMLElement>('.move')
		stop?.setAttribute('tabindex', '0')
		if (focused) stop?.focus({ preventScroll: true })
		this.revealCurrent()
	}

	/**
	 * Inicio y anterior, inactivos en la posición inicial; siguiente y final, al
	 * acabar la línea en la que se está. Dentro de la variante propia, en sus
	 * extremos. aria-disabled y no disabled: el foco se queda en el botón
	 * (run() ya no hace nada en el extremo).
	 */
	private markEnds(): void {
		const node = this.nodes[this.current]
		const atStart = this.step === null ? node.parent < 0 : this.step === 0
		const atEnd = this.step === null ? node.children.length === 0 : this.step === this.variant.length
		const ends: Record<string, boolean> = { first: atStart, prev: atStart, next: atEnd, last: atEnd }
		for (const [action, end] of Object.entries(ends)) {
			const button = this.querySelector(`.controls [data-action="${action}"]`)
			if (end) button?.setAttribute('aria-disabled', 'true')
			else button?.removeAttribute('aria-disabled')
		}
	}

	/** Desplaza sólo la lista (no la página) para que la jugada actual se vea. */
	private revealCurrent(): void {
		const box = this.movesBox
		const button = box.querySelector('[aria-current]')
		if (!button) {
			box.scrollTop = 0
			return
		}
		const b = box.getBoundingClientRect()
		const r = button.getBoundingClientRect()
		if (r.top < b.top) box.scrollTop -= b.top - r.top + 8
		else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8
	}

	/**
	 * Cursor del gráfico de evaluación en la jugada actual, si está en él (sólo
	 * tiene la línea principal), y la evaluación anotada de esa jugada.
	 */
	private markChart(node: ViewerNode): void {
		const chart = this.querySelector('.eval-chart')
		if (!chart) return
		const band = chart.querySelector(`[data-node="${node.id}"]`)
		const cursor = chart.querySelector('.cursor')
		if (cursor) {
			const x = band ? String(Number(band.getAttribute('x')) + 0.5) : '0'
			cursor.setAttribute('x1', x)
			cursor.setAttribute('x2', x)
			cursor.toggleAttribute('data-visible', band !== null)
		}
		const note = chart.querySelector('.eval-note')
		if (note) note.textContent = node.eval ? `: ${formatScore(annotatedScore(node.eval))} tras esta jugada` : ''
	}

	/** Reloj de cada bando: el de su última jugada hasta esta posición. */
	private showClocks(node: ViewerNode): void {
		const clocks: Record<'white' | 'black', number | undefined> = { white: undefined, black: undefined }
		for (let n: ViewerNode | undefined = node; n && n.id !== 0; n = this.nodes[n.parent]) {
			const color = n.ply % 2 === 1 ? 'white' : 'black'
			if (clocks[color] === undefined && n.clock !== undefined) clocks[color] = n.clock
			if (clocks.white !== undefined && clocks.black !== undefined) break
		}
		for (const color of ['white', 'black'] as const) {
			const el = this.querySelector(`[data-clock="${color}"]`)
			if (el) el.textContent = clocks[color] === undefined ? '' : formatClock(clocks[color])
		}
	}

	/** Las flechas del PGN (en una jugada de la variante propia, ninguna), la del motor y la de la línea señalada. */
	private drawShapes(): void {
		const annotated = this.step ? [] : this.nodes[this.current].shapes
		const shapes: DrawShape[] = annotated.map((s) => ({
			orig: makeSquare(s.from) as Key,
			dest: s.from === s.to ? undefined : (makeSquare(s.to) as Key),
			// Los colores de las flechas del PGN son pinceles de chessground con el mismo nombre.
			brush: s.color
		}))
		if (this.engineShape) shapes.push(this.engineShape)
		if (this.previewShape) shapes.push(this.previewShape)
		this.cg?.setAutoShapes(shapes)
	}

	/** Flecha de la línea del motor sobre la que está el puntero o el foco (data-uci, panel-motor.ts). */
	private showPreview(event: Event): void {
		const line = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-uci]') : null
		this.setPreview(line?.dataset.uci ?? null)
	}

	/** En gris, como la vista previa del explorador: el azul es la mejor jugada. */
	private setPreview(uci: string | null): void {
		const shape: DrawShape | null = uci
			? { orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush: 'paleGrey' }
			: null
		if (shape?.orig === this.previewShape?.orig && shape?.dest === this.previewShape?.dest) return
		this.previewShape = shape
		this.drawShapes()
	}

	private flip(): void {
		this.cg?.toggleOrientation()
		this.dataset.orientation = this.dataset.orientation === 'black' ? 'white' : 'black'
	}

	/**
	 * Jugada actual, entre los botones, y su comentario debajo (sólo en las
	 * partidas con comentarios). El comentario va también en la jugada, oculto
	 * a la vista: es la región viva, así que se anuncia con ella en cualquier
	 * ancho, y la línea de debajo queda fuera del árbol de accesibilidad.
	 */
	private showCurrent(): void {
		const shown = this.shown
		const current = this.querySelector('[data-current]')!
		current.textContent = shown.uci ? formatMove(shown.ply, shown.san) : 'Inicio'
		// Las jugadas de la variante propia también dicen que no son de la partida.
		const spoken = this.step ? 'Variante propia' : shown.comment
		if (spoken) {
			const hidden = document.createElement('span')
			hidden.className = 'visually-hidden'
			hidden.textContent = `. ${spoken}`
			current.append(hidden)
		}
		const note = this.querySelector('[data-note]')
		if (note) note.textContent = shown.comment ?? ''
	}

	/**
	 * La franja de la variante propia, con sus jugadas: se pinta al empezarla o
	 * cambiarla (play), y se oculta fuera de ella. Los números, como en la
	 * lista: el de cada jugada de las blancas y, si empieza por una de las
	 * negras, el suyo («16…»).
	 */
	private renderVariant(): void {
		const box = this.variantBox
		box.hidden = this.variant.length === 0
		const items: HTMLElement[] = []
		this.variant.forEach((move, i) => {
			if (move.ply % 2 === 1 || i === 0) {
				const label = document.createElement('span')
				label.className = 'num-label'
				label.textContent = formatMove(move.ply, '')
				items.push(label)
			}
			const button = document.createElement('button')
			button.type = 'button'
			button.className = 'move'
			button.dataset.step = String(i + 1)
			button.tabIndex = -1
			button.textContent = move.san
			items.push(button)
		})
		box.querySelector('[data-variant-moves]')!.replaceChildren(...items)
	}

	/**
	 * Marca la jugada actual de la variante en su franja, con el mismo tabindex
	 * itinerante que la lista (markCurrent): sólo ella está en el tabulador y,
	 * si el foco estaba en las jugadas, la sigue. En la posición de la que
	 * sale, la parada es la primera.
	 */
	private markStep(): void {
		const box = this.variantBox.querySelector<HTMLElement>('[data-variant-moves]')!
		const focused = box.contains(document.activeElement)
		box.querySelector('[aria-current]')?.removeAttribute('aria-current')
		box.querySelector('.move[tabindex="0"]')?.setAttribute('tabindex', '-1')
		const button = box.querySelector<HTMLElement>(`[data-step="${this.step}"]`)
		button?.setAttribute('aria-current', 'true')
		const stop = button ?? box.querySelector<HTMLElement>('.move')
		stop?.setAttribute('tabindex', '0')
		if (focused) stop?.focus({ preventScroll: true })
	}

	/**
	 * Enlace a lo que se ve: esta jugada y, con el tablero girado, desde
	 * negras. Girar no toca la URL, así que no basta con location.href.
	 */
	private currentLink(): string {
		const color = this.dataset.orientation === 'black' ? '?color=black' : ''
		const hash = this.current === 0 ? '' : `#j${this.current}`
		return `${location.origin}${location.pathname}${color}${hash}`
	}

	/** Copia `text` y lo avisa encima del botón de `action` durante 2 s. */
	private async copy(action: string, text: string, done: string): Promise<void> {
		const notice = this.querySelector(`[data-action="${action}"] + .copied`)
		if (!notice) return
		let message = done
		try {
			await navigator.clipboard.writeText(text)
		} catch {
			message = 'No se pudo copiar'
		}
		clearTimeout(this.copiedTimer)
		for (const other of this.querySelectorAll('.copied')) other.textContent = ''
		notice.textContent = message
		this.copiedTimer = setTimeout(() => (notice.textContent = ''), 2000)
	}

	/** Barra de evaluación y flecha de la mejor jugada del motor. */
	private showAnalysis(view: EngineView | null): void {
		if (view) this.style.setProperty('--eval', String(view.winning))
		this.engineShape = view?.best
			? { orig: view.best.slice(0, 2) as Key, dest: view.best.slice(2, 4) as Key, brush: 'paleBlue' }
			: null
		this.drawShapes()
	}
}

customElements.define('visor-partida', VisorPartida)
