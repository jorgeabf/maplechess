import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VisibleDeadline } from '../src/client/visor/plazo'

describe('VisibleDeadline', () => {
	// El reloj del plazo y los temporizadores, a mano y a la vez.
	let clock = 0
	const pass = (ms: number) => {
		clock += ms
		vi.advanceTimersByTime(ms)
	}

	beforeEach(() => {
		clock = 0
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('vence cuando ha corrido el plazo entero', () => {
		const onExpire = vi.fn()
		new VisibleDeadline(30_000, onExpire, () => clock).resume()
		pass(29_999)
		expect(onExpire).not.toHaveBeenCalled()
		pass(1)
		expect(onExpire).toHaveBeenCalledOnce()
	})

	it('no cuenta el tiempo parado (la página oculta)', () => {
		const onExpire = vi.fn()
		const deadline = new VisibleDeadline(30_000, onExpire, () => clock)
		deadline.resume()
		pass(20_000)
		deadline.pause()
		pass(60_000)
		expect(onExpire).not.toHaveBeenCalled()
		deadline.resume()
		pass(9_999)
		expect(onExpire).not.toHaveBeenCalled()
		pass(1)
		expect(onExpire).toHaveBeenCalledOnce()
	})

	it('no empieza hasta resume(): creado con la página oculta', () => {
		const onExpire = vi.fn()
		const deadline = new VisibleDeadline(30_000, onExpire, () => clock)
		pass(60_000)
		deadline.pause()
		expect(onExpire).not.toHaveBeenCalled()
		deadline.resume()
		pass(30_000)
		expect(onExpire).toHaveBeenCalledOnce()
	})

	it('dos resume() seguidos no adelantan ni duplican el plazo', () => {
		const onExpire = vi.fn()
		const deadline = new VisibleDeadline(30_000, onExpire, () => clock)
		deadline.resume()
		pass(10_000)
		deadline.resume()
		pass(19_999)
		expect(onExpire).not.toHaveBeenCalled()
		pass(1)
		pass(60_000)
		expect(onExpire).toHaveBeenCalledOnce()
	})

	it('cancelado no vence, ni aunque vuelva a correr', () => {
		const onExpire = vi.fn()
		const deadline = new VisibleDeadline(30_000, onExpire, () => clock)
		deadline.resume()
		pass(10_000)
		deadline.cancel()
		deadline.resume()
		pass(60_000)
		expect(onExpire).not.toHaveBeenCalled()
	})

	it('vencido, no vuelve a correr', () => {
		const onExpire = vi.fn()
		const deadline = new VisibleDeadline(1_000, onExpire, () => clock)
		deadline.resume()
		pass(1_000)
		deadline.pause()
		deadline.resume()
		pass(60_000)
		expect(onExpire).toHaveBeenCalledOnce()
	})

	it('parado después de vencer, pero antes de que salte el temporizador, vence al volver', () => {
		const onExpire = vi.fn()
		const deadline = new VisibleDeadline(30_000, onExpire, () => clock)
		deadline.resume()
		clock += 31_000
		deadline.pause()
		expect(onExpire).not.toHaveBeenCalled()
		deadline.resume()
		pass(0)
		expect(onExpire).toHaveBeenCalledOnce()
	})
})
