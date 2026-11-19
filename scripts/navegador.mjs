// Lo que comparten los scripts que abren la web en Chromium sin ventana (medir.mjs y
// probar-build.mjs): qué sitios se pueden abrir y cómo se lanza el navegador.
//
// Usa el Chromium de playwright-core que ya está en la carpeta de navegadores de Playwright,
// compartida con otros proyectos, con un perfil temporal. playwright-core va fijado a la
// versión de ese Chromium: nunca `playwright install`, que puede borrar de esa carpeta
// versiones que usan otros.
import { chromium } from 'playwright-core'

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'maplechess.es'])

/** ¿Se puede abrir `url`? Sólo localhost y maplechess.es. */
export const allowed = (url) =>
	/^https?:$/.test(url.protocol) && (ALLOWED_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost'))

/**
 * Chromium sin ventana. Con `channel: 'chromium'`: sin él, Playwright busca
 * chromium_headless_shell, que no está descargado. Si no arranca, el error dice por qué.
 */
export async function launch() {
	try {
		return await chromium.launch({ channel: 'chromium' })
	} catch (error) {
		throw new Error(
			`No arranca Chromium: ${String(error.message ?? error).split('\n')[0]}\n` +
				'playwright-core va con el Chromium ya descargado. ' +
				'Si se ha subido su versión, hay que volver a fijarla (package.json).',
			{ cause: error }
		)
	}
}

/**
 * Corta en `context` toda petición a otro sitio y avisa de cada una con `onBlocked(origen)`.
 * Playwright sólo pregunta por la primera URL de una petición: una redirección no vuelve a
 * pasar por aquí. Las del sitio van todas a él mismo.
 */
export async function onlyAllowed(context, onBlocked) {
	await context.route('**/*', (route) => {
		const target = new URL(route.request().url())
		if (allowed(target)) return route.continue()
		onBlocked(target.origin)
		return route.abort()
	})
}
