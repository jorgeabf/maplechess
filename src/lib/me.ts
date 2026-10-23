// "Tú": el ID FIDE de quien prepara la partida, para cruzar su repertorio con
// el del rival. Sin cuentas: llega en el campo `yo` de un formulario POST
// (funciona sin JavaScript) y el servidor lo recuerda en una cookie que sólo
// sirve para eso. `yo` vacío la borra. Se indica en el dossier, con tu ID o
// con tu nombre para elegirte en una lista, o con «Soy yo» en tu ficha. Va
// por POST para que tu ID o tu nombre no queden en la URL: ni en los
// registros, ni en el historial, ni en un enlace que se comparta. Astro
// rechaza los POST de formularios de otros sitios (security.checkOrigin).

export const ME_FIELD = 'yo'
export const ME_COOKIE = 'yo'
/** Un año, en segundos. */
export const ME_MAX_AGE = 60 * 60 * 24 * 365
export const ME_COOKIE_OPTIONS = { path: '/', maxAge: ME_MAX_AGE, httpOnly: true, secure: true, sameSite: 'lax' } as const

export interface Me {
	fideId: number | null
	/** De dónde sale: del formulario, de la cookie o de `yo` vacío (olvidarlo). */
	source: 'form' | 'cookie' | 'forget'
}

function fideIdOf(value: string | null | undefined): number | null {
	const trimmed = value?.trim() ?? ''
	if (!/^\d{1,10}$/.test(trimmed)) return null
	const id = Number(trimmed)
	return id > 0 ? id : null
}

/** El campo `yo` de un formulario enviado por POST; null si no lo es o no lo trae. */
export async function readMeField(request: Request): Promise<string | null> {
	if (request.method !== 'POST') return null
	const form = await request.formData().catch(() => null)
	const value = form?.get(ME_FIELD)
	return typeof value === 'string' ? value : null
}

/** El formulario manda sobre la cookie; si no vale, se ignora y sigue la cookie. */
export function resolveMe(field: string | null, cookie: string | null | undefined): Me {
	if (field !== null) {
		if (field.trim() === '') return { fideId: null, source: 'forget' }
		const id = fideIdOf(field)
		if (id) return { fideId: id, source: 'form' }
	}
	return { fideId: fideIdOf(cookie), source: 'cookie' }
}

/**
 * Tu nombre, si `yo` trae texto en vez de un ID: en el dossier, se listan los
 * jugadores que casan para que elijas cuál eres. '' si es un ID o no viene.
 */
export function meName(field: string | null): string {
	const value = (field ?? '').trim().slice(0, 80)
	return fideIdOf(value) === null ? value : ''
}

export type CookieAction = 'set' | 'delete' | 'keep'

/**
 * Qué hacer con la cookie una vez buscado el ID. Sólo se recuerda uno que
 * existe y no es el del rival: si no, la portada enseñaría como tuyas las
 * partidas de otro. Uno recordado que ya no existe se olvida.
 */
export function meCookieAction(me: Me, rivalId: number, exists: boolean): CookieAction {
	if (me.source === 'forget') return 'delete'
	if (me.fideId === null) return 'keep'
	if (me.source === 'form') return exists && me.fideId !== rivalId ? 'set' : 'keep'
	return exists ? 'keep' : 'delete'
}

/**
 * En el dossier, ¿vuelve la página a sí misma por GET tras el formulario? Sólo
 * si lo que traía ya está en la cookie: tu ID guardado o `yo` vacío. Con un ID
 * que no existe o con el del rival no se guarda nada y la respuesta al POST
 * dice por qué; con un nombre, lista los que casan (aunque se borre una cookie
 * que ya no vale). Así el nombre tampoco va en la URL.
 */
export function redirectsAfterForm(me: Me, cookie: CookieAction): boolean {
	return me.source === 'forget' || (me.source === 'form' && cookie === 'set')
}

/**
 * ¿Es la página de `fideId` la tuya? Sólo con la cookie: un `yo` en el
 * formulario con el ID del jugador es haber tecleado el suyo en su dossier.
 * Entonces tu ficha, tu dossier y tu repertorio te hablan a ti.
 */
export function isOwn(me: Me, fideId: number): boolean {
	return me.source === 'cookie' && me.fideId === fideId
}

/**
 * «Soy yo» y «No soy yo» en la ficha de `fideId`: desde una ficha sólo se
 * puede decir que eres ese jugador. Otro ID en el formulario no toca la
 * cookie, para que nadie te haga pasar por un tercero.
 */
export function claimCookieAction(me: Me, fideId: number): CookieAction {
	if (me.source === 'forget') return 'delete'
	return me.source === 'form' && me.fideId === fideId ? 'set' : 'keep'
}
