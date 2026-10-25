// Mide páginas de la web en Chromium, sin ventana, a varios anchos y en los dos temas:
// estado HTTP, alto, desborde horizontal, los elementos que se salen de la ventana,
// errores de consola y peticiones fallidas. Con --capturas guarda además una captura
// de cada página entera.
//
//   node scripts/medir.mjs <carpeta> <ruta…> [--base URL] [--anchos 250,375,1280]
//                          [--temas claro,oscuro] [--capturas]
//
// La base es http://localhost:4321 (pnpm dev) si no se dice otra. Sólo abre localhost y
// https://maplechess.es: cualquier otra petición se corta. Por debajo de 768 px emula un
// móvil, con la barra de desplazamiento superpuesta, como en un teléfono. 250 px equivale
// a 375 con la letra del navegador al 150 %.
//
// Usa el Chromium de playwright-core que ya está en la carpeta de navegadores de Playwright,
// compartida con otros proyectos, con un perfil temporal. playwright-core va fijado a la
// versión de ese Chromium: nunca `playwright install`, que puede borrar de esa carpeta
// versiones que usan otros. Sale con 1 si alguna página tiene un problema.
import { mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'maplechess.es'])
const THEMES = { claro: 'light', oscuro: 'dark' }

function fail(message) {
	console.error(message)
	process.exit(1)
}

function parseArgs(argv) {
	const options = { base: 'http://localhost:4321', widths: [250, 375, 1280], themes: ['claro', 'oscuro'], shots: false }
	const rest = []
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--base') options.base = argv[++i]
		else if (arg === '--anchos') options.widths = argv[++i].split(',').map(Number)
		else if (arg === '--temas') options.themes = argv[++i].split(',')
		else if (arg === '--capturas') options.shots = true
		else if (arg.startsWith('--')) fail(`Opción desconocida: ${arg}`)
		else rest.push(arg)
	}
	const [out, ...paths] = rest
	if (!out || paths.length === 0)
		fail('Uso: node scripts/medir.mjs <carpeta> <ruta…> [--base URL] [--anchos 250,375,1280] [--temas claro,oscuro] [--capturas]')
	if (options.widths.some((width) => !Number.isInteger(width) || width < 200)) fail('Los anchos van en píxeles, de 200 en adelante.')
	const unknown = options.themes.filter((theme) => !THEMES[theme])
	if (unknown.length > 0) fail(`Temas: claro u oscuro, no ${unknown.join(', ')}.`)
	return { ...options, out, paths }
}

const allowed = (url) => /^https?:$/.test(url.protocol) && (ALLOWED_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost'))

// Dentro de la página: desborde, alto y los elementos que se salen por los lados. No
// cuentan los que recorta un antepasado con overflow (una tabla con scroll), los de 1 px
// (.visually-hidden) ni los que están dentro de otro que ya se sale.
function measurePage() {
	const root = document.documentElement
	const width = root.clientWidth
	const clipped = (el) => {
		for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement)
			if (getComputedStyle(parent).overflowX !== 'visible') return true
		return false
	}
	const outside = []
	for (const el of document.body.querySelectorAll('*')) {
		const box = el.getBoundingClientRect()
		if (box.width <= 1 && box.height <= 1) continue
		if (box.right <= width + 1 && box.left >= -1) continue
		if (outside.some((other) => other.contains(el)) || clipped(el)) continue
		outside.push(el)
	}
	const describe = (el) => {
		const box = el.getBoundingClientRect()
		const name = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList[0] ? `.${el.classList[0]}` : '')
		return `${name} (${Math.round(box.left)}–${Math.round(box.right)} px)`
	}
	return { overflow: root.scrollWidth - width, height: root.scrollHeight, outside: outside.slice(0, 5).map(describe), outsideCount: outside.length }
}

const slug = (path) => path.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '_') || 'portada'

