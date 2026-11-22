import { describe, expect, it } from 'vitest'
import { jsonLd, tournamentEvent, websiteData, type EventTournament } from '../src/lib/structured-data'

describe('jsonLd', () => {
	it('escapa "<": un nombre con «</script>» no cierra la etiqueta y se lee igual', () => {
		const data = { name: 'Open </script><script>alert(1)</script> 2026' }
		const text = jsonLd(data)
		expect(text).not.toContain('<')
		expect(text).toContain('\\u003c/script>')
		expect(JSON.parse(text)).toEqual(data)
	})
})

describe('websiteData', () => {
	it('el nombre y la URL del sitio, sin SearchAction', () => {
		expect(websiteData('https://maplechess.es/')).toEqual({
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: 'MapleChess',
			url: 'https://maplechess.es/'
		})
	})
})

describe('tournamentEvent', () => {
	const url = 'https://maplechess.es/torneos/12'
	const today = '2026-11-22'
	const open: EventTournament = {
		name: 'Open Inventado de Bilbao 2026',
		city: 'Bilbao',
		startDate: '2026-11-20',
		endDate: '2026-11-29',
		provincia: '48'
	}
	const event = (t: Partial<EventTournament>, indexable = true) =>
		tournamentEvent({ ...open, ...t }, { url, indexable, today })

	it('uno en curso: sus fechas, el sitio con la provincia y la URL, sin personas', () => {
		expect(event({})).toEqual({
			'@context': 'https://schema.org',
			'@type': 'SportsEvent',
			name: 'Open Inventado de Bilbao 2026',
			startDate: '2026-11-20',
			endDate: '2026-11-29',
			eventStatus: 'https://schema.org/EventScheduled',
			eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
			sport: 'Ajedrez',
			url,
			location: {
				'@type': 'Place',
				name: 'Bilbao',
				address: { '@type': 'PostalAddress', addressRegion: 'Bizkaia', addressCountry: 'ES' }
			}
		})
	})

	it('la ciudad es texto libre: va como nombre del sitio; sin ella, el de la provincia', () => {
		expect(event({ city: 'Calle Inventada, 14. Palma', provincia: '07' })?.location).toEqual({
			'@type': 'Place',
			name: 'Calle Inventada, 14. Palma',
			address: { '@type': 'PostalAddress', addressRegion: 'Islas Baleares', addressCountry: 'ES' }
		})
		expect(event({ city: null })?.location).toMatchObject({ name: 'Bizkaia' })
		expect(event({ city: '  ' })?.location).toMatchObject({ name: 'Bizkaia' })
	})

	it('uno por empezar, y el que acaba hoy, sí', () => {
		expect(event({ startDate: '2026-12-05', endDate: '2026-12-07' })).not.toBeNull()
		expect(event({ endDate: today })).not.toBeNull()
	})

	it('sin fin, por su inicio: el de hoy sí, el de ayer no, y sin endDate', () => {
		const sameDay = event({ startDate: today, endDate: null })
		expect(sameDay).not.toBeNull()
		expect(sameDay).not.toHaveProperty('endDate')
		expect(event({ startDate: '2026-11-21', endDate: null })).toBeNull()
	})

	it('nada si ha terminado, no se indexa, no tiene fecha de inicio o no es de una provincia conocida', () => {
		expect(event({ endDate: '2026-11-21' })).toBeNull()
		expect(event({}, false)).toBeNull()
		expect(event({ startDate: null })).toBeNull()
		expect(event({ provincia: null })).toBeNull()
		expect(event({ provincia: '99' })).toBeNull()
	})
})
