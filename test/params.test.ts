import { describe, expect, it } from 'vitest'
import {
	backTarget,
	boardColor,
	dossierHref,
	gameFilters,
	gameHref,
	gameSearchKind,
	isPlayerSearch,
	pageParam,
	playerFilters,
	positiveInt,
	rankingCategory,
	roundParam,
	tournamentFilters
} from '../src/lib/params'

function kind(query: string) {
	const { page: _page, ...filters } = gameFilters(new URLSearchParams(query))
	return gameSearchKind(filters)
}

describe('positiveInt', () => {
	it('lee enteros positivos y descarta lo demás', () => {
		expect(positiveInt('9228291')).toBe(9228291)
		expect(positiveInt('12abc')).toBe(12)
		for (const value of ['0', '-3', 'abc', '', null, undefined]) expect(positiveInt(value)).toBeNull()
	})

	it('descarta los que no caben en un entero seguro (desbordarían el OFFSET)', () => {
		expect(positiveInt('1000000000000000000')).toBeNull()
		expect(pageParam('1000000000000000000')).toBe(1)
		expect(pageParam('3')).toBe(3)
	})
})

describe('pageParam', () => {
	it('sin tope: el de las búsquedas lo ponen ellas (searchPage), y la ficha y los torneos llegan hasta el final', () => {
		expect(gameFilters(new URLSearchParams('p=40')).page).toBe(40)
		expect(tournamentFilters(new URLSearchParams('p=250')).page).toBe(250)
	})
})

describe('gameSearchKind', () => {
	it('sin filtros no busca', () => {
		expect(kind('')).toBe('empty')
		// El formulario envía siempre el color y el ritmo.
		expect(kind('jugador=&color=any&rival=&ritmo=')).toBe('empty')
	})

	it('color, ritmo y resultado solos sólo afinan', () => {
		expect(kind('color=white')).toBe('refine')
		expect(kind('ritmo=blitz')).toBe('refine')
		expect(kind('resultado=1-0')).toBe('refine')
	})

	it('busca con nombre, apertura, fechas o torneo', () => {
		expect(kind('jugador=anton&ritmo=blitz')).toBe('search')
		expect(kind('rival=guijarro')).toBe('search')
		expect(kind('eco=B90')).toBe('search')
		expect(kind('desde=2025-01-01')).toBe('search')
		expect(kind('torneo=5')).toBe('search')
	})

	it('lo que no es un filtro no cuenta', () => {
		expect(kind('eco=zz')).toBe('empty')
		expect(kind('jugador=-')).toBe('empty')
		expect(kind('ritmo=xyz')).toBe('empty')
		expect(kind('desde=ayer')).toBe('empty')
	})

	it('una letra suelta no busca; junto a otra palabra, sí', () => {
		expect(kind('jugador=a')).toBe('empty')
		expect(kind('jugador=a+b&rival=c')).toBe('empty')
		expect(kind('jugador=j+garcia')).toBe('search')
	})
})

describe('isPlayerSearch', () => {
	const search = (query: string) => isPlayerSearch(playerFilters(new URLSearchParams(query)))

	it('busca con nombre, título, sexo o ELO', () => {
		expect(search('q=guijarro')).toBe(true)
		expect(search('titulo=GM')).toBe(true)
		expect(search('sexo=F')).toBe(true)
		expect(search('elo_min=1875')).toBe(true)
	})

	it('sin filtros reales no busca', () => {
		expect(search('')).toBe(false)
		expect(search('q=-')).toBe(false)
		expect(search('q=a')).toBe(false)
		expect(search('q=&titulo=&sexo=&elo_min=&elo_max=')).toBe(false)
		expect(search('titulo=XX')).toBe(false)
	})

	it('«Sólo con partidas» afina, pero sola no busca', () => {
		expect(playerFilters(new URLSearchParams('q=garcia&con_partidas=1')).withGames).toBe(true)
		expect(playerFilters(new URLSearchParams('q=garcia')).withGames).toBe(false)
		expect(search('con_partidas=1')).toBe(false)
	})

	it('«Sólo activos» también afina sin buscar', () => {
		expect(playerFilters(new URLSearchParams('elo_min=1800&activos=1')).active).toBe(true)
		expect(playerFilters(new URLSearchParams('elo_min=1800')).active).toBe(false)
		expect(search('activos=1')).toBe(false)
	})
})

describe('rankingCategory', () => {
	const category = (query: string) => rankingCategory(new URLSearchParams(query))

	it('femenino, sub-18, +50 o +65; si no, el absoluto', () => {
		expect(category('categoria=femenino')).toBe('femenino')
		expect(category('categoria=sub18')).toBe('sub18')
		expect(category('categoria=mas50')).toBe('mas50')
		expect(category('categoria=mas65')).toBe('mas65')
		expect(category('')).toBe('')
		expect(category('categoria=sub8')).toBe('')
	})

	it('no lanza una búsqueda de jugadores', () => {
		expect(isPlayerSearch(playerFilters(new URLSearchParams('categoria=femenino')))).toBe(false)
	})
})

