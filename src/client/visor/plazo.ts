// Plazo que se para con la página oculta. iOS suspende la página, y su Worker,
// poco después de pasar a otra app; al volver, un setTimeout vencido salta
// enseguida, antes de que el Worker recién despertado haya podido avanzar. Sin
// DOM: quien lo usa le dice cuándo se oculta y cuándo vuelve.

/** Llama a `onExpire` cuando han corrido `ms` milisegundos entre resume() y pause(). */
export class VisibleDeadline {
	private timer?: ReturnType<typeof setTimeout>
	private left: number
	/** Desde cuándo corre (now()); undefined, parado. */
	private since?: number
	/** Vencido o cancelado: ya no vuelve a correr. */
	private done = false

	constructor(
		ms: number,
		private readonly onExpire: () => void,
		private readonly now: () => number = () => performance.now()
	) {
		this.left = ms
	}

	/** Empieza a correr o sigue con lo que le quedaba. */
	resume(): void {
		if (this.done || this.since !== undefined) return
		this.since = this.now()
		this.timer = setTimeout(() => this.expire(), Math.max(0, this.left))
	}

	pause(): void {
		if (this.since === undefined) return
		clearTimeout(this.timer)
		this.left -= this.now() - this.since
		this.since = undefined
	}

	cancel(): void {
		clearTimeout(this.timer)
		this.since = undefined
		this.done = true
	}

	private expire(): void {
		this.since = undefined
		this.done = true
		this.onExpire()
	}
}
