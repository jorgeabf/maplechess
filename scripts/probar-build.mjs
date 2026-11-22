// Prueba en Chromium, sin ventana, lo que ejecuta JavaScript bajo la CSP, que ni la CI ni
// el humo abren. Contra el build servido en local o contra producción:
//
//   pnpm build
//   pnpm exec wrangler dev                                       # en otra terminal
//   node scripts/probar-build.mjs                                # http://localhost:8787
//   node scripts/probar-build.mjs --base https://maplechess.es
//
// Con `pnpm dev` falla a propósito: no aplica la CSP. Las pruebas, en orden:
// 1. la ficha de un jugador (--jugador <FIDE ID>; si no, el del humo) enlaza partidas;
// 2. el visor monta chessground, retrocede y avanza;
// 3. el motor, un wasm en un Web Worker, da una línea;
// 4. el explorador del repertorio. Su tablero lo pinta el servidor con el marcado de
//    chessground, así que las piezas no dicen nada: se mira que chessground lo haya
//    montado, que el motor analice y que una jugada escrita lleve a su página;
// 5. la orientación: los enlaces de la ficha no llevan query, una partida en la que el
//    jugador lleva negras sale desde negras abierta desde su ficha, y desde blancas sin Referer;
// 6. el buscador de la cabecera se cierra cuando el foco sale de él (el script en línea);
// 7. «Soy yo»: el botón de la ficha guarda la cookie, y un POST de otro origen se rechaza
//    (security.checkOrigin). Éste va con fetch de Node: el navegador no sale del sitio;
// 8. la consola y la red: sin errores, sin peticiones fallidas ni a otro sitio.
//
// Sale con 1 si falla alguna. El navegador y los sitios que se pueden abrir, en
// scripts/navegador.mjs.
import { allowed, launch, onlyAllowed } from './navegador.mjs'

const USAGE = 'Uso: node scripts/probar-build.mjs [--base URL] [--jugador <FIDE ID>]'
/** La de `wrangler dev`. */
const LOCAL = 'http://localhost:8787'
/** El jugador de scripts/humo.mjs. En local hace falta una D1 que tenga sus partidas. */
const PLAYER = '2285525'
/** Lo que se espera a una página, a un tablero o a un cambio en ellos. */
const TIMEOUT_MS = 15_000
/** El motor baja y compila su wasm antes de dar la primera línea, y se rinde a los 30 s. */
const ENGINE_TIMEOUT_MS = 45_000

function fail(message) {
	console.error(message)
	process.exit(1)
}

function parseArgs(argv) {
	const options = { base: LOCAL, player: PLAYER }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--base') options.base = argv[++i]
		else if (argv[i] === '--jugador') options.player = argv[++i]
		else fail(USAGE)
	}
	if (!URL.canParse(options.base ?? '')) fail(USAGE)
	const base = new URL(options.base)
	if (!allowed(base)) fail('Sólo localhost o https://maplechess.es.')
	if (!/^\d{4,10}$/.test(options.player ?? '')) fail(`El jugador va por su FIDE ID.\n${USAGE}`)
	return { base, player: options.player }
}

const firstLine = (error) => String(error.message ?? error).split('\n')[0]

/** Espera `promise`; si no llega, el error dice `message` y no el de Playwright. */
const must = (promise, message) =>
	promise.catch((error) => {
		throw new Error(message, { cause: error })
	})

/** Abre `path` y comprueba que llega bien y con la CSP: sin ella, lo demás no prueba nada. */
async function open(page, base, path) {
	const response = await page.goto(new URL(path, base).href, { waitUntil: 'load', timeout: 30_000 }).catch((error) => {
		throw new Error(`${path} no carga: ${firstLine(error)}`, { cause: error })
	})
	if (response?.status() !== 200) throw new Error(`${path} responde ${response?.status() ?? 'sin estado'}`)
	if (!response.headers()['content-security-policy'])
		throw new Error(
			`${path} llega sin Content-Security-Policy: \`pnpm dev\` no la aplica. ` +
				'Sirve el build con `pnpm exec wrangler dev`'
		)
}

