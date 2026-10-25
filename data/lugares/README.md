# Lugares

Con qué se saca la provincia de un torneo de su ciudad (`src/lib/lugares.ts`).

- `municipios.tsv`: los 8.132 municipios, con su código y su nombre, de la
  [Relación de municipios y sus códigos por provincias](https://www.ine.es/daco/daco42/codmun/26codmun.xlsx)
  del INE, a 1 de enero de 2026. Fuente: sitio web del INE, www.ine.es, con
  licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.es).
- `nucleos.tsv`: los núcleos de población de 100 habitantes o más, con el código
  de su municipio, su nombre y sus habitantes, del Nomenclátor Geográfico de
  Municipios y Entidades de Población del IGN (colección `nuc` de
  [su API](https://api-features.ign.es/collections/nuc)), descargados el 25 de
  octubre de 2026. © Instituto Geográfico Nacional, con licencia
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.es).

`node scripts/lugares.mjs` los convierte en `src/lib/lugares.json`, con los
nombres de los países de `Intl.DisplayNames`. Para actualizarlos, cuando el INE
publica la relación del año (en febrero): `node scripts/lugares.mjs --descargar <año>`,
cambiar el enlace y la fecha de `INE_MUNICIPIOS` (`src/lib/licenses.ts`), que
citan `/acerca` y `/aviso-legal`, y después el reprocesado `{"lugares":true}`.
