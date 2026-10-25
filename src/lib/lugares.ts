// Dónde se juega un torneo: su provincia y su comunidad (códigos del INE),
// sacadas de la ciudad que escribe el organizador y, si ésta no lo dice, de su
// nombre. Lo guarda la ingesta con el torneo (upsertTournament) y lo usa la
// búsqueda de /torneos.
//
// La ciudad es texto libre: «Collado Villalba (Madrid)», «Calle Alava, 14.
// Madrid», «Vva. de los Infantes», «Trevias», «Gran Hotel Bali», «Budva,
// Montenegro». Se busca por sus trozos en los municipios del INE (con sus
// nombres cooficiales y el artículo delante o sin él) y, si no, en los núcleos
// de población del IGN y en los principios de nombre («Vilagarcía» por
// «Vilagarcía de Arousa»), que son aproximados. Los datos los genera
// scripts/lugares.mjs (data/lugares/).
import { stripDiacritics, words } from './chess/names'
import data from './lugares.json'
import { COMMUNITY_OF, PLACES, placesInName, type Place } from './toponimos'

export interface TournamentPlace {
	/** Código del INE de la provincia, o null si no se sabe (sólo la comunidad, o nada). */
	province: string | null
	/** Código del INE de la comunidad, o null si no se sabe o se juega fuera. */
	community: string | null
}

const NOWHERE: TournamentPlace = { province: null, community: null }

/**
 * Dónde se juega un torneo. Manda la ciudad; el nombre, sólo si la ciudad no
 * dice el sitio, si sólo dice la comunidad (el nombre puede decir la
 * provincia) o si su cruce es aproximado y el nombre dice otro sitio:
 * «Torrente», con «Open Internacional Valencia», no es Torrente de Cinca
 * (Huesca). Un torneo del extranjero no tiene sitio.
 */
export function tournamentPlace(city: string | null, name: string): TournamentPlace {
	const fromCity = cityPlace(city)
	if (fromCity === 'extranjero') return NOWHERE
	const fromName = namePlace(name)
	if (!fromCity) return fromName ?? NOWHERE
	const { province, community } = fromCity
	if (fromName) {
		if (!province && fromName.province && fromName.community === community) return fromName
		const fits = fromName.community === community && (!fromName.province || fromName.province === province)
		if (fromCity.approximate && !fits) return fromName
	}
	return { province, community }
}

/** El sitio que dice el nombre del torneo, si todos los sitios que nombra son de una misma comunidad. */
function namePlace(name: string): TournamentPlace | null {
	const places = placesInName(name)
	const communities = new Set(places.map((p) => p.community))
	if (communities.size !== 1) return null
	const provinces = new Set(places.filter((p) => p.kind === 'provincia').map((p) => p.code))
	return { province: provinces.size === 1 ? [...provinces][0] : null, community: [...communities][0] }
}

interface CityPlace extends TournamentPlace {
	community: string
	/** Si sale de un núcleo de población o de un principio de nombre. */
	approximate: boolean
}

/**
 * El sitio que dice la ciudad: un municipio, o sólo la provincia o la
 * comunidad; 'extranjero', o null si no se reconoce.
 */
export function cityPlace(city: string | null): CityPlace | 'extranjero' | null {
	if (!city) return null
	const { regions, countries } = tables()
	const text = expand(stripDiacritics(city).toLowerCase())
	const full = words(text).join(' ')
	if (SPAIN.has(full)) return null
	const segments = text
		.split(/[,()[\];/|]|\s[-–]\s|\s-|-\s|\.\s|\sy\s|\se\s/)
		.map((part) => words(part).join(' '))
		.filter((part) => part && !SPAIN.has(part) && !isStreet(part))
		.flatMap((part) => withRegionSuffix(part, regions))
	const named = segments.flatMap((s) => regions.get(s) ?? [])
	if (named.length === 0 && abroad(segments, countries)) return 'extranjero'
	// La provincia o la comunidad que nombra («Malpartida (Extremadura)») acota los municipios.
	const hinted = new Set(named.flatMap((r) => (r.province ? [r.province] : provincesOf(r.community))))

	// La ciudad entera y, si no, sus trozos; el nombre de una provincia, sólo si no hay otro.
	const whole = regions.has(full) ? candidates(full, hinted, 1) : candidates(full, hinted)
	const found = whole ?? fromSegments(segments, hinted, regions)
	if (found) {
		const municipality = pick(found.matches)
		const provinces = new Set(found.matches.map((m) => m.municipality.slice(0, 2)))
		const province = municipality?.slice(0, 2) ?? (provinces.size === 1 ? [...provinces][0] : null)
		// Con la provincia escrita («Beniaján (Murcia)»), la provincia es segura aunque el municipio sea aproximado.
		const approximate = found.tier === 2 && hinted.size === 0
		if (province) return { province, community: COMMUNITY_OF.get(province)!, approximate }
	}
	const provinces = new Set(named.flatMap((r) => (r.province ? [r.province] : [])))
	if (provinces.size === 1) {
		const province = [...provinces][0]
		return { province, community: COMMUNITY_OF.get(province)!, approximate: false }
	}
	const communities = new Set(named.map((r) => r.community))
	if (communities.size === 1) return { province: null, community: [...communities][0], approximate: false }
	return null
}