/** Abre la primera de `games` que tenga jugadas: sin ellas no hay nada que recorrer. */
async function firstWithMoves(page, base, games) {
	for (const game of games.slice(0, 5)) {
		await open(page, base, game)
		const nodes = await page.evaluate(() => {
			const data = document.querySelector('visor-partida script[data-game]')?.textContent
			return JSON.parse(data ?? '{"nodes":[]}').nodes.length
		})
		if (nodes > 4) return game
	}
	throw new Error('ninguna de las primeras partidas de la ficha tiene jugadas')
}

/** En la página: dónde está cada pieza del visor. Cambia cuando cambia la posición. */
const placement = () =>
	[...document.querySelectorAll('visor-partida .cg-wrap piece:not(.ghost)')]
		.map((piece) => `${piece.className}@${piece.style.transform}`)
		.sort()
		.join('|')

/**
 * La media jugada del enlace (#j41) o, con `expected`, la espera a ella. El visor la
 * escribe 300 ms después de la última jugada, con las piezas ya en su sitio.
 */
async function ply(page, expected = null) {
	const found = await page.waitForFunction(
		(want) => {
			const ply = /^#j(\d+)$/.exec(location.hash)?.[1]
			if (ply === undefined) return undefined
			return want === null || Number(ply) === want ? ply : undefined
		},
		expected,
		{ timeout: TIMEOUT_MS }
	)
	return Number(await found.jsonValue())
}

/**
 * Enciende el motor de `root`, espera a que analice y lo apaga. Devuelve cuántas líneas da.
 *
 * Apagado, porque la preferencia se recuerda y la página siguiente lo encendería sola: salir
 * de ella con el motor cargándose deja a medias la petición de stockfish.js, y Chromium la da
 * por fallida (net::ERR_BLOCKED_BY_RESPONSE).
 */
async function analyse(page, root) {
	// En la página: deja el interruptor del motor como diga `on`.
	const toggle = ([selector, on]) => {
		const input = document.querySelector(`${selector} [data-engine-toggle]`)
		if (input.checked !== on) input.click()
	}
	// En la página: las líneas del motor, cada una con su primera jugada en data-uci, o lo que
	// dice si no ha podido cargar. Entonces se apaga solo y no llega a dar ninguna.
	const outcome = (selector) => {
		const panel = document.querySelector(`${selector} .engine`)
		const error = panel.querySelector('.engine-error').textContent.trim()
		if (error) return { error }
		const lines = [...panel.querySelectorAll('.pv-line')].filter((line) => line.dataset.uci).length
		return lines > 0 ? { lines } : null
	}
	await must(page.evaluate(toggle, [root, true]), `${root} no tiene el panel del motor`)
	const found = await must(
		page.waitForFunction(outcome, root, { timeout: ENGINE_TIMEOUT_MS }),
		`el motor no da ninguna línea en ${ENGINE_TIMEOUT_MS / 1000} s`
	)
	const { error, lines } = await found.jsonValue()
	if (error) throw new Error(`el motor dice «${error}»`)
	await page.evaluate(toggle, [root, false])
	await must(
		page.waitForFunction((selector) => document.querySelector(`${selector} .engine`).dataset.engine === 'off', root, {
			timeout: TIMEOUT_MS
		}),
		'el motor no se apaga'
	)
	return lines
}

