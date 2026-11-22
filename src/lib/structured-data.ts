// Datos estructurados (JSON-LD de schema.org): el WebSite de la portada y el
// SportsEvent de los torneos en curso o por jugar. Sin personas: ni
// jugadores, ni organizadores, ni árbitros (docs/decisiones.md, «Datos
// estructurados»).
import { PROVINCE_NAME } from './toponimos'

export type StructuredData = Record<string, unknown>

const CONTEXT = 'https://schema.org'
const SITE_NAME = 'MapleChess'

/**
 * El texto del <script type="application/ld+json">, con "<" escapado: los
 * nombres de torneo vienen de fuera y un «</script>» cerraría la etiqueta. Es
 * el mismo escapado del JSON del visor (VisorPartida.astro).
 */
export function jsonLd(data: StructuredData): string {
	return JSON.stringify(data).replace(/</g, '\\u003c')
}

/** El sitio, para que Google no adivine su nombre. Sin SearchAction: Google lo retiró en 2024. */
export function websiteData(url: string): StructuredData {
	return { '@context': CONTEXT, '@type': 'WebSite', name: SITE_NAME, url }
}

export interface EventTournament {
	name: string
	city: string | null
	startDate: string | null
	endDate: string | null
	/** Código del INE; NULL si se juega fuera de España o no se reconoce el sitio. */
	provincia: string | null
}

/**
 * El torneo como evento, sólo si su página se indexa, se juega en una
 * provincia que conocemos y aún no ha terminado (el fin, o el inicio si no lo
 * hay, desde `today`, el día en Madrid). Si no, null: lo terminado ya no es un
 * evento, y sin el sitio Google no lo enseña.
 *
 * La ciudad es texto libre del organizador («Calle Alava, 14. Madrid», un
 * hotel), así que va como nombre del sitio y no como localidad; la dirección
 * sólo lleva la provincia y el país.
 */
export function tournamentEvent(
	t: EventTournament,
	{ url, indexable, today }: { url: string; indexable: boolean; today: string }
): StructuredData | null {
	const region = t.provincia === null ? undefined : PROVINCE_NAME.get(t.provincia)
	if (!indexable || !t.startDate || !region || (t.endDate ?? t.startDate) < today) return null
	return {
		'@context': CONTEXT,
		'@type': 'SportsEvent',
		name: t.name,
		startDate: t.startDate,
		...(t.endDate ? { endDate: t.endDate } : {}),
		eventStatus: `${CONTEXT}/EventScheduled`,
		eventAttendanceMode: `${CONTEXT}/OfflineEventAttendanceMode`,
		sport: 'Ajedrez',
		url,
		location: {
			'@type': 'Place',
			name: t.city?.trim() || region,
			address: { '@type': 'PostalAddress', addressRegion: region, addressCountry: 'ES' }
		}
	}
}
