import { describe, expect, it } from 'vitest'
import { positionOf } from '../src/lib/chess/uci'
import { promotes } from '../src/client/visor/coronacion'

// Corona el peón blanco de a7; el negro de h2, cuando le toque.
const PROMOTION = '4k3/P7/8/8/8/8/7p/4K3 w - - 0 40'

describe('promotes', () => {
	const pos = positionOf(PROMOTION)!

	it('un peón que llega a la última fila', () => {
		expect(promotes(pos, 'a7', 'a8')).toBe(true)
		expect(promotes(positionOf(PROMOTION.replace(' w ', ' b '))!, 'h2', 'h1')).toBe(true)
	})

	it('no otra pieza ni otra fila', () => {
		expect(promotes(pos, 'e1', 'e2')).toBe(false)
		expect(promotes(positionOf('4k3/8/P7/8/8/8/8/4K3 w - - 0 40')!, 'a6', 'a7')).toBe(false)
		expect(promotes(pos, 'zz', 'a8')).toBe(false)
	})
})
