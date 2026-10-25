// La columna Fed. de los participantes: sólo códigos de federación de la FIDE.
// Desde mayo de 2024 el árbitro de info64 puede poner en ella otro campo (Info
// u Origen), y había torneos con la categoría de edad («S12», «sub12») o el
// año de nacimiento («2017»), que la página del torneo enseñaba junto al
// nombre (ver CLAUDE.md, «Menores»). Otros traen la provincia («MA», «JA») o,
// sobre todo en los campeonatos de España, la comunidad de los españoles
// («AND», «CAT», «VAL») junto a la federación de los extranjeros.
//
// Medido en producción el 25-oct-2026: 1.123 torneos con algo que no es un
// código, y 93 de ellos sólo con una o dos erratas («ESp», «ES», «ROM»).

/**
 * Los 207 de la FIDE (el desplegable de federaciones de ratings.fide.com, el
 * 25-oct-2026) y FID, la bandera de la FIDE.
 */
export const FEDERATIONS: ReadonlySet<string> = new Set(
	(
		'AFG ALB ALG AND ANG ANT ARG ARM ARU AUS AUT AZE BAH BAN BAR BDI BEL BER BHU BIH BIZ BLR BOL BOT BRA BRN BRU ' +
		'BUL BUR CAF CAM CAN CAY CHA CHI CHN CIV CMR COD COL COM CPV CRC CRO CUB CUR CYP CZE DEN DJI DMA DOM ECU EGY ' +
		'ENG ERI ESA ESP EST ETH FAI FID FIJ FIN FRA GAB GAM GCI GEO GEQ GER GHA GRE GRL GRN GUA GUI GUM GUY HAI HKG ' +
		'HON HUN INA IND IOM IRI IRL IRQ ISL ISR ISV ITA IVB JAM JCI JOR JPN KAZ KEN KGZ KIR KOR KOS KSA KUW LAO LAT ' +
		'LBA LBN LBR LCA LES LIE LTU LUX MAC MAD MAR MAS MAW MDA MDV MEX MGL MHL MKD MLI MLT MNC MNE MOZ MRI MTN MYA ' +
		'NAM NCA NCL NED NEP NGR NIG NOR NRU NZL OMA PAK PAN PAR PER PHI PLE PLW PNG POL POR PUR QAT ROU RSA RUS RWA ' +
		'SCO SEN SEY SGP SKN SLE SLO SMR SOL SOM SRB SRI SSD STP SUD SUI SUR SVK SWE SWZ SYR TAN TGA THA TJK TKM TLS ' +
		'TOG TPE TTO TUN TUR UAE UGA UKR URU USA UZB VAN VEN VIE VIN WLS YEM ZAM ZIM'
	).split(' ')
)

/** Las federaciones que también son siglas de comunidades: Madrid, Andalucía y Canarias. */
export const COMMUNITY_CODES: ReadonlySet<string> = new Set(['MAD', 'AND', 'CAN'])

/**
 * La columna Fed. de un torneo tal como se guarda: sólo los códigos de la
 * FIDE. «MAD», «AND» y «CAN» son comunidades, y se vacían, en quien está en la
 * lista FIDE española (`spanish`, por su FIDE ID) y, sin FIDE ID, si la columna
 * trae algo que no es un código («CAT», «VAL»). Así se conservan los
 * extranjeros de verdad, también en un torneo con una errata («ESp»).
 */
export function federationColumn(
	players: readonly { fed: string | null; fideId: number | null }[],
	spanish: ReadonlySet<number>
): (string | null)[] {
	const clean = players.every((p) => p.fed === null || FEDERATIONS.has(p.fed))
	return players.map(({ fed, fideId }) => {
		if (fed === null || !FEDERATIONS.has(fed)) return null
		if (!COMMUNITY_CODES.has(fed)) return fed
		return (fideId === null ? clean : !spanish.has(fideId)) ? fed : null
	})
}
