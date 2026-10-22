// Genera src/lib/chess/openings.json a partir de los TSV de lichess
// (data/openings/*.tsv, CC0): una lista de [EPD, ECO, nombre].
//
// Se indexa por posición (EPD) y no por secuencia de jugadas para que las
// transposiciones reciban el nombre correcto. El EPD se calcula con chessops,
// igual que al clasificar las partidas, para que las claves coincidan.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chessops/chess'
import { makeFen } from 'chessops/fen'
import { parsePgn } from 'chessops/pgn'
import { parseSan } from 'chessops/san'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'data', 'openings')
const outFile = join(root, 'src', 'lib', 'chess', 'openings.json')

const positions = new Map()
let maxPly = 0

for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.tsv')).sort()) {
	const [, ...rows] = readFileSync(join(dataDir, file), 'utf8').trim().split(/\r?\n/)
	for (const row of rows) {
		const [eco, name, pgn] = row.split('\t')
		const [game] = parsePgn(pgn)
		const pos = Chess.default()
		let ply = 0
		for (const node of game.moves.mainline()) {
			const move = parseSan(pos, node.san)
			if (!move) throw new Error(`${file}: jugada ilegal "${node.san}" en ${eco} ${name}`)
			pos.play(move)
			ply++
		}
		maxPly = Math.max(maxPly, ply)
		// Si dos líneas llegan a la misma posición, gana la primera (orden de lichess).
		const epd = makeFen(pos.toSetup(), { epd: true })
		if (!positions.has(epd)) positions.set(epd, [epd, eco, name])
	}
}

writeFileSync(outFile, JSON.stringify({ maxPly, positions: [...positions.values()] }) + '\n')
console.log(`[openings] ${positions.size} posiciones, maxPly=${maxPly} → ${outFile}`)
