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

	it('aproximado: sin los conectores, como los omiten los organizadores', () => {
		expect(cityPlace('San Pedro Alcántara')).toEqual({ province: '29', community: '01', approximate: true })
		expect(province('SAN PEDRO ALCANTÁRA')).toBe('29')
		expect(province('Villarejo Salvanes')).toBe('28')
		expect(province('Santiago Compostela')).toBe('15')
		expect(province('Puerto Sta. Maria')).toBe('11')
		expect(province('Muros del Nalón')).toBe('33')
		expect(province('Vilanova i Geltrú')).toBe('08')
		// Dos trozos aproximados: gana Colònia de Sant Jordi, con diez veces más habitantes que Las Salinas (Valladolid).
		expect(province('Colonia Sant Jordi/Las Salinas')).toBe('07')
	})

	it('sin los conectores, sólo si el trozo no casa con nada', () => {
		// Un núcleo con ese nombre exacto, no «Costa de la Calma» (Mallorca).
		expect(province('Costa Calma')).toBe('35')
		// La provincia escrita sigue separándose: no es «Casas de Sevilla», ni aproximado.
		expect(province('Casas Sevilla')).toBe('41')
		expect(cityPlace('Rozas Madrid')).toEqual({ province: '28', community: '13', approximate: false })
	})

	it('los núcleos, sin el punto de las letras asturianas y por cada denominación', () => {
		expect(cityPlace('Luarca')).toEqual({ province: '33', community: '03', approximate: true })
		expect(province('Respaldiza')).toBe('01')
		expect(province('Arespalditza')).toBe('01')
		expect(province('Donostia San Sebastian')).toBe('20')
		// En Mallorca, el punto es la ele geminada.
		expect(province('Es Pil·larí')).toBe('07')
	})

	it('los nombres de siempre que el INE no da', () => {
		expect(cityPlace('Alfaz del Pi')).toEqual({ province: '03', community: '10', approximate: false })
		expect(cityPlace('Mieres del Camino')).toEqual({ province: '33', community: '03', approximate: false })
		expect(cityPlace('Roa de Duero')).toEqual({ province: '09', community: '07', approximate: false })
	})

	it('un municipio al principio no basta: lo demás puede ser el sitio', () => {
		expect(cityPlace('Aldea de los Rios')).toBeNull()
		expect(cityPlace('Valle de Aranguren')).toBeNull()
		expect(cityPlace('Andorra la Vella')).toBeNull()
	})

	it('sólo la provincia, la isla o la comunidad', () => {
		expect(province('Asturias')).toBe('33')
		expect(province('Muriedas (Cantabria)')).toBe('39')
		expect(province('Lanzarote')).toBe('35')
		expect(province('Palma de Mallorca')).toBe('07')
		expect(cityPlace('Extremadura')).toEqual({ province: null, community: '11', approximate: false })
		expect(cityPlace('Catalunya, Spain')).toEqual({ province: null, community: '09', approximate: false })
		expect(cityPlace('Catalonia, Spain')).toEqual({ province: null, community: '09', approximate: false })
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

	it('una ciudad de fuera escrita sola no dice el sitio; con la tilde o con algo más, sí', () => {
		// Caerían en Gaià (Barcelona) y en un núcleo de Vélez-Málaga.
		expect(cityPlace('Gaia')).toBeNull()
		expect(cityPlace(' LAGOS ')).toBeNull()
		expect(province('Gaià')).toBe('08')
		expect(province('Gaia, España')).toBe('08')
		expect(province('Gaia (Barcelona)')).toBe('08')
		expect(province('Lagos, Spain')).toBe('29')
		expect(province('Lagos (Málaga)')).toBe('29')
		expect(province('Lagos, Vélez-Málaga')).toBe('29')
		expect(cityPlace('Lagos, Portugal')).toBe('extranjero')
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
		expect(tournamentPlace('Budva, Montenegro', 'Open de Boadilla del Monte')).toEqual({
			province: null,
			community: null
		})
	})

	it('con una ciudad de fuera escrita sola, sin sitio, salvo que lo diga el nombre', () => {
		expect(tournamentPlace('Gaia', 'Copa de Prueba 2026')).toEqual({ province: null, community: null })
		expect(tournamentPlace('Lagos', 'Open de Málaga')).toEqual({ province: '29', community: '01' })
	})

	describe('un municipio en el nombre, si la ciudad no dice el sitio y el nombre no dice una comunidad', () => {
		const madrid = { province: '28', community: '13' }
		const barcelona = { province: '08', community: '09' }
		const cadiz = { province: '11', community: '01' }
		const nowhere = { province: null, community: null }

		it('de tres palabras o más, por cualquier forma de su nombre', () => {
			expect(tournamentPlace('Spain', 'Open de Prueba Barbera del Valles 2026')).toEqual(barcelona)
			expect(tournamentPlace('Spain', "Blitz de Prueba d'Escacs de Barberà del Vallès")).toEqual(barcelona)
			expect(tournamentPlace(null, 'Open de Prueba Boadilla del Monte')).toEqual(madrid)
			expect(tournamentPlace('Sala Inventada', 'Open El Puerto de Santa María')).toEqual(cadiz)
			// Sin el artículo que el INE pospone.
			expect(tournamentPlace('Sala Inventada', 'Open Puerto de Santa María')).toEqual(cadiz)
		})

		it('el más largo: «Aldea del Obispo» es otro, de Salamanca', () => {
			expect(tournamentPlace(null, 'Open La Aldea del Obispo')).toEqual({ province: '10', community: '11' })
		})

		it('dos de una provincia, sí; de dos provincias, no se sabe', () => {
			expect(tournamentPlace(null, 'Copa Boadilla del Monte y Villarejo de Salvanés')).toEqual(madrid)
			expect(tournamentPlace(null, 'Copa Boadilla del Monte y Puerto del Rosario')).toEqual(nowhere)
		})

		it('dos comunidades en el nombre no dicen el sitio; el municipio, sí', () => {
			expect(tournamentPlace(null, 'Encuentro Galicia Asturias en Boadilla del Monte')).toEqual(madrid)
		})

		it('con menos palabras, no: «San Pedro» Alcántara no es el de Albacete', () => {
			expect(tournamentPlace('Sala Inventada', 'Open Santa Bárbara 2026')).toEqual(nowhere)
			expect(tournamentPlace('Sala Inventada', 'Torneo San Pedro Alcántara')).toEqual(nowhere)
		})

		it('sin los cruces aproximados: un barrio no es un núcleo de otra provincia', () => {
			expect(tournamentPlace('Sala Inventada', 'Torneo Barrio San José Obrero')).toEqual(nowhere)
		})

		it('la ciudad y la provincia del nombre mandan sobre él', () => {
			expect(tournamentPlace('Gijon', 'Memorial Boadilla del Monte')).toEqual({ province: '33', community: '03' })
			expect(tournamentPlace(null, 'Open de Asturias en Boadilla del Monte')).toEqual({
				province: '33',
				community: '03'
			})
		})

		it('una ciudad con un cruce aproximado también manda', () => {
			expect(tournamentPlace('Torrente', 'Open Boadilla del Monte')).toEqual({ province: '22', community: '02' })
		})
	})
})
