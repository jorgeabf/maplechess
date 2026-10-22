// Panel de búsqueda de la cabecera (el popover de Base.astro): se cierra cuando
// el foco sale de él hacia otro elemento de la página. Un popover «auto» sólo se
// cierra al pulsar fuera o con Esc; con el tabulador, el foco pasaba al primer
// enlace de la página, que quedaba tapado por el panel abierto (WCAG 2.4.11).
//
// Sólo si el foco va a otro elemento: sin relatedTarget no se cierra. Safari no
// enfoca los botones al pulsarlos, así que al tocar «Buscar» el campo pierde el
// foco sin decir adónde va, y cerrar ahí impediría enviar el formulario. Pulsar
// fuera del panel ya lo cierra el propio popover.
for (const panel of document.querySelectorAll<HTMLElement>('form[popover]')) {
	panel.addEventListener('focusout', (event) => {
		const next = event.relatedTarget
		if (next instanceof Node && !panel.contains(next) && panel.matches(':popover-open')) panel.hidePopover()
	})
}
