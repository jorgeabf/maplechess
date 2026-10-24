// Panel del motor: interruptor, estado y líneas de Stockfish. Lo usan el visor
// de partidas y el explorador del repertorio (marcado en PanelMotor.astro).
// Quien lo usa le dice qué posición mostrar y recibe la evaluación y la mejor
// jugada para pintarlas en su tablero y, si las líneas se pulsan, la que se
// pulsa.
import { formatScore, gameOver, whitePov, winningChances, type GameOver } from '../../lib/chess/uci'
import { formatLine } from '../../lib/format'
import type { Analysis, Engine } from './motor'
import { playLine, type LineMove } from './variante'

const ENGINE_PREF = 'visor:motor'
const PV_MOVES = 12

function readPref(): boolean {
	try {
		return localStorage.getItem(ENGINE_PREF) === '1'
	} catch {
		return false
	}
}

function writePref(on: boolean): void {
	try {
		localStorage.setItem(ENGINE_PREF, on ? '1' : '0')
	} catch {
		// Almacenamiento bloqueado (modo privado): la preferencia no se recuerda.
	}
}

/** «Stockfish 19 · profundidad 18», con «…» mientras busca. */
function depthStatus(depth: number, done: boolean): string {
	return `Stockfish 19 · profundidad ${depth}${done ? '' : '…'}`
}

export interface EngineView {
	/** De -1 (ganan negras) a 1 (ganan blancas). */
	winning: number
	/** Mejor jugada en UCI. */
	best: string | null
}

export interface EngineHandlers {
	/** Se enciende o se apaga. */
	onToggle?: (on: boolean) => void
	/** Nuevo análisis de la posición actual; null al apagarse. */
	onAnalysis: (view: EngineView | null) => void
	/**
	 * Se pulsa una línea: sus jugadas (las que se ven, PV_MOVES) desde `fen`.
	 * Sin él, las líneas son texto.
	 */
	onLine?: (fen: string, moves: LineMove[]) => void
}

/** Estado de una posición en la que ya no hay jugadas (gameOver). */
const GAME_OVER: Record<GameOver['reason'], (winning: number) => string> = {
	mate: (winning) => `Jaque mate: ganan las ${winning > 0 ? 'blancas' : 'negras'}`,
	stalemate: () => 'Rey ahogado: tablas',
	material: () => 'Tablas por material insuficiente'
}

export class EnginePanel {
	private engine?: Engine
	/** La carga del motor: una sola, aunque se encienda varias veces seguidas. */
	private loading?: Promise<Engine>
	private fen = ''
	/** Posición cuyo análisis terminó (por profundidad, por tiempo o con la partida acabada). */
	private analyzedFen = ''
	/** Posición que se analiza sin límite («Seguir analizando»): sin los topes del motor, hasta pasar a otra. */
	private infiniteFen = ''
	/** La posición y la profundidad de las líneas que se ven. */
	private shown = { fen: '', depth: 0 }
	/** Las jugadas de cada línea que se ve, para pulsarla. */
	private lines: LineMove[][] = []
	private on = false
	/** Cuenta los análisis pedidos: uno que llega tarde (otra posición, apagado) se descarta. */
	private request = 0
	private readonly toggle: HTMLInputElement
	private readonly infiniteButton: HTMLButtonElement

	constructor(
		private readonly root: HTMLElement,
		private readonly handlers: EngineHandlers,
		signal: AbortSignal
	) {
		this.toggle = root.querySelector<HTMLInputElement>('[data-engine-toggle]')!
		this.toggle.addEventListener('change', () => void this.setOn(this.toggle.checked), { signal })
		this.infiniteButton = root.querySelector<HTMLButtonElement>('[data-engine-infinite]')!
		this.infiniteButton.addEventListener('click', () => this.analyzeInfinite(), { signal })
		this.linesBox.addEventListener('click', (event) => this.onLineClick(event), { signal })
		document.addEventListener('visibilitychange', () => this.onVisibility(), { signal })
	}

	private get linesBox(): HTMLElement {
		return this.root.querySelector('.engine-lines')!
	}

	/** Enciende el motor si se dejó encendido la última vez. Después del primer show(). */
	restore(): void {
		if (readPref()) void this.setOn(true)
	}

