// Elegir la pieza al coronar, en el visor y en el explorador del repertorio:
// un peón que llega a la última fila abre el diálogo de Coronacion.astro, que
// se cierra con la pieza elegida o sin ninguna (Cancelar, Esc).
import type { Position } from 'chessops/chess'
import type { Color } from 'chessops/types'
import { parseSquare } from 'chessops/util'

export const PROMOTION_ROLES = ['queen', 'rook', 'bishop', 'knight'] as const
export type PromotionRole = (typeof PROMOTION_ROLES)[number]

/** La jugada de `orig` a `dest` lleva un peón a la última fila: hay que elegir a qué corona. */
export function promotes(pos: Position, orig: string, dest: string): boolean {
	const from = parseSquare(orig)
	return from !== undefined && pos.board.getRole(from) === 'pawn' && /[18]$/.test(dest)
}

/**
 * Abre el diálogo con las piezas de `color` y da la elegida, o null si se
 * cancela. returnValue se vacía antes: Esc cierra sin tocarlo, y quedaría la
 * pieza de la vez anterior.
 */
export function choosePromotion(dialog: HTMLDialogElement, color: Color): Promise<PromotionRole | null> {
	dialog.dataset.color = color
	dialog.returnValue = ''
	dialog.showModal()
	return new Promise((resolve) => {
		dialog.addEventListener('close', () => resolve(PROMOTION_ROLES.find((role) => role === dialog.returnValue) ?? null), {
			once: true
		})
	})
}
