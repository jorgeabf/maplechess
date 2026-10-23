// <visor-partida>: tablero, navegación por jugadas y variantes, gráfico de la
// evaluación anotada y análisis con Stockfish. El árbol de jugadas (FEN de
// cada nodo, UCI, reloj…) llega ya calculado del servidor en un
// <script type="application/json">.
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { makeSquare } from 'chessops/util'
import type { ViewerNode } from '../../lib/chess/movetree'
import { annotatedScore, formatScore, sideToMove } from '../../lib/chess/uci'
import { enterVariation, exitVariation } from '../../lib/chess/variations'
import { formatMove } from '../../lib/format'
import { EnginePanel, type EngineView } from './panel-motor'

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

class VisorPartida extends HTMLElement {
	private nodes: ViewerNode[] = []
	private pgn = ''
	private current = 0
	private cg?: Api
	private panel?: EnginePanel
	private movesResize?: ResizeObserver
	private copiedTimer?: ReturnType<typeof setTimeout>
	/** Escritura pendiente de la jugada en la URL (URL_DELAY_MS). */
	private urlTimer?: ReturnType<typeof setTimeout>
	private engineShape: DrawShape | null = null
	private abort = new AbortController()

	private get movesBox(): HTMLElement {
		return this.querySelector('.moves')!
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
		this.cg = Chessground(this.querySelector<HTMLElement>('.board')!, {
			fen: this.nodes[0].fen,
			// El servidor ya ha ordenado las barras de los jugadores con este lado.
			orientation: this.dataset.orientation === 'black' ? 'black' : 'white',
			viewOnly: true,
			coordinates: true,
			animation: { enabled: !reducedMotion.matches, duration: 180 },
			drawable: { enabled: false, visible: true }
		})

		const signal = this.abort.signal
		reducedMotion.addEventListener('change', () => this.cg?.set({ animation: { enabled: !reducedMotion.matches } }), {
			signal
		})
		this.addEventListener('click', (event) => this.onClick(event), { signal })
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
				onAnalysis: (view) => this.showAnalysis(view)
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
	 * está, como en lichess. ↑, ↓, Inicio y Fin desplazan la página, así que
	 * sólo se toman con el foco en el tablero o la lista (tras pulsar una
	 * jugada o un botón), no en la barra de acciones de debajo. F también, y
	 * por otra razón: un atajo de una sola letra en toda la página lo puede
	 * disparar sin querer quien navega por voz o con un lector de pantalla
	 * (WCAG 2.1.4). En los campos las teclas son suyas; no en una casilla (el
	 * interruptor del motor), donde las flechas no hacen nada y el foco se
	 * queda al pulsarla.
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
	 * pan-y), que lo anula con pointercancel; un segundo dedo también.
	 */
	private listenSwipe(box: HTMLElement, signal: AbortSignal): void {
		let start: { id: number; x: number; y: number } | null = null
		box.addEventListener(
			'pointerdown',
			(event) => {
				start =
					event.pointerType === 'touch' && event.isPrimary
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

	private run(action: string): void {
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
			case 'copy-fen':
				return void this.copy(action, node.fen, 'FEN copiado')
			case 'copy-pgn':
				return void this.copy(action, this.pgn, 'PGN copiado')
			case 'copy-link':
				return void this.copy(action, this.currentLink(), 'Enlace copiado')
		}
	}

	/** Último nodo siguiendo la línea en la que se está. */
	private lastOf(id: number): number {
		let node = this.nodes[id]
		while (node.children.length > 0) node = this.nodes[node.children[0]]
		return node.id
	}

	/**
	 * Muestra un nodo: tablero, lista, gráfico, relojes y motor. La URL va
	 * después y con retardo (URL_DELAY_MS): si fallara antes, el motor seguiría
	 * con la posición anterior y pintaría su flecha en esta.
	 */
	private goTo(id: number, updateHash = true): void {
		const node = this.nodes[id]
		if (!node || !this.cg) return
		this.cancelUrl()
		this.current = id
		const turn = sideToMove(node.fen)
		this.cg.set({
			fen: node.fen,
			turnColor: turn,
			check: node.check,
			lastMove: node.uci ? [node.uci.slice(0, 2) as Key, node.uci.slice(2, 4) as Key] : undefined
		})
		this.engineShape = null
		this.drawShapes()
		this.markCurrent(id)
		this.showCurrent()
		this.markEnds(node)
		this.markChart(node)
		this.showClocks(node)
		this.panel?.show(node.fen)
		if (updateHash) this.urlTimer = setTimeout(() => this.writeUrl(), URL_DELAY_MS)
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
	 * acabar la línea en la que se está. aria-disabled y no disabled: el foco
	 * se queda en el botón (run() ya no hace nada en el extremo).
	 */
	private markEnds(node: ViewerNode): void {
		const atStart = node.parent < 0
		const atEnd = node.children.length === 0
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

	private drawShapes(): void {
		const node = this.nodes[this.current]
		const shapes: DrawShape[] = node.shapes.map((s) => ({
			orig: makeSquare(s.from) as Key,
			dest: s.from === s.to ? undefined : (makeSquare(s.to) as Key),
			// Los colores de las flechas del PGN son pinceles de chessground con el mismo nombre.
			brush: s.color
		}))
		if (this.engineShape) shapes.push(this.engineShape)
		this.cg?.setAutoShapes(shapes)
	}

	private flip(): void {
		this.cg?.toggleOrientation()
		this.dataset.orientation = this.dataset.orientation === 'black' ? 'white' : 'black'
	}

	/** Jugada actual, entre los botones. */
	private showCurrent(): void {
		const node = this.nodes[this.current]
		this.querySelector('[data-current]')!.textContent = node.id === 0 ? 'Inicio' : formatMove(node.ply, node.san)
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