async function measure(browser, options, path, theme, width) {
	const url = new URL(path, options.base)
	const mobile = width < 768
	const context = await browser.newContext({
		viewport: { width, height: mobile ? 812 : 800 },
		colorScheme: THEMES[theme],
		isMobile: mobile,
		hasTouch: mobile
	})
	const errors = []
	const requests = []
	await context.route('**/*', (route) => {
		const target = new URL(route.request().url())
		if (allowed(target)) return route.continue()
		requests.push(`cortada: ${target.origin}`)
		return route.abort()
	})
	const page = await context.newPage()
	page.on('console', (message) => message.type() === 'error' && errors.push(message.text().slice(0, 200)))
	page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))
	page.on('response', (response) => response.status() >= 400 && requests.push(`${response.status()} ${response.url()}`))

	const started = Date.now()
	let status = null
	try {
		const response = await page.goto(url.href, { waitUntil: 'load', timeout: 30_000 })
		status = response?.status() ?? null
		await page.evaluate(() => document.fonts.ready)
		// Dos fotogramas: lo que los scripts montan al cargar (el tablero) ya está pintado.
		await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
	} catch (error) {
		errors.push(`no carga: ${String(error.message ?? error).split('\n')[0]}`)
	}
	const ms = Date.now() - started
	const result = status === null ? { overflow: null, height: null, outside: [], outsideCount: 0 } : await page.evaluate(measurePage)
	if (options.shots && status !== null)
		await page.screenshot({ path: join(options.outDir, `${slug(path)}-${theme}-${width}.png`), fullPage: true })
	await context.close()

	const problem = status === null || status >= 400 || result.overflow > 0 || result.outsideCount > 0 || errors.length > 0 || requests.length > 0
	return { path, theme, width, status, ms, ...result, errors, requests, problem }
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const base = new URL(options.base)
	if (!allowed(base)) fail('Sólo localhost o https://maplechess.es.')
	for (const path of options.paths) {
		if (/^[a-z]:[\\/]/i.test(path))
			fail(`${path} es una ruta de Windows: Git Bash convierte así las que empiezan por /. Lánzalo con MSYS_NO_PATHCONV=1.`)
		if (!allowed(new URL(path, base))) fail(`Fuera de lo permitido: ${path}`)
	}

	options.outDir = resolve(options.out)
	const inside = relative(REPO, options.outDir)
	if (!inside.startsWith('..') && !isAbsolute(inside))
		fail('La carpeta de salida tiene que estar fuera del repositorio: las capturas pueden llevar nombres.')
	mkdirSync(options.outDir, { recursive: true })

	let browser
	try {
		browser = await chromium.launch({ channel: 'chromium' })
	} catch (error) {
		fail(
			`No arranca Chromium: ${String(error.message ?? error).split('\n')[0]}\n` +
				'playwright-core va con el Chromium ya descargado. Si se ha subido su versión, hay que volver a fijarla (package.json).'
		)
	}
	const started = Date.now()
	const results = []
	for (const path of options.paths)
		for (const theme of options.themes)
			for (const width of options.widths) {
				const result = await measure(browser, options, path, theme, width)
				results.push(result)
				const flags = [
					result.overflow > 0 && `desborde ${result.overflow} px`,
					result.outsideCount > 0 && `${result.outsideCount} fuera: ${result.outside.join(', ')}`,
					result.errors.length > 0 && `${result.errors.length} errores: ${result.errors[0]}`,
					result.requests.length > 0 && `${result.requests.length} peticiones: ${result.requests[0]}`
				].filter(Boolean)
				console.log(
					[path, theme, `${width} px`, result.status ?? '—', `${result.height ?? '—'} px de alto`, `${result.ms} ms`, flags.join(' · ') || 'bien'].join('\t')
				)
			}
	const version = browser.version()
	await browser.close()

	const problems = results.filter((result) => result.problem).length
	writeFileSync(
		join(options.outDir, 'medidas.json'),
		JSON.stringify({ base: options.base, date: new Date().toISOString(), browser: version, results }, null, 1)
	)
	console.log(`${results.length} medidas en ${((Date.now() - started) / 1000).toFixed(1)} s; ${problems} con algún problema. Detalle en ${join(options.outDir, 'medidas.json')}`)
	if (problems > 0) process.exitCode = 1
}

await main()