/**
 * Un trozo que no es ningún sitio pero acaba en el nombre de una provincia, una
 * isla o una comunidad, sin separarlo («Cartagena Murcia», «Círculo de Bellas
 * Artes de Madrid»): ese final va aparte.
 */
function withRegionSuffix(segment: string, regions: Map<string, Region[]>): string[] {
	if (regions.has(segment) || tables().names.has(segment)) return [segment]
	const w = segment.split(' ')
	if (w.length > 1 && SPAIN.has(w[w.length - 1])) return withRegionSuffix(w.slice(0, -1).join(' '), regions)
	for (let k = Math.min(3, w.length - 1); k >= 1; k--) {
		const suffix = w.slice(-k).join(' ')
		if (regions.has(suffix)) return [w.slice(0, -k).join(' '), suffix]
	}
	return [segment]
}

/**
 * Si los trozos de la ciudad nombran otro país. Un país que también es un sitio
 * de aquí (Montserrat, La Cuba, Santa Lucía) sólo cuenta si el resto de la
 * ciudad no lo es: «Vecindario (Santa Lucía)» es Gran Canaria; «La Habana,
 * Cuba», el extranjero.
 */
function abroad(segments: string[], countries: Countries): boolean {
	if (segments.some((s) => countries.only.has(s))) return true
	const rest = segments.filter((s) => !countries.alsoHere.has(s))
	return rest.length > 0 && rest.length < segments.length && rest.every((s) => !candidates(s, new Set()))
}

function fromSegments(segments: string[], hinted: Set<string>, regions: Map<string, Region[]>): Found | null {
	const all = segments.flatMap((s) => {
		const found = regions.has(s) ? candidates(s, hinted, 1) : candidates(s, hinted)
		return found ? [{ ...found, region: regions.has(s) }] : []
	})
	const others = all.some((f) => !f.region) ? all.filter((f) => !f.region) : all
	if (others.length === 0) return null
	const tier = Math.min(...others.map((f) => f.tier))
	const best = others.filter((f) => f.tier === tier)
	// Si los trozos que dicen un municipio dicen el mismo y los ambiguos lo admiten
	// («Vecindario (Santa Lucía)»), ése; si no, sólo sirven si son de una provincia.
	const picks = new Set(best.map((f) => pick(f.matches)).filter((m) => m !== null))
	if (picks.size === 1) {
		const [municipality] = picks
		const province = municipality.slice(0, 2)
		if (best.every((f) => f.matches.some((m) => m.municipality.slice(0, 2) === province))) {
			return { tier, matches: best.flatMap((f) => f.matches.filter((m) => m.municipality === municipality)) }
		}
	}
	return { tier, matches: best.flatMap((f) => f.matches) }
}

