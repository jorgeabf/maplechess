// Lanzar y consultar sincronizaciones a mano (carga inicial, pruebas).
// Protegido con el secreto ADMIN_TOKEN: `Authorization: Bearer <token>`.
//
//   POST /api/admin/sync  {"workflow":"info64","params":{"from":"2025-12-01","to":"2025-12-31"}}
//   POST /api/admin/sync  {"workflow":"info64","params":{"from":"","to":"","keys":["ce-individual-absoluto-2025"]}}
//   POST /api/admin/sync  {"workflow":"info64","params":{"from":"","to":"","pairings":"only"}}
//   POST /api/admin/sync  {"workflow":"info64","params":{"from":"2014-01-01","to":"2014-01-31","standings":"only","chain":{"until":"2026-10-23","months":1}}}
//   POST /api/admin/sync  {"workflow":"lichess"}
//   POST /api/admin/sync  {"workflow":"lichess","params":{"rounds":["jQucOFAV"]}}
//   POST /api/admin/sync  {"workflow":"fide","params":{"force":true}}
//   POST /api/admin/sync  {"workflow":"reprocess"}
//   POST /api/admin/sync  {"workflow":"fca"}
//   POST /api/admin/sync  {"workflow":"fca","params":{"files":["2021/regional_absoluto_2021"]}}
//   GET  /api/admin/sync?workflow=info64&id=<instancia>
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { windowInstanceId } from '../../../ingest/info64/sync'

const WORKFLOWS = {
	info64: () => env.INFO64_SYNC,
	lichess: () => env.LICHESS_SYNC,
	fide: () => env.FIDE_SYNC,
	reprocess: () => env.GAMES_REPROCESS,
	fca: () => env.FCA_IMPORT
} as const

type WorkflowName = keyof typeof WORKFLOWS

function authorized(request: Request): boolean {
	const token = env.ADMIN_TOKEN
	return Boolean(token) && request.headers.get('Authorization') === `Bearer ${token}`
}

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function isWorkflow(name: unknown): name is WorkflowName {
	return typeof name === 'string' && name in WORKFLOWS
}

export const POST: APIRoute = async ({ request }) => {
	if (!authorized(request)) return json({ error: 'No autorizado' }, 401)
	const body = (await request.json().catch(() => null)) as { workflow?: unknown; params?: Record<string, unknown> } | null
	if (!body || !isWorkflow(body.workflow)) {
		return json({ error: `workflow debe ser uno de: ${Object.keys(WORKFLOWS).join(', ')}` }, 400)
	}

	const params = body.params ?? {}
	// Las ventanas de info64 llevan id predecible: relanzar la misma no la duplica.
	const id =
		body.workflow === 'info64' &&
		!params.keys &&
		params.pairings !== 'only' &&
		typeof params.from === 'string' &&
		typeof params.to === 'string'
			? windowInstanceId(params.from, params.to, params.standings === 'only' ? 'only' : undefined)
			: undefined
	const instance = await WORKFLOWS[body.workflow]().create({ id, params: params as never })
	return json({ id: instance.id, status: await instance.status() }, 201)
}

export const GET: APIRoute = async ({ request, url }) => {
	if (!authorized(request)) return json({ error: 'No autorizado' }, 401)
	const workflow = url.searchParams.get('workflow')
	const id = url.searchParams.get('id')
	if (!isWorkflow(workflow) || !id) return json({ error: 'Faltan workflow o id' }, 400)
	const instance = await WORKFLOWS[workflow]().get(id)
	return json({ id, status: await instance.status() })
}
