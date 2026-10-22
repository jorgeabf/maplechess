// Prueba de humo: unas pocas URL de la web, a una petición por segundo, con su
// estado, un texto que sólo sale si la página se ha pintado entera y sus
// cabeceras. La lanza scripts/desplegar.mjs al final de cada despliegue, y se
// puede lanzar a mano:
//
//   node scripts/humo.mjs                          # producción
//   node scripts/humo.mjs http://localhost:8787    # otra URL base
//
// Sin búsquedas ni descargas grandes: cada una recorre miles de filas de D1.

const PRODUCTION = 'https://maplechess.es'
const PAUSE_MS = 1000
const TIMEOUT_MS = 20_000

const base = (process.argv[2] ?? PRODUCTION).replace(/\/+$/, '')

/** El HTML no se guarda en caché: tras un despliegue apuntaría a CSS y JS que ya no existen. */
const revalidates = (value) => /no-store|no-cache|max-age=0\b/.test(value ?? '')

const html = (path, text, status = 200) => ({
	path,
	status,
	type: 'text/html',
	text,
	headers: { 'Cache-Control': revalidates }
})

const CHECKS = [
	html('/', 'Últimos torneos con partidas'),
	html('/jugadores', 'Ranking de España'),
	html('/jugadores/2285525', '<title>David Anton Guijarro'),
	html('/partidas/53051', '<visor-partida'),
	{
		path: '/partidas/53051.pgn',
		status: 200,
		type: 'application/x-chess-pgn',
		text: '[White "Anton Guijarro, David"]',
		headers: { 'Content-Disposition': (value) => /^attachment; filename=".+\.pgn"$/.test(value ?? '') }
	},
	html('/torneos/12053', 'Participantes ('),
	html('/acerca', 'Acerca de MapleChess'),
	html('/humo-no-existe', 'No encontramos esa página', 404),
	{
		path: '/api/admin/sync',
		status: 401,
		type: 'application/json',
		text: 'No autorizado',
		headers: { 'Cache-Control': (value) => value === 'no-store' }
	},
	// Un 503 dice que falla la ingesta, no el despliegue: avisa sin dar el humo por fallido.
	{
		path: '/api/estado',
		status: 200,
		warnStatus: 503,
		type: 'application/json',
		text: '"pasadas"',
		headers: { 'Cache-Control': (value) => value === 'no-store' }
	}
]

// Contra producción, además: la URL de workers.dev y www llevan al dominio (src/middleware.ts).
const REDIRECTS = [
	['https://buscador-partidas-ajedrez.aportuvas.workers.dev/acerca', `${PRODUCTION}/acerca`],
	['https://www.maplechess.es/', `${PRODUCTION}/`]
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const get = (url) =>
	fetch(url, {
		redirect: 'manual',
		headers: { 'User-Agent': 'maplechess-humo' },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	})

/** Problemas de una URL; vacío si está bien. */
async function check({ path, status, warnStatus, type, text, headers }) {
	const response = await get(base + path)
	const body = await response.text()
	const problems = []
	if (response.status === warnStatus) {
		console.warn(`AVISO ${path}: ${response.status} ${body}`)
	} else if (response.status !== status) {
		problems.push(`estado ${response.status}, se esperaba ${status}`)
	}
	const contentType = response.headers.get('Content-Type') ?? ''
	if (!contentType.startsWith(type)) problems.push(`Content-Type «${contentType}», se esperaba ${type}`)
	if (!body.includes(text)) problems.push(`no contiene «${text}»`)
	for (const [name, ok] of Object.entries(headers)) {
		const value = response.headers.get(name)
		if (!ok(value)) problems.push(`${name}: «${value ?? '(sin cabecera)'}»`)
	}
	return problems
}

/** Problemas de una redirección; vacío si está bien. */
async function checkRedirect([from, to]) {
	const response = await get(from)
	await response.body?.cancel()
	const location = response.headers.get('Location')
	if (response.status === 301 && location === to) return []
	return [`${response.status} hacia «${location ?? '(sin Location)'}», se esperaba 301 hacia ${to}`]
}

const tasks = [
	...CHECKS.map((item) => ({ label: item.path, run: () => check(item) })),
	...(base === PRODUCTION ? REDIRECTS.map((pair) => ({ label: pair[0], run: () => checkRedirect(pair) })) : [])
]

console.log(`Humo contra ${base}`)
let failed = 0
for (const [i, { label, run }] of tasks.entries()) {
	if (i > 0) await sleep(PAUSE_MS)
	const problems = await run().catch((error) => [String(error)])
	if (problems.length === 0) {
		console.log(`ok    ${label}`)
	} else {
		failed++
		console.error(`FALLA ${label}: ${problems.join('; ')}`)
	}
}

if (failed > 0) {
	console.error(`El humo falla en ${failed} de ${tasks.length} URL.`)
	process.exit(1)
}
console.log(`Humo en verde: ${tasks.length} URL.`)