async function main() {
	const { base, player } = parseArgs(process.argv.slice(2))
	// Sin nadie sirviendo fallarían las ocho, una a una.
	await fetch(base, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) }).then(
		(response) => response.body?.cancel(),
		(error) =>
			fail(
				`No responde nadie en ${base.origin} (${error.cause?.code ?? firstLine(error)}). ` +
					'En local: pnpm build y pnpm exec wrangler dev.'
			)
	)
	const browser = await launch().catch((error) => fail(error.message))
	let failed = 0
	let total = 0

	/** Lanza una prueba: `run` devuelve lo que se enseña, o lanza el motivo del fallo. */
	async function check(name, run) {
		total++
		try {
			console.log(`ok    ${name}: ${await run()}`)
		} catch (error) {
			failed++
			console.error(`FALLA ${name}: ${firstLine(error)}`)
		}
	}

	try {
		console.log(`El build de ${base.origin}, en Chromium ${browser.version()}`)
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
		/** Errores de consola y de página, y peticiones cortadas, fallidas o con estado de error. */
		const problems = []
		await onlyAllowed(context, (origin) => problems.push(`petición a otro sitio, cortada: ${origin}`))
		const page = await context.newPage()
		page.on('console', (message) => {
			if (message.type() === 'error') problems.push(`consola: ${message.text().slice(0, 200)}`)
		})
		page.on('pageerror', (error) => problems.push(`error de página: ${String(error).slice(0, 200)}`))
		page.on('response', (response) => {
			if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`)
		})
		page.on('requestfailed', (request) => {
			const reason = request.failure()?.errorText ?? ''
			// Las de otro sitio ya están apuntadas, y al cambiar de página se abandonan las que estaban en curso.
			if (allowed(new URL(request.url())) && reason !== 'net::ERR_ABORTED')
				problems.push(`petición fallida (${reason}): ${request.url()}`)
		})

		const ficha = `/jugadores/${player}`
		let games = []
		await check('ficha', async () => {
			await open(page, base, ficha)
			games = await page
				.locator('#partidas a.result[href^="/partidas/"]')
				.evaluateAll((links) => [...new Set(links.map((link) => new URL(link.href).pathname))])
			if (games.length === 0) throw new Error(`${ficha} no enlaza ninguna partida`)
			return `${ficha} enlaza ${games.length} partidas`
		})

		let inVisor = false
		await check('visor', async () => {
			if (games.length === 0) throw new Error('sin partida que abrir')
			const game = await firstWithMoves(page, base, games)
			await must(
				page.waitForSelector('visor-partida .cg-wrap.manipulable piece', { timeout: TIMEOUT_MS }),
				`chessground no se ha montado en ${game}`
			)
			inVisor = true
			// Abre en la última jugada: dos atrás y una adelante, esperando al #j de cada una.
			const last = await page.evaluate(placement)
			await page.keyboard.press('ArrowLeft')
			const first = await must(ply(page), `${game} no retrocede con ←`)
			await page.keyboard.press('ArrowLeft')
			await must(ply(page, first - 1), `${game} no retrocede otra vez con ←`)
			const before = await page.evaluate(placement)
			await page.keyboard.press('ArrowRight')
			await must(ply(page, first), `${game} no avanza con →`)
			const after = await page.evaluate(placement)
			if (before === last || after === before)
				throw new Error(`en ${game}, las piezas no se mueven al cambiar de jugada`)
			return `${game} monta chessground, retrocede a #j${first - 1} y avanza a #j${first}`
		})

		await check('motor', async () => {
			if (!inVisor) throw new Error('sin visor en el que encenderlo')
			return `${await analyse(page, 'visor-partida')} líneas en el visor`
		})

		await check('explorador', async () => {
			const path = `${ficha}/repertorio`
			await open(page, base, path)
			if ((await page.locator('explorador-repertorio').count()) === 0)
				throw new Error(`${path} no tiene explorador: ¿el jugador tiene partidas con blancas?`)
			await must(
				page.waitForSelector('explorador-repertorio .cg-wrap.manipulable', { timeout: TIMEOUT_MS }),
				`chessground no se ha montado en ${path}: el tablero que se ve es el que pinta el servidor`
			)
			const lines = await analyse(page, 'explorador-repertorio')
			await must(
				page.fill('explorador-repertorio [data-move-input] input[name="jugada"]', 'e4', { timeout: TIMEOUT_MS }),
				`${path} no tiene el campo «Tu jugada»`
			)
			await page.keyboard.press('Enter')
			await must(
				page.waitForURL((url) => url.searchParams.get('jugadas') === 'e2e4', { timeout: TIMEOUT_MS }),
				'«e4» en «Tu jugada» no lleva a su página'
			)
			await must(
				page.waitForSelector('explorador-repertorio a[data-prev][aria-keyshortcuts]', {
					state: 'attached',
					timeout: TIMEOUT_MS
				}),
				'tras «e4», «← Atrás» no lleva su atajo: el explorador no se ha montado'
			)
			return `${path} monta chessground, ${lines} líneas del motor y «e4» lleva a ?jugadas=e2e4`
		})

		await check('orientación', async () => {
			await open(page, base, ficha)
			const withQuery = await page
				.locator('#partidas a.result[href*="?"]')
				.evaluateAll((links) => links.map((link) => link.getAttribute('href')))
			if (withQuery.length > 0) throw new Error(`${ficha} enlaza partidas con query: ${withQuery[0]}`)
			// Con negras, el rival de blancas lleva enlace a su ficha y el jugador de la página, no.
			const asBlack = page
				.locator('#partidas tr:has(td.white a[href^="/jugadores/"]):not(:has(td.black a[href^="/jugadores/"]))')
				.locator('a.result')
				.first()
			if ((await asBlack.count()) === 0)
				throw new Error(`${ficha} no tiene, en su primera página, partidas con negras`)
			const game = new URL(await asBlack.getAttribute('href'), base).pathname
			await asBlack.click({ timeout: TIMEOUT_MS })
			await must(
				page.waitForSelector('visor-partida .cg-wrap.orientation-black', { timeout: TIMEOUT_MS }),
				`${game}, abierta desde ${ficha}, no sale desde negras`
			)
			// page.goto no manda Referer.
			await open(page, base, game)
			await must(
				page.waitForSelector('visor-partida .cg-wrap.orientation-white', { timeout: TIMEOUT_MS }),
				`${game}, abierta sin Referer, no sale desde blancas`
			)
			return `${game} sale desde negras abierta desde ${ficha} y desde blancas sin Referer`
		})

		await check('buscador', async () => {
			await open(page, base, '/acerca')
			await page.click('.search-toggle', { timeout: TIMEOUT_MS })
			await must(
				page.waitForFunction(
					() => {
						const panel = document.querySelector('#buscar-jugador')
						return panel.matches(':popover-open') && panel.contains(document.activeElement)
					},
					null,
					{ timeout: TIMEOUT_MS }
				),
				'no se abre con el foco en su campo'
			)
			await page.evaluate(() => document.querySelector('main a[href]').focus())
			await must(
				page.waitForFunction(() => !document.querySelector('#buscar-jugador').matches(':popover-open'), null, {
					timeout: TIMEOUT_MS
				}),
				'no se cierra cuando el foco sale de él'
			)
			return 'se abre con el foco en su campo y se cierra cuando el foco sale de él'
		})

		// La última del navegador: deja la cookie puesta, y con ella las páginas te hablan a ti.
		await check('«Soy yo»', async () => {
			await open(page, base, ficha)
			await must(
				page.click(`form.me button[name="yo"][value="${player}"]`, { timeout: TIMEOUT_MS }),
				`${ficha} no tiene el botón «Soy yo»`
			)
			await must(
				page.waitForSelector('form.me button[name="yo"][value=""]', { timeout: TIMEOUT_MS }),
				'tras «Soy yo», la ficha no ofrece «No soy yo»'
			)
			const cookie = (await context.cookies(base.href)).find((item) => item.name === 'yo')
			if (cookie?.value !== player || !cookie.httpOnly) throw new Error('«Soy yo» no guarda la cookie yo con HttpOnly')
			const other = await fetch(new URL(ficha, base), {
				method: 'POST',
				redirect: 'manual',
				headers: { Origin: 'https://example.com', 'User-Agent': 'maplechess-probar-build' },
				body: new URLSearchParams({ yo: player }),
				signal: AbortSignal.timeout(30_000)
			}).catch((error) => {
				throw new Error(`el POST a ${ficha} no llega: ${error.cause?.code ?? firstLine(error)}`, { cause: error })
			})
			await other.body?.cancel()
			if (other.status !== 403) throw new Error(`el POST de otro origen responde ${other.status}, no 403`)
			return 'el botón de la ficha guarda la cookie y un POST de otro origen se rechaza (403)'
		})

		await check('consola y red', async () => {
			if (problems.length > 0) throw new Error(`${problems.length}: ${problems.slice(0, 3).join(' · ')}`)
			return 'sin errores ni peticiones fallidas'
		})
	} finally {
		await browser.close()
	}

	if (failed > 0) {
		console.error(`Fallan ${failed} de ${total} pruebas.`)
		process.exitCode = 1
	} else console.log(`El build pasa las ${total} pruebas.`)
}

await main()
