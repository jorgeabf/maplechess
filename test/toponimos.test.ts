import { describe, expect, it } from 'vitest'
import { COMMUNITY_OF, PROVINCE_NAME } from '../src/lib/toponimos'

describe('PROVINCE_NAME', () => {
	it('el primer nombre de cada provincia, por su código del INE', () => {
		expect(PROVINCE_NAME.get('48')).toBe('Bizkaia')
		expect(PROVINCE_NAME.get('07')).toBe('Islas Baleares')
		expect(PROVINCE_NAME.get('01')).toBe('Álava')
		expect(PROVINCE_NAME.get('38')).toBe('Santa Cruz de Tenerife')
		expect(PROVINCE_NAME.get('52')).toBe('Melilla')
	})

	it('las 50 provincias y las dos ciudades autónomas, y sólo ellas', () => {
		expect(PROVINCE_NAME.size).toBe(52)
		expect([...PROVINCE_NAME.keys()].sort()).toEqual([...COMMUNITY_OF.keys()].sort())
		expect(PROVINCE_NAME.get('99')).toBeUndefined()
	})
})