	/** Posición que se muestra; con el motor encendido, la analiza. */
	show(fen: string): void {
		if (fen !== this.fen) this.infiniteFen = ''
		this.fen = fen
		if (this.on) void this.analyze()
	}

	destroy(): void {
		this.on = false
		this.request++
		// Uno que aún se está cargando, al llegar.
		if (this.engine) this.engine.destroy()
		else void this.loading?.then((engine) => engine.destroy(), () => undefined)
	}

	/**
	 * Con la pestaña oculta, el motor se para: si no, seguía con un núcleo al
	 * máximo hasta el tope (ENGINE_TIME_MS), y en un móvil cada vez que se
	 * cambiaba de aplicación. Las líneas se quedan como estaban y, al volver, se
	 * analiza otra vez la posición si no había terminado. Uno terminado no se
	 * repite: relanzarlo costaba casi lo mismo que la primera vez.
	 */
	private onVisibility(): void {
		if (!this.on) return
		if (document.hidden) this.engine?.stop()
		else if (this.analyzedFen !== this.fen) void this.analyze()
	}

	/** «Seguir analizando»: otra vez la posición, sin los topes. Ya puesto, está inactivo. */
	private analyzeInfinite(): void {
		if (this.infiniteFen === this.fen) return
		this.infiniteFen = this.fen
		// Ya no está terminado: con la pestaña oculta se para y, al volver, sigue.
		this.analyzedFen = ''
		void this.analyze()
	}

	/**
	 * Progreso del análisis: se ve, pero no se anuncia. Detrás, «Seguir
	 * analizando», cuando la búsqueda con topes ha terminado (`done`). Mientras
	 * sigue, el mismo botón, inactivo, dice «sin límite»: explica por qué ya no
	 * para y no pierde el foco al pulsarlo.
	 */
	private setStatus(text: string, done = false): void {
		this.root.querySelector('.engine-progress')!.textContent = text
		const infinite = this.infiniteFen === this.fen
		const more = this.infiniteButton.parentElement!
		// Con el foco en él al pasar de jugada (las flechas valen en toda la página), al interruptor.
		if (!(infinite || done) && more.contains(document.activeElement)) this.toggle.focus()
		more.hidden = !(infinite || done)
		this.infiniteButton.setAttribute('aria-disabled', String(infinite))
		this.infiniteButton.textContent = infinite ? 'sin límite' : 'Seguir analizando'
	}

	/** Aviso junto al interruptor; el lector de pantalla lo anuncia (role="status"). */
	private setError(text: string): void {
		this.root.querySelector('.engine-error')!.textContent = text
	}

	private async setOn(on: boolean): Promise<void> {
		this.on = on
		this.toggle.checked = on
		this.root.dataset.engine = on ? 'on' : 'off'
		writePref(on)
		this.handlers.onToggle?.(on)
		this.setError('')
		if (on) return this.analyze()
		this.request++
		this.engine?.stop()
		this.infiniteFen = ''
		this.shown = { fen: '', depth: 0 }
		this.setStatus('')
		this.clearLines()
		this.handlers.onAnalysis(null)
	}

	/**
	 * Analiza la posición actual o, si la partida ha terminado en ella, dice cómo.
	 * Otra vez la misma (sin límite, al volver a la pestaña), la búsqueda
	 * empieza de cero: lo que ya se ve se queda hasta que lo supere (showAnalysis).
	 */
	private async analyze(): Promise<void> {
		const request = ++this.request
		const fen = this.fen
		const again = fen === this.shown.fen && this.shown.depth > 0
		if (!again) {
			this.shown = { fen, depth: 0 }
			this.clearLines()
		}
		const over = gameOver(fen)
		if (over) {
			this.engine?.stop()
			this.analyzedFen = fen
			this.setStatus(GAME_OVER[over.reason](over.winning))
			this.handlers.onAnalysis({ winning: over.winning, best: null })
			return
		}
		const progress = again ? depthStatus(this.shown.depth, false) : 'Analizando…'
		this.setStatus(this.engine ? progress : 'Cargando Stockfish…')
		let engine: Engine
		try {
			engine = await this.load()
		} catch {
			return this.fail()
		}
		// Con la pestaña oculta (el motor ha tardado en cargar), al volver (onVisibility).
		if (request !== this.request || document.hidden) return
		this.setStatus(progress)
		engine.analyze(fen, this.infiniteFen === fen)
	}