describe('gameHref', () => {
	it('blancas no va en la URL; negras, sí', () => {
		expect(gameHref(12)).toBe('/partidas/12')
		expect(gameHref(12, 'white')).toBe('/partidas/12')
		expect(gameHref(12, 'black')).toBe('/partidas/12?color=black')
	})

	it('con ply, abre la partida en esa jugada', () => {
		expect(gameHref(12, 'white', 9)).toBe('/partidas/12#j9')
		expect(gameHref(12, 'black', 9)).toBe('/partidas/12?color=black#j9')
		expect(gameHref(12, undefined, 0)).toBe('/partidas/12')
	})
})

describe('dossierHref', () => {
	it('el color que se pide va siempre en la URL, también blancas', () => {
		expect(dossierHref(12, 'white')).toBe('/jugadores/12/preparar?color=white')
		expect(dossierHref(12, 'black')).toBe('/jugadores/12/preparar?color=black')
	})

	it('sin color, lo decide el dossier', () => {
		expect(dossierHref(12)).toBe('/jugadores/12/preparar')
	})
})

describe('boardColor', () => {
	it('sólo blancas o negras', () => {
		expect(boardColor(new URLSearchParams('color=black'))).toBe('black')
		expect(boardColor(new URLSearchParams('color=white'))).toBe('white')
		expect(boardColor(new URLSearchParams('color=any'))).toBeNull()
		expect(boardColor(new URLSearchParams(''))).toBeNull()
	})
})

describe('tournamentFilters', () => {
	it('«Próximos» con cuando=proximos, y entonces sin «Sólo con partidas»', () => {
		const filters = (query: string) => tournamentFilters(new URLSearchParams(query))
		expect(filters('con_partidas=1')).toMatchObject({ upcoming: false, withGames: true })
		expect(filters('cuando=proximos&con_partidas=1')).toMatchObject({ upcoming: true, withGames: false })
		expect(filters('cuando=otro')).toMatchObject({ upcoming: false })
	})

	it('la modalidad, individual o por equipos; vacía o desconocida, las dos', () => {
		const type = (query: string) => tournamentFilters(new URLSearchParams(query)).type
		expect(type('modalidad=individual')).toBe('individual')
		expect(type('modalidad=equipos')).toBe('team')
		expect(type('modalidad=team')).toBeNull()
		expect(type('modalidad=')).toBeNull()
		expect(type('')).toBeNull()
	})
})

describe('roundParam', () => {
	it('un número de ronda, también el 0 (sin ronda); si no, todas', () => {
		const round = (query: string) => roundParam(new URLSearchParams(query))
		expect(round('ronda=5')).toBe(5)
		expect(round('ronda=0')).toBe(0)
		expect(round('ronda=x')).toBeNull()
		expect(round('ronda=-1')).toBeNull()
		expect(round('ronda=1000')).toBeNull()
		expect(round('')).toBeNull()
	})
})

describe('backTarget', () => {
	const here = new URL('https://ajedrez.example/partidas/875')
	const from = (path: string) => backTarget(`https://ajedrez.example${path}`, here)

	it('vuelve a la búsqueda, al torneo, a la ficha, al dossier o al repertorio, con su consulta', () => {
		expect(from('/partidas?jugador=P%C3%A9rez&p=2')).toEqual({
			href: '/partidas?jugador=P%C3%A9rez&p=2',
			kind: 'search',
			fideId: null
		})
		expect(from('/torneos/12')).toEqual({ href: '/torneos/12', kind: 'tournament', fideId: null })
		expect(from('/jugadores/2200000')).toEqual({ href: '/jugadores/2200000', kind: 'player', fideId: 2200000 })
		expect(from('/jugadores/2200000/preparar?color=black')).toEqual({
			href: '/jugadores/2200000/preparar?color=black',
			kind: 'dossier',
			fideId: 2200000
		})
		expect(from('/jugadores/2200000/repertorio')).toMatchObject({ kind: 'repertoire', fideId: 2200000 })
	})

	it('nada desde otra partida, la portada u otras páginas', () => {
		expect(from('/partidas/874')).toBeNull()
		expect(from('/')).toBeNull()
		expect(from('/torneos')).toBeNull()
		expect(from('/jugadores/2200000/otra')).toBeNull()
	})

	it('sólo desde esta web', () => {
		expect(backTarget('https://otra.example/torneos/12', here)).toBeNull()
		expect(backTarget('http://ajedrez.example/torneos/12', here)).toBeNull()
		expect(backTarget(null, here)).toBeNull()
		expect(backTarget('no es una URL', here)).toBeNull()
	})
})