/** Abreviaturas de los organizadores, sobre el texto en minúsculas y sin tildes. */
const ABBREVIATIONS: [RegExp, string][] = [
	[/\bvva\b\.?/g, 'villanueva'],
	[/\bsta\b\.?/g, 'santa'],
	[/\bsto\b\.?/g, 'santo'],
	[/\bpto\b\.?/g, 'puerto'],
	[/\bc\.\s*real\b/g, 'ciudad real'],
	[/\bg\.\s*c\b\.?|\bgc\b/g, 'gran canaria'],
	[/\bfv\b/g, 'fuerteventura'],
	[/\bs\.\s*s\.|\bss(?=\sde\s)/g, 'san sebastian'],
	// «C/Cifuentes»: la barra no separa dos sitios.
	[/\bc\//g, 'calle ']
]

function expand(text: string): string {
	return ABBREVIATIONS.reduce((t, [pattern, replacement]) => t.replace(pattern, replacement), text)
}

/** Las calles, que no son el sitio: empiezan por su tipo o, en euskera, acaban en él. */
const STREET = /^(calle|avda|avenida|av|plaza|pza|paseo|ctra|carretera|camino|ronda|rua|praza|carrer|avinguda|passeig|placa)\s|\skalea$/

function isStreet(segment: string): boolean {
	return STREET.test(segment)
}

const SPAIN = new Set(['spain', 'espana'])

/** Islas: no son una provincia, pero la dicen. */
const ISLANDS: [string, string][] = [
	['07', 'Mallorca, Menorca, Ibiza, Eivissa, Formentera'],
	['35', 'Gran Canaria, Lanzarote, Fuerteventura'],
	['38', 'Tenerife, La Palma, La Gomera, El Hierro']
]

/** El sitio que nombra un trozo de la ciudad: una provincia (o isla) o una comunidad. */
interface Region {
	province: string | null
	community: string
}

interface Match {
	municipality: string
	/** 0: el nombre oficial, con el artículo delante; 1: sin el artículo; 2: aproximado. */
	tier: 0 | 1 | 2
	population: number
}

interface Found {
	tier: number
	matches: Match[]
}

/**
 * Los municipios que se llaman `name`, los del mejor nivel, o null. Con
 * provincias en `hinted`, sólo los suyos; con `maxTier`, sin pasar de él.
 */
function candidates(name: string, hinted: Set<string>, maxTier = 2): Found | null {
	const matches = [...(tables().names.get(name)?.values() ?? [])].filter(
		(m) => m.tier <= maxTier && (hinted.size === 0 || hinted.has(m.municipality.slice(0, 2)))
	)
	if (matches.length === 0) return null
	const tier = Math.min(...matches.map((m) => m.tier))
	return { tier, matches: matches.filter((m) => m.tier === tier) }
}

/** Entre homónimos, el que tiene al menos diez veces más habitantes que el siguiente; si no, ninguno. */
function pick(matches: Match[]): string | null {
	if (matches.length === 1) return matches[0].municipality
	const [first, second] = [...matches].sort((a, b) => b.population - a.population)
	return first.population >= 10 * Math.max(second.population, 1) ? first.municipality : null
}

function provincesOf(community: string): string[] {
	return [...COMMUNITY_OF].filter(([, c]) => c === community).map(([province]) => province)
}

/** Las palabras que siguen a un principio de nombre («Vilagarcía de Arousa»). */
const CONNECTORS = new Set(['de', 'del', 'la', 'el', 'las', 'los', 'i', 'y', 'do', 'da', 'd'])

/** Artículos que el INE pospone («Coruña, A», «Alfàs del Pi, l'»). */
const ARTICLE = /^(.*), (a|as|o|os|la|las|el|los|l'|les|els|lo|es|sa|ses|na)$/i

/** Los nombres de los países: los que sólo son un país y los que también son un sitio de aquí. */
interface Countries {
	only: Set<string>
	alsoHere: Set<string>
}

interface Tables {
	/** Nombre en palabras → municipio → su mejor coincidencia. */
	names: Map<string, Map<string, Match>>
	regions: Map<string, Region[]>
	countries: Countries
}

let cache: Tables | null = null

/** Las tablas del cruce, construidas la primera vez: la ingesta las usa, las páginas no. */
function tables(): Tables {
	if (cache) return cache
	const names = new Map<string, Map<string, Match>>()
	const add = (name: string, match: Match) => {
		const key = words(name).join(' ')
		if (!key) return
		const byMunicipality = names.get(key) ?? new Map<string, Match>()
		const old = byMunicipality.get(match.municipality)
		if (!old || match.tier < old.tier || (match.tier === old.tier && match.population > old.population)) {
			byMunicipality.set(match.municipality, match)
		}
		names.set(key, byMunicipality)
	}
	for (const [municipality, name, population] of data.municipios as [string, string, number][]) {
		for (const part of name.split('/')) {
			const article = ARTICLE.exec(part.trim())
			const forms: [string, 0 | 1][] = article
				? [[`${article[2]}${article[2].endsWith("'") ? '' : ' '}${article[1]}`, 0], [article[1], 1]]
				: [[part.trim(), 0]]
			for (const [form, tier] of forms) {
				add(form, { municipality, tier, population })
				// Media denominación: «Vitoria» por «Vitoria-Gasteiz».
				const halves = form.split('-')
				for (const half of halves.length > 1 ? halves : []) {
					if (words(half).join(' ').length >= 4) add(half, { municipality, tier: 2, population })
				}
				const w = words(form)
				for (let k = 1; k < w.length; k++) {
					const prefix = w.slice(0, k).join(' ')
					if (CONNECTORS.has(w[k]) && !CONNECTORS.has(w[k - 1]) && prefix.length >= 5) {
						add(prefix, { municipality, tier: 2, population })
					}
				}
			}
		}
	}
	for (const [municipality, name, population] of data.nucleos as [string, string, number][]) {
		add(name, { municipality, tier: 2, population })
	}

	const regions = new Map<string, Region[]>()
	const addRegion = (name: string[], region: Region) => {
		const key = name.join(' ')
		regions.set(key, [...(regions.get(key) ?? []), region])
	}
	for (const place of PLACES) {
		for (const name of place.names) addRegion(name, regionOf(place))
	}
	for (const [province, islands] of ISLANDS) {
		for (const island of islands.split(',')) addRegion(words(island), { province, community: COMMUNITY_OF.get(province)! })
	}

	const countries: Countries = { only: new Set(), alsoHere: new Set() }
	for (const country of data.paises) {
		const key = words(country).join(' ')
		const set = names.has(key) || regions.has(key) ? countries.alsoHere : countries.only
		set.add(key)
	}
	cache = { names, regions, countries }
	return cache
}

function regionOf(place: Place): Region {
	return { province: place.kind === 'provincia' ? place.code : null, community: place.community }
}
