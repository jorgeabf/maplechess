import { describe, expect, it } from 'vitest'
import { claimCookieAction, isOwn, meCookieAction, meName, readMeField, redirectsAfterForm, resolveMe } from '../src/lib/me'

describe('readMeField', () => {
	const post = (body: string, type = 'application/x-www-form-urlencoded') =>
		new Request('https://maplechess.test/jugadores/9228291', { method: 'POST', headers: { 'content-type': type }, body })

	it('lee el campo yo de un formulario enviado por POST, también vacío', async () => {
		expect(await readMeField(post('yo=9228291'))).toBe('9228291')
		expect(await readMeField(post('yo='))).toBe('')
		expect(await readMeField(post('yo=Garcia+Lopez'))).toBe('Garcia Lopez')
	})

	it('null en un GET, aunque lleve ?yo=, o en un POST sin el campo o que no es un formulario', async () => {
		expect(await readMeField(new Request('https://maplechess.test/jugadores/9228291?yo=9228291'))).toBeNull()
		expect(await readMeField(post('otro=1'))).toBeNull()
		expect(await readMeField(post('{"yo":"9228291"}', 'application/json'))).toBeNull()
	})
})

describe('resolveMe', () => {
	it('el formulario manda sobre la cookie', () => {
		expect(resolveMe('9228291', '123')).toEqual({ fideId: 9228291, source: 'form' })
	})

	it('sin formulario sigue la cookie', () => {
		expect(resolveMe(null, '9228291')).toEqual({ fideId: 9228291, source: 'cookie' })
		expect(resolveMe(null, undefined)).toEqual({ fideId: null, source: 'cookie' })
	})

	it('vacío la olvida', () => {
		expect(resolveMe('', '9228291')).toEqual({ fideId: null, source: 'forget' })
	})

	it('ignora lo que no es un ID', () => {
		expect(resolveMe('abc', '9228291')).toEqual({ fideId: 9228291, source: 'cookie' })
		expect(resolveMe('0', null)).toEqual({ fideId: null, source: 'cookie' })
		expect(resolveMe(null, 'x; y')).toEqual({ fideId: null, source: 'cookie' })
	})
})

describe('meName', () => {
	it('un texto es tu nombre, sin los espacios de los lados', () => {
		expect(meName('  Garcia Lopez ')).toBe('Garcia Lopez')
	})

	it('un ID o nada no son un nombre', () => {
		expect(meName(' 9228291 ')).toBe('')
		expect(meName('')).toBe('')
		expect(meName('   ')).toBe('')
		expect(meName(null)).toBe('')
	})

	it('lo que resolveMe no toma por ID se busca como nombre', () => {
		expect(meName('0')).toBe('0')
		expect(meName('12345678901')).toBe('12345678901')
	})

	it('como mucho 80 caracteres', () => {
		expect(meName('a'.repeat(100))).toHaveLength(80)
	})
})

describe('meCookieAction', () => {
	const rival = 32057652

	it('guarda un ID del formulario que existe', () => {
		expect(meCookieAction({ fideId: 9228291, source: 'form' }, rival, true)).toBe('set')
	})

	it('no guarda el ID del rival ni uno que no existe', () => {
		expect(meCookieAction({ fideId: rival, source: 'form' }, rival, true)).toBe('keep')
		expect(meCookieAction({ fideId: 99999999, source: 'form' }, rival, false)).toBe('keep')
	})

	it('yo vacío la borra', () => {
		expect(meCookieAction({ fideId: null, source: 'forget' }, rival, false)).toBe('delete')
	})

	it('olvida una cookie con un ID que no existe', () => {
		expect(meCookieAction({ fideId: 99999999, source: 'cookie' }, rival, false)).toBe('delete')
	})

	it('conserva una cookie válida, también en tu propio dossier', () => {
		expect(meCookieAction({ fideId: 9228291, source: 'cookie' }, rival, true)).toBe('keep')
		expect(meCookieAction({ fideId: rival, source: 'cookie' }, rival, true)).toBe('keep')
	})

	it('sin ID no toca nada', () => {
		expect(meCookieAction({ fideId: null, source: 'cookie' }, rival, false)).toBe('keep')
	})
})

describe('claimCookieAction', () => {
	const own = 9228291

	it('«Soy yo» guarda el ID de la ficha', () => {
		expect(claimCookieAction({ fideId: own, source: 'form' }, own)).toBe('set')
	})

	it('«No soy yo» la borra', () => {
		expect(claimCookieAction({ fideId: null, source: 'forget' }, own)).toBe('delete')
	})

	it('otro ID o uno que no vale no tocan la cookie', () => {
		expect(claimCookieAction({ fideId: 32057652, source: 'form' }, own)).toBe('keep')
		expect(claimCookieAction(resolveMe('abc', '32057652'), own)).toBe('keep')
		expect(claimCookieAction(resolveMe('abc', String(own)), own)).toBe('keep')
	})
})

describe('redirectsAfterForm', () => {
	const rival = 32057652

	it('vuelve a la página por GET cuando ya está en la cookie: guardado o borrado', () => {
		const me = resolveMe('9228291', null)
		expect(redirectsAfterForm(me, meCookieAction(me, rival, true))).toBe(true)
		const forget = resolveMe('', '9228291')
		expect(redirectsAfterForm(forget, meCookieAction(forget, rival, true))).toBe(true)
	})

	it('responde al POST si no se guarda: ID que no existe o el del rival', () => {
		const missing = resolveMe('99999999', null)
		expect(redirectsAfterForm(missing, meCookieAction(missing, rival, false))).toBe(false)
		const self = resolveMe(String(rival), null)
		expect(redirectsAfterForm(self, meCookieAction(self, rival, true))).toBe(false)
	})

	it('responde al POST si es un nombre, aunque se borre una cookie que ya no vale', () => {
		const name = resolveMe('Garcia', '99999999')
		expect(meCookieAction(name, rival, false)).toBe('delete')
		expect(redirectsAfterForm(name, 'delete')).toBe(false)
	})

	it('sin formulario no hay a dónde volver', () => {
		expect(redirectsAfterForm(resolveMe(null, '9228291'), 'keep')).toBe(false)
	})
})

describe('isOwn', () => {
	const own = 9228291

	it('es tu página si la cookie es ese jugador', () => {
		expect(isOwn(resolveMe(null, String(own)), own)).toBe(true)
		expect(isOwn(resolveMe(null, '32057652'), own)).toBe(false)
		expect(isOwn(resolveMe(null, undefined), own)).toBe(false)
	})

	it('no por llevar su ID en el formulario', () => {
		expect(isOwn(resolveMe(String(own), null), own)).toBe(false)
	})
})
