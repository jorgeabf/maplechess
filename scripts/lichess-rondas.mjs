// Carga inicial de las retransmisiones de lichess: saca de los volcados
// mensuales de database.lichess.org (lichess_db_broadcast_YYYY-MM.pgn.zst,
// CC BY-SA 4.0) una ronda de cada torneo en el que juega algún español con
// partidas con jugadas. El Workflow de lichess las recibe en `rounds`, pide el
// torneo de cada una y decide qué hacer con él, como en la pasada diaria.
//
// Uso:
//   wrangler d1 execute DB --remote --json --command "SELECT fide_id FROM players" > jugadores.json
//   node scripts/lichess-rondas.mjs jugadores.json lichess_db_broadcast_2026-0*.pgn.zst > rondas.json
//
// Los volcados son de pzstd: marcos zstd precedidos de un marco saltable con
// el tamaño del siguiente. Hace falta Node 22.15 o posterior (zlib con zstd).
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const [playersFile, ...dumps] = process.argv.slice(2)
if (!playersFile || dumps.length === 0) {
	console.error('Uso: node scripts/lichess-rondas.mjs jugadores.json volcado.pgn.zst...')
	process.exit(1)
}

// Salida de `wrangler d1 execute --json`: [{ results: [{ fide_id }] }].
const spanish = new Set(JSON.parse(readFileSync(playersFile, 'utf8'))[0].results.map((r) => r.fide_id))

/** Texto de un .pgn.zst de pzstd, marco a marco. */
function* frames(buffer) {
	let offset = 0
	while (offset < buffer.length) {
		const magic = buffer.readUInt32LE(offset)
		// Marco saltable (0x184D2A5?): si trae 4 bytes, son el tamaño del marco siguiente.
		if ((magic & 0xfffffff0) === 0x184d2a50) {
			const size = buffer.readUInt32LE(offset + 4)
			const next = size === 4 ? buffer.readUInt32LE(offset + 8) : null
			offset += 8 + size
			if (next === null) continue
			yield zstdDecompressSync(buffer.subarray(offset, offset + next))
			offset += next
		} else {
			// zstd normal, sin marcos saltables.
			yield zstdDecompressSync(buffer.subarray(offset))
			return
		}
	}
}

/** Una ronda por torneo: clave = slug y nombre del torneo. */
const rounds = new Map()
let games = 0

function finish(headers, hasMoves) {
	if (!hasMoves || !headers.BroadcastURL) return
	const white = Number(headers.WhiteFideId)
	const black = Number(headers.BlackFideId)
	if (!spanish.has(white) && !spanish.has(black)) return
	// https://lichess.org/broadcast/{torneo}/{ronda}/{idRonda}
	const [, slug, , roundId] = new URL(headers.BroadcastURL).pathname.split('/').filter(Boolean)
	if (!roundId) return
	games++
	const key = `${slug}|${headers.BroadcastName ?? ''}`
	if (!rounds.has(key)) rounds.set(key, roundId)
}

for (const file of dumps) {
	const decoder = new TextDecoder()
	let rest = ''
	let headers = {}
	let hasMoves = false
	let inMoves = false
	const line = (text) => {
		if (text.startsWith('[')) {
			if (inMoves) {
				finish(headers, hasMoves)
				headers = {}
				hasMoves = false
				inMoves = false
			}
			const match = /^\[(\w+)\s+"(.*)"\]$/.exec(text)
			if (match) headers[match[1]] = match[2]
		} else if (text.trim() !== '') {
			inMoves = true
			if (!hasMoves && /(?:^|\s)1\.\s*[KQRBNOa-h]/.test(text)) hasMoves = true
		}
	}
	for (const chunk of frames(readFileSync(file))) {
		const lines = (rest + decoder.decode(chunk, { stream: true })).split(/\r?\n/)
		rest = lines.pop() ?? ''
		for (const text of lines) line(text)
	}
	line(rest + decoder.decode())
	finish(headers, hasMoves)
	console.error(`${basename(file)}: ${rounds.size} torneos con españoles hasta ahora`)
}

console.error(`${games} partidas con españoles en ${rounds.size} torneos`)
console.log(JSON.stringify([...rounds.values()]))