	private load(): Promise<Engine> {
		// El módulo y el wasm (~1,9 MB) sólo se descargan si se activa el motor.
		this.loading ??= import('./motor').then(
			({ Engine }) => (this.engine = new Engine((analysis) => this.showAnalysis(analysis), () => this.fail()))
		)
		return this.loading
	}

	/**
	 * El motor no carga (el módulo o el Worker): se apaga, con la preferencia,
	 * para no volver a «Analizando…» en cada jugada, y lo dice. Al encenderlo
	 * otra vez se vuelve a intentar.
	 */
	private fail(): void {
		this.engine?.destroy()
		this.engine = undefined
		this.loading = undefined
		if (!this.on) return
		void this.setOn(false)
		this.setError('No se pudo cargar el motor')
	}

	private showAnalysis(analysis: Analysis): void {
		const fen = this.fen
		if (!this.on || analysis.fen !== fen) return
		const lines = analysis.lines.filter(Boolean)
		const best = lines[0]
		if (!best) return
		if (analysis.done) this.analyzedFen = fen
		// Menos profundo que lo que ya se ve, de una búsqueda que ha vuelto a empezar.
		if (analysis.depth < this.shown.depth) {
			if (analysis.done) this.setStatus(depthStatus(this.shown.depth, true), true)
			return
		}
		this.shown.depth = analysis.depth

		this.setStatus(depthStatus(analysis.depth, analysis.done), analysis.done)
		this.lines = lines.map((line) => playLine(fen, line.pv.slice(0, PV_MOVES)))
		this.renderLines(lines.map((line) => formatScore(whitePov(line.score, fen))))
		this.handlers.onAnalysis({ winning: winningChances(whitePov(best.score, fen)), best: best.pv[0] ?? null })
	}

	/**
	 * Pinta las líneas sobre las que ya hay, sin rehacerlas: llegan unas siete
	 * veces por segundo, y un botón nuevo bajo el puntero perdía el clic
	 * (pulsado en uno y soltado en otro) y el foco. Cada una, con su
	 * puntuación y sus jugadas en SAN con números, como la lista de jugadas:
	 * "34…Qxc3 35.Qa4". Las que se pulsan llevan su primera jugada (data-uci),
	 * para la flecha que la señala.
	 */
	private renderLines(scores: string[]): void {
		const box = this.linesBox
		this.lines.forEach((moves, i) => {
			const item = box.children[i] ?? box.appendChild(this.lineItem())
			const line = item.querySelector<HTMLElement>('.pv-line')!
			line.dataset.line = String(i)
			if (line instanceof HTMLButtonElement && moves[0]) line.dataset.uci = moves[0].uci
			line.querySelector('.score')!.textContent = scores[i]
			line.querySelector('.pv')!.textContent = formatLine(moves)
		})
		while (box.children.length > this.lines.length) box.lastElementChild!.remove()
	}

	/** Una línea: un botón si se pulsan (onLine) y, si no, texto. */
	private lineItem(): HTMLLIElement {
		const item = document.createElement('li')
		const line = document.createElement(this.handlers.onLine ? 'button' : 'span')
		if (line instanceof HTMLButtonElement) line.type = 'button'
		line.className = 'pv-line'
		const score = document.createElement('span')
		score.className = 'score'
		const pv = document.createElement('span')
		pv.className = 'pv'
		// El espacio no se ve (entre dos elementos de un flex) y separa la
		// puntuación de la primera jugada al leer el botón: «−1.03 17.Nf3…».
		line.append(score, ' ', pv)
		item.append(line)
		return item
	}

	/**
	 * Vacía las líneas al cambiar de posición o apagar el motor. Con el foco en
	 * una (las flechas valen en toda la página), al interruptor: si no, se
	 * perdería con ella.
	 */
	private clearLines(): void {
		if (this.linesBox.contains(document.activeElement)) this.toggle.focus()
		this.linesBox.replaceChildren()
		this.lines = []
	}

	private onLineClick(event: Event): void {
		const line = event.target instanceof Element ? event.target.closest<HTMLElement>('button[data-line]') : null
		const moves = line ? this.lines[Number(line.dataset.line)] : undefined
		if (moves?.length) this.handlers.onLine?.(this.shown.fen, moves)
	}
}
