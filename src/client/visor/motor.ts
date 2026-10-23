// Stockfish en un Web Worker, hablando UCI.
//
// Usa la build de un hilo (public/engine/<versión>/stockfish.js + .wasm), que
// no necesita cabeceras COOP/COEP. Sólo puede haber una búsqueda a la vez: al
// cambiar de posición se manda "stop" y se espera al "bestmove" antes de
// empezar la siguiente, para no mezclar líneas de dos posiciones.
import { version } from 'stockfish/package.json'
import { parseInfo, type UciInfo } from '../../lib/chess/uci'
import { VisibleDeadline } from './plazo'

/** La carpeta es la versión del paquete (scripts/copy-engine.mjs): se cachea como inmutable. */
const ENGINE_URL = `/engine/${version}/stockfish.js`
export const ENGINE_DEPTH = 22
/**
 * Tope de cada búsqueda: para en la profundidad o en el tiempo, lo que llegue
 * antes. Con un hilo, la profundidad 22 de una posición táctica eran 34 s en
 * escritorio, y en un móvil, de uno a dos minutos con un núcleo al máximo. En
 * 10 s se llega a la 18–22 en escritorio.
 */
export const ENGINE_TIME_MS = 10_000
export const ENGINE_LINES = 3

/**
 * Tiempo para arrancar: descargar y compilar el wasm (~1,9 MB). Si el wasm
 * falla, stockfish.js lo deja en una promesa sin capturar dentro del Worker,
 * que no llega a onerror: un motor que no ha dicho «readyok» en este tiempo se
 * da por perdido. Sólo cuenta con la página visible: si se cambia de app
 * mientras carga, iOS suspende la página y el Worker, y al volver el plazo ya
 * habría vencido antes de que el Worker pudiera terminar.
 */
const START_TIMEOUT_MS = 30_000

export interface Analysis {
	fen: string
	depth: number
	/** Una por variante (MultiPV), ordenadas de mejor a peor. */
	lines: UciInfo[]
	done: boolean
}

type State = 'starting' | 'idle' | 'searching' | 'stopping'

export class Engine {
	private worker: Worker
	private state: State = 'starting'
	private pending: { fen: string; infinite: boolean } | null = null
	private current: Analysis | null = null
	private readonly startDeadline = new VisibleDeadline(START_TIMEOUT_MS, () => this.fail())
	/** Lo que sólo hace falta mientras arranca: parar el plazo con la página oculta. */
	private readonly starting = new AbortController()

	/** `onError`: el Worker no carga (un 404 del script, el wasm) o falla. */
	constructor(
		private readonly onUpdate: (analysis: Analysis) => void,
		private readonly onError: () => void
	) {
		this.worker = new Worker(ENGINE_URL)
		this.worker.onmessage = (event: MessageEvent<string>) => this.receive(String(event.data))
		this.worker.onerror = () => this.fail()
		this.worker.onmessageerror = () => this.fail()
		document.addEventListener(
			'visibilitychange',
			() => (document.hidden ? this.startDeadline.pause() : this.startDeadline.resume()),
			{ signal: this.starting.signal }
		)
		if (!document.hidden) this.startDeadline.resume()
		this.send('uci')
	}

	/**
	 * Analiza una posición; sustituye a la que se estuviera analizando. Con
	 * `infinite`, sin los topes: sigue hasta que se pare o se pida otra, y no
	 * llega a `done`.
	 */
	analyze(fen: string, infinite = false): void {
		this.pending = { fen, infinite }
		if (this.state === 'idle') this.startPending()
		else if (this.state === 'searching') this.stopSearch()
	}

	/** Detiene la búsqueda en curso (el motor sigue cargado). */
	stop(): void {
		this.pending = null
		if (this.state === 'searching') this.stopSearch()
	}

	destroy(): void {
		this.started()
		this.worker.terminate()
	}

	private fail(): void {
		this.started()
		this.onError()
	}

	/** Se acaba el arranque: ha dicho «readyok», ha fallado o se cierra. */
	private started(): void {
		this.startDeadline.cancel()
		this.starting.abort()
	}

	private send(command: string): void {
		this.worker.postMessage(command)
	}

	private stopSearch(): void {
		this.state = 'stopping'
		this.send('stop')
	}

	private startPending(): void {
		const next = this.pending
		if (!next) {
			this.state = 'idle'
			return
		}
		this.pending = null
		this.state = 'searching'
		this.current = { fen: next.fen, depth: 0, lines: [], done: false }
		this.send(`position fen ${next.fen}`)
		this.send(next.infinite ? 'go infinite' : `go depth ${ENGINE_DEPTH} movetime ${ENGINE_TIME_MS}`)
	}

	private receive(line: string): void {
		if (line === 'uciok') {
			this.send(`setoption name MultiPV value ${ENGINE_LINES}`)
			this.send('setoption name Hash value 32')
			this.send('isready')
		} else if (line === 'readyok') {
			this.started()
			if (this.state === 'starting') this.startPending()
		} else if (line.startsWith('bestmove')) {
			if (this.state === 'searching' && this.current) {
				this.current.done = true
				this.onUpdate(this.current)
			}
			this.state = 'idle'
			this.startPending()
		} else if (line.startsWith('info') && this.state === 'searching' && this.current) {
			const info = parseInfo(line)
			if (!info || info.bound) return
			const analysis = this.current
			analysis.lines[info.multipv - 1] = info
			// Al empezar una profundidad nueva llegan primero las líneas 1, 2, 3 de
			// esa profundidad: se publica cuando la mejor ya la ha alcanzado.
			analysis.depth = analysis.lines[0]?.depth ?? info.depth
			this.onUpdate(analysis)
		}
	}
}
