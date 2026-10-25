import { describe, expect, it } from 'vitest'
import { cityPlace, tournamentPlace } from '../src/lib/lugares'

// Ciudades como las escriben los organizadores; nombres de torneo inventados.
const province = (city: string) => {
	const place = cityPlace(city)
	return place === 'extranjero' || place === null ? place : place.province
}

describe('cityPlace', () => {
	it('un municipio, por cualquiera de sus nombres, con el artículo delante o sin él y sin tildes', () => {
		expect(cityPlace('Gijón')).toEqual({ province: '33', community: '03', approximate: false })
		expect(province('ALICANTE')).toBe('03')
		expect(province('Alacant')).toBe('03')
		expect(province('Donostia')).toBe('20')
		expect(province('A Coruna')).toBe('15')
		expect(province('Las Palmas de Gran Canaria')).toBe('35')
		expect(province("l'Alcúdia de Crespins")).toBe('46')
		expect(province('El Campello')).toBe('03')
	})

	it('por sus trozos, con la provincia que nombra para elegir', () => {
		expect(province('Collado Villalba (Madrid)')).toBe('28')
		expect(province('Marbella (Hotel Alanda)')).toBe('29')
		expect(province('Barcelona, Spain')).toBe('08')
		expect(province('Cubillos del Sil - Ponferrada')).toBe('24')
		expect(province('Logroño, Alfaro, Calahorra')).toBe('26')
		expect(province('Andújar y Mengíbar')).toBe('23')
		// Sin separar: el final es la provincia.
		expect(province('Cartagena Murcia')).toBe('30')
		expect(province('Circulo Bellas Artes de Madrid')).toBe('28')
	})

	it('las calles no son el sitio', () => {
		expect(province('Calle Alava, 14. Madrid')).toBe('28')
		expect(province('Jaen, C/ Maestra 16')).toBe('23')
		// No es Cifuentes (Guadalajara): sin otro sitio, no se sabe.
		expect(cityPlace('"La Nave" C/Cifuentes, 5 (Mad)')).toBeNull()
		expect(province('Lekunberri -Burundegi Kalea, 9')).toBe('31')
	})

	it('abreviaturas', () => {
		expect(province('Vva. de los Infantes')).toBe('13')
		expect(province('Las Palmas de GC')).toBe('35')
		expect(province('S. S. de los Reyes')).toBe('28')
		expect(province('Argamasilla de Alba (C. Real)')).toBe('13')
	})

	it('entre homónimos, el que tiene diez veces más habitantes; si no, el que nombra la provincia', () => {
		expect(province('Mieres')).toBe('33')
		expect(province('Torrent')).toBe('46')
		// «Grado» es Grado (Asturias); «El Grado» (Huesca) va con el artículo.
		expect(province('Grado')).toBe('33')
		expect(province('El Grado')).toBe('22')
	})

	it('aproximado: un núcleo de población, una media denominación o un principio de nombre', () => {
		expect(cityPlace('Trevias')).toEqual({ province: '33', community: '03', approximate: true })
		expect(cityPlace('Vitoria')).toEqual({ province: '01', community: '16', approximate: true })
		expect(province('Vilagarcía')).toBe('36')
		expect(province('Las Rozas (Madrid)')).toBe('28')
		// Con la provincia escrita, la provincia es segura.
		expect(cityPlace('Sotopalacios (Burgos)')).toEqual({ province: '09', community: '07', approximate: false })
		expect(province('Vecindario (Santa Lucia)')).toBe('35')
	})

	it('sólo la provincia, la isla o la comunidad', () => {
		expect(province('Asturias')).toBe('33')
		expect(province('Muriedas (Cantabria)')).toBe('39')
		expect(province('Lanzarote')).toBe('35')
		expect(province('Palma de Mallorca')).toBe('07')
		expect(cityPlace('Extremadura')).toEqual({ province: null, community: '11', approximate: false })
		expect(cityPlace('Catalunya, Spain')).toEqual({ province: null, community: '09', approximate: false })
		// Con la comunidad, sus provincias: hay Malpartidas en Cáceres y en Badajoz (y en Salamanca, que no cuenta).
		expect(cityPlace('Malpartida (Extremadura)')).toEqual({ province: null, community: '11', approximate: false })
		expect(province('Bejar (Castilla Leon)')).toBe('37')
	})

	it('el extranjero', () => {
		expect(cityPlace('Budva, Montenegro')).toBe('extranjero')
		expect(cityPlace('Teplice, Chequia')).toBe('extranjero')
		// Montijo también es un municipio de Badajoz.
		expect(cityPlace('Montijo, Portugal')).toBe('extranjero')
		expect(cityPlace('Havana, Cuba')).toBe('extranjero')
		// Montserrat, Granada y La Cuba también son sitios de aquí.
		expect(province('Montserrat (Valencia)')).toBe('46')
		expect(province('Montserrat')).toBe('46')
		expect(province('Granada')).toBe('18')
	})

	it('lo que no se reconoce', () => {
		expect(cityPlace(null)).toBeNull()
		expect(cityPlace('Gran Hotel Bali')).toBeNull()
		expect(cityPlace('chess.com')).toBeNull()
		expect(cityPlace('España')).toBeNull()
	})
})

describe('tournamentPlace', () => {
	it('manda la ciudad, aunque el nombre diga otro sitio', () => {
		expect(tournamentPlace('Gijon', 'Memorial Gallego 2026')).toEqual({ province: '33', community: '03' })
		expect(tournamentPlace('Villanueva de la Reina', 'Memorial Inventado Navarro 2026')).toEqual({
			province: '23',
			community: '01'
		})
	})

	it('si la ciudad no lo dice, el nombre', () => {
		expect(tournamentPlace(null, 'Cto Individual Preferente Alavesa 2026')).toEqual({ province: '01', community: '16' })
		expect(tournamentPlace('Club Inventado', 'Campeonato Gallego de Prueba')).toEqual({ province: null, community: '12' })
		expect(tournamentPlace('chess.com', 'Open Online de Asturias')).toEqual({ province: '33', community: '03' })
		// Dos comunidades: no se sabe.
		expect(tournamentPlace(null, 'Encuentro Galicia Asturias')).toEqual({ province: null, community: null })
	})

	it('con sólo la comunidad, el nombre puede decir la provincia', () => {
		expect(tournamentPlace('Villafranca B. (Extremadura)', 'Circuito Diputación de Badajoz')).toEqual({
			province: '06',
			community: '11'
		})
	})

	it('un cruce aproximado no se impone al sitio que dice el nombre', () => {
		// «Torrente» es Torrente de Cinca (Huesca) por el principio de su nombre: es Torrent.
		expect(tournamentPlace('Torrente', 'Open Inventado de Valencia')).toEqual({ province: '46', community: '10' })
		expect(tournamentPlace('Torrente', 'Open Inventado')).toEqual({ province: '22', community: '02' })
		expect(tournamentPlace('Trevias', 'Torneo de Prueba de Asturias')).toEqual({ province: '33', community: '03' })
	})

	it('un torneo del extranjero no tiene sitio, aunque su nombre lo parezca', () => {
		expect(tournamentPlace('Budva, Montenegro', 'Open de Prueba Asturias')).toEqual({ province: null, community: null })
	})
})
