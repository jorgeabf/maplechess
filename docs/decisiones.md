# Decisiones de MapleChess

La historia, las medidas y los casos concretos que salieron del `CLAUDE.md` el 30-oct-2026, bajo sus mismos títulos. Cada viñeta va entera, tal como estaba, con las de encima para situarla. Lo que sigue siendo una regla está también, más corto, en el `CLAUDE.md`, que es el que manda.

## Stack

### Workflows

- **Workflows** para la ingesta: `INFO64_SYNC` (`src/ingest/info64/sync.ts`), `LICHESS_SYNC` (`src/ingest/lichess/sync.ts`), `FIDE_SYNC` (`src/ingest/fide/sync.ts`) y `FCA_IMPORT` (`src/ingest/fca/sync.ts`, sólo a mano: ver «Fuentes de datos»). Crons en `wrangler.jsonc` y `src/ingest/schedule.ts`: las expresiones tienen que coincidir.
  - Clasificación (tabla `standings`, migración 0011): `INFO64_SYNC` lee `/{slug}/standings` de cada torneo tras sus participantes, en su paso. Una pasada de sólo emparejamientos (`'only'`) la relee en los torneos ya empezados con ronda próxima, para prepararla con la de la ronda anterior; la diaria no, porque ya la ha leído en la ventana. Si falla o una guarda no la deja guardar, es un aviso, y las partidas se leen igual. Los torneos propios de lichess no tienen: su API sólo cuenta las partidas retransmitidas y no aplica los desempates del torneo.
    - `{"standings":"only"}` sólo la lee, de los torneos de info64 guardados que empiezan en la ventana o de los de `keys`, sin calendario ni partidas: para cargar la de los torneos que ya no se releen. Sus ventanas encadenadas se llaman `info64-clasificacion-…`, porque las `info64-…` de la carga inicial ya existen y la cadena se pararía al encontrarlas.

#### info64 sólo de madrugada

- **info64 sólo de madrugada** (lo pidió su administración el 25-oct-2026: fuera de 00:00–06:00 puede responder 429). La diaria va a las 00:00 UTC, que es la 01:00 de Madrid en invierno y las 02:00 en verano, y tarda unos 20 minutos (unas 434 peticiones). Cualquier pasada de `INFO64_SYNC` lanzada a otra hora, también a mano o encadenada, espera a las 00:05 antes de pedir nada (`INFO64_HOURS`, `msUntilInfo64Hours`): una que empieza después de las 05:00, a la noche siguiente. Las pasadas de sólo emparejamientos de las 15:00 y las 22:00 se quitaron por eso.

#### Emparejamientos

- Emparejamientos: con `pairings`, `INFO64_SYNC` lee además la próxima ronda de los torneos individuales que juegan en los próximos 8 días (tabla `pairings`, sólo una ronda por torneo). La diaria lo hace con `'also'`: la ronda de la mañana se empareja casi siempre la noche antes. Se pierde la ronda de la tarde de los días con dos rondas, que se empareja hacia las 14:00. Con `'only'` (a mano) sólo lee los emparejamientos. Los torneos que aún no han empezado se guardan antes, para tener su ranking inicial.

#### `LICHESS_SYNC`

- `LICHESS_SYNC` (06:30 UTC): retransmisiones oficiales de lichess con jugadores españoles, aunque info64 no las enlace. Mira las activas y las terminadas desde la pasada anterior (`/api/broadcast/top`; los grupos se expanden con `/api/broadcast/{id}`). De cada retransmisión nueva pide los jugadores y, si hay españoles, el torneo y el PGN. Luego busca el torneo de info64 por los FIDE ID de los participantes y las fechas, con `findInfo64Tournament` (al menos 2 españoles y la mitad):
  - torneo de info64 sin partidas: queda **enlazado**. Sus partidas van a ese torneo y `syncTournament` suma la retransmisión a las que enlaza info64 (`loadLinkedBroadcasts`);
  - torneo de info64 con partidas: **duplicado**, no se toca;
  - sin torneo en info64: torneo **propio** con `source = 'lichess'`, sólo con las partidas en las que juega algún español. Antes se quitan las que ya estén en otro torneo: mismos FIDE ID y colores, a ±3 días (`gamesStoredElsewhere`).
  Lo decidido queda en `lichess_tours`. Las propias se releen cada día hasta que terminan; las que no tienen españoles, una vez más al terminar. Si a esa hora sigue la diaria de info64, que también pide a lichess, la espera.

#### `GAMES_REPROCESS`

- `GAMES_REPROCESS` (`src/ingest/reprocess.ts`) recalcula desde el PGN guardado y el ritmo del torneo las columnas derivadas (`opening_moves`, `time_class` y `clocks`, con `derivedColumns()` de `src/ingest/games.ts`, la misma función que usa la ingesta) y, del torneo, cuántas de sus partidas son de lichess (`lichess_games`, ver «Licencia CC BY-SA 4.0»). Además aplica a lo guardado la regla de los nombres de los menores (ver «Menores»): en las partidas (columnas y cabeceras `White`/`Black` del PGN, como texto), los participantes y los emparejamientos, y borra los torneos sensibles y los de menores (ver «Torneos sensibles» y «Torneos de menores»). Y deja en la columna Fed. de los participantes sólo los códigos de federación (ver «Menores»). Y vuelve a decidir dónde se juega cada torneo (ver «Buscar torneos por sitio»). Se lanza a mano tras una migración que añade una de esas columnas o cambia cómo se calcula, o si cambia esa regla.

### Ajedrez

- **Ajedrez:** `chessops` (PGN, SAN, FEN) en servidor y cliente, `@lichess-org/chessground` (tablero) y Stockfish 19 *lite single-thread* en un Web Worker.
  - Cada búsqueda para en la profundidad 22 o a los 10 s, lo que llegue antes (`ENGINE_DEPTH` y `ENGINE_TIME_MS` en `motor.ts`): con un hilo, la 22 de una posición táctica eran 34 s en escritorio, y en un móvil, de uno a dos minutos. Con la pestaña oculta se para y, al volver, sigue si no había terminado (`onVisibility` en `panel-motor.ts`).
    - Terminada la búsqueda, «Seguir analizando» en la línea de estado sigue con esa posición sin topes (`go infinite`) hasta pasar a otra. Mientras dura, el mismo botón queda inactivo y dice «sin límite»: explica por qué no para y no pierde el foco. Es un verbo porque es una acción, y no «análisis infinito», que es el nombre de un modo y promete algo que no ocurre: para al cambiar de jugada.
    - Con el panel por debajo de 18rem, la línea de estado guarda siempre dos renglones (`min-block-size: 2lh`, en `PanelMotor.astro`). Terminada la búsqueda, «Seguir analizando» la partía en dos, y el panel crecía y encogía 18 px con cada jugada. Pide unos 258 px con Segoe UI; el margen es para otras fuentes.
    - Una búsqueda que vuelve a empezar en la misma posición (sin límite, al volver a la pestaña) parte de cero: la tabla de transposiciones apenas acorta. Las líneas que ya se ven se quedan hasta que las supera (`shown`).

#### Piezas propias

- **Piezas propias** (`src/assets/pieces/maple/`, en lugar de las cburnett de chessground; decididas con Jorge el 24-oct-2026): dibujadas desde cero, sin calcar ni adaptar ningún juego, con perfiles de torno, la taracea del logo y juntas redondas. Las pone `components/visor/board.css`, y Vite las incrusta en ese CSS.
  - Las genera `scripts/piezas.mjs` (`node scripts/piezas.mjs [pieza…] [--muestra <carpeta>]`): un módulo por pieza (`scripts/piezas/<pieza>.mjs`) sobre lo común (`scripts/piezas/comun.mjs`: lienzo de 100, peana, grosores, colores de los tokens, `torno()`). Escribe también las figuras de la notación (`scripts/piezas/figuras/`) y, con `--muestra`, una hoja para comparar en el tablero real (`muestra.mjs`).
  - **Visibilidad:** en el borde de todas, un tono claro y una tinta casi negra (`--board-piece-light`, `--board-piece-ink`). Las blancas llevan relleno claro y contorno de tinta. Las negras, al revés, con el filete claro por fuera, un perfil de tinta de 2 alrededor y encogidas para ocupar lo mismo que las blancas.
  - El nogal no admite más de 5,1:1. `piezas.mjs` mide con resvg, a 32 y 41 px a 2× y a 56 y 72 a 1×, y sale con error si no hay 7:1 sobre el arce, 4,5:1 sobre el nogal y 3:1 en las casillas marcadas, o si una SVG llega a 4 KB (dejaría de incrustarse). Hoy, 13,7:1 y 4,8:1.
  - El borde se mide como el mejor contraste a menos de un grosor de contorno en cada punto de la orilla: un anillo fijo dependía de cómo caían los bordes en los píxeles. resvg da los píxeles premultiplicados.

#### `scripts/copy-engine.mjs`

- `scripts/copy-engine.mjs` (postinstall) copia el motor a `public/engine/<versión>/`, que no se versiona. La carpeta es la versión del paquete `stockfish`, que `motor.ts` lee de su `package.json`, y `public/_headers` la sirve con caché inmutable de un año. Si `copy-engine.mjs` pasa a copiar otra build sin que cambie la versión, hay que cambiar también el nombre de la carpeta: con `immutable`, los navegadores se quedarían con la anterior. La licencia queda fuera, en `public/engine/Copying.txt`, porque `/acerca` la enlaza. El código de la versión lo enlazan `/acerca` y `/aviso-legal` con `ENGINE_SOURCE` (`src/lib/licenses.ts`): la etiqueta `v<versión>` de stockfish.js.

#### Notación

- Notación: SAN en inglés («Nf3»), siempre escrita con `formatMove` y `formatLine` de `src/lib/format.ts` («34…Qxc3 35.Qa4»), también las variantes del motor. Las letras en castellano no: «cxd4» y «Cxd4» sólo se distinguen por la mayúscula, y «Re1» es rey en castellano y torre en inglés.
  - **Con figuras** (decidido con Jorge el 24-oct-2026): una fuente propia, «Figuras» (`src/assets/fonts/figuras.woff2`), dibuja las mayúsculas K, Q, R, B y N como las piezas del tablero.
    - El DOM sigue diciendo «Nf3»: copiar, el PGN y los lectores de pantalla no cambian, y sin la fuente se ven las letras.
    - Los caracteres de ajedrez (♘) no valen: iOS y Android los pintan como emoji.
  - La ponen `--font-moves` y `--font-moves-serif`, en la regla que ya tiene cada elemento que muestra jugadas: la lista, la franja de la variante, la jugada actual, el motor, el explorador y el dossier. Una clase global, en `@layer base`, perdería frente a ellas.
  - La prosa y los nombres siguen con letras: los nombres de apertura, los comentarios del PGN y el tooltip del gráfico de evaluación.
    - En el cruce del dossier, las jugadas van en su propio `<span>`, fuera de la frase: con la fuente en la frase entera, las mayúsculas de los nombres saldrían como piezas.
    - El NAG 146 (la novedad, una «N») se queda en letra (`.glyph`).
    - **Los consejos de lichess** que traduce la web («Mejor Qxc3.», `translateAdvice`) sí van con figuras, enteros (`advice` en `GameComment`): sus frases no llevan K, Q, R, B ni N mayúsculas, y un test lo comprueba. Una frase nueva en `LICHESS_JUDGMENTS` tiene que cumplirlo.
  - Escala intermedia: el rey a 0,88 em, cada figura a 0,88 × √(su alto / el del rey), y 0,04 em a cada lado. Jorge eligió primero 0,76 y, con las figuras definitivas, 0,88: a 0,76 el rey del motor se quedaba en unos 10 px en el escritorio. Una jugada con figura lleva un 6 % más de tinta que con letras. Con 0,88, en el motor (a `--text-s`, como la tabla del explorador o la variante propia), el rey mide 12,3 px y la torre 10,6: medido el 25-oct-2026, Jorge lo dejó así.
  - Pesa 1,2 KB: Vite la incrusta en el CSS como `data:`, de ahí el `font-src 'self' data:` de la CSP. Con `font-display: block` no asoma la letra. El script falla si llega a 4 KB.
  - Las figuras salen de las piezas (`scripts/piezas/figuras/`). Si cambia una, `node scripts/piezas.mjs <pieza>` y `python scripts/fuente-figuras.py`.

#### Tablero pintado en el servidor, en el explorador

- **Tablero pintado en el servidor, en el explorador** (`components/visor/Tablero.astro` y `src/lib/chess/tablero.ts`; decidido con Jorge el 25-oct-2026): el explorador pinta la posición con el mismo marcado que chessground 10.4 (`cg-board`, `piece`, `square` y `coords`). Cada pieza lleva un `transform: translate` en tantos por ciento de su casilla, que la CSP admite en `style-src-attr`. Después chessground se monta en el mismo `.board`.
  - Así se ve desde el primer pintado, también sin JavaScript. Cada jugada es una página nueva, y en un móvil lento el tablero tardaba de 0,2 a 0,9 s en aparecer en cada clic.
  - En frío, el primer pintado llega unos 0,15 s más tarde, porque las SVG de las piezas se preparan antes de pintar.
  - Si chessground cambia de versión, hay que comprobar que su marcado siga siendo el mismo.
  - En el visor no se usa: el servidor no ve el `#j` del enlace (ver «Antes de montarse chessground»).

## Estructura

### `src/ingest/`

- `src/ingest/`: ingesta. Se divide en:

#### Torneos sensibles

- **Torneos sensibles** (`sensibles.ts`; tabla `torneos_sensibles`, migración 0012): los que revelan un dato de salud de quien juega (art. 9 RGPD), como los de ciegos (FEDC, clasificatorios de la ONCE), sordos (FEDS, ICCD) o discapacidad física (IPCA) y los campeonatos de ajedrez inclusivo. **No se guardan** (decidido el 23-oct-2026): anonimizarlos como a los retirados no bastaba, porque con el ELO, la ronda y la mesa la fuente dice quién es cada uno.
  - Los que lo parecen por el nombre (`looksSensitive`, en castellano, inglés, catalán y gallego) los apunta por revisar la ingesta al guardarlos (info64 y torneos propios de lichess) y, mientras, los guarda como los demás. `/api/estado` da entonces la alarma (ver «Producción»). Cómo revisarlos, en la guía de operación.
    - «A la ciega» y «a la cega» no cuentan: es jugar sin ver el tablero. El 23-oct-2026 cinco torneos así (el Desafío a la Ciega de València y el Pablo Morán de Oviedo) dieron la alarma y se marcaron con 0.
    - «Parainclusivo», junto, cuenta desde el 25-oct-2026: los I y II Juegos Parainclusivos de la Comunidad de Madrid (2018 y 2019) se colaban.
  - **Sus retransmisiones de lichess:** borrado un torneo de info64, la pasada de lichess no reconocería su retransmisión (ya no hay participantes con los que cruzarla) y la guardaría como torneo propio. Por eso, antes de borrar, el reprocesado marca también (`source` `lichess`, `excluido` 1) las que esa pasada ha decidido del torneo (`lichess_tours`) y la que enlaza info64, de la que salen sus partidas (`games_source_url`). Si el enlace es de una ronda, pregunta a lichess de qué torneo es (`resolveTourId`); por eso el paso lleva los reintentos de lichess. Una ya revisada con 0 no cambia.
  - Los benéficos («Jaque al Alzheimer», «Blitz solidario…») y los abiertos a todos no revelan nada de quien juega: el detector no los mira, o se marcan con 0.
    - Tampoco los inclusivos en los que juegan juntas personas con y sin discapacidad, si no la separan en categorías ni en premios (decidido por Jorge el 25-oct-2026): el de La Serranía en Alpuente (de 2024 a 2026, con categorías sólo por edad) y los Juegos Parainclusivos de Madrid van con 0. Los Campeonatos de España de ajedrez inclusivo, con 1: sus premios van por grado de discapacidad.

#### Torneos de menores

- **Torneos de menores** (`menores.ts`): hasta Sub 14 (y las categorías hasta infantil) y los escolares, que son los de un colegio o entre colegios y el deporte en edad escolar (juegos escolares, JUDEX, Juegos Deportivos, Jocs Esportius…). **No se guardan** (decidido el 23-oct-2026): dicen la edad o el colegio de quien juega, aunque su ficha no enseñe el año (ver «Menores»).
  - Se reconocen por el nombre y su fecha (`isMinorsTournament`), sin tabla ni revisión. En info64, el del calendario o, con `keys`, el slug, que lleva las mismas palabras; y otra vez el de su página, con su fecha, antes de guardarlo (`syncTournament`). En lichess, el de la retransmisión. La ingesta se los salta en los mismos sitios que a los sensibles.
  - **Los que sólo lo dicen en el slug,** por una lista a mano en el código (`isListedMinors`, por `source` y `source_key`; decidido por Jorge el 28-oct-2026). La regla no puede mirar el slug de lo guardado: los organizadores lo reutilizan, y el Torneo Absoluto del Albariño lleva el de uno infantil.
    - Medido en producción: de 8.299 torneos de info64, 12 lo parecen por el slug y no por el nombre. Entran 4, con 188 participaciones y 28 partidas: el Open Promoción Santa Catalina Park 2021 (de 7 a 12 años), el III Torneo Semana Cultural de Navarrés (de 7 a 16) y su retransmisión de lichess, los Jocs «La Vila-Gasparot» y el «Circuito Inter[escolar]» de Alcalá.
    - Se quedan los dos Albariño absolutos, el CTM por equipos Sub 18, el juvenil de Ciudad Real, el «por edades» Sub 18 de León, el grupo mixto de PROMOCHESS y el Xaque Mate Eduardo Pondal, abierto (de 9 a 68 años).
    - El Torneo Regional Imaginalia de Albacete va por el nombre, para que entren sus ediciones nuevas: en las dos guardadas, todos los que tienen año tienen de 7 a 16.
    - Uno nuevo se añade con su PR y, tras desplegar, el reprocesado. Si sus partidas salen de una retransmisión de lichess, también ella (`lichess:<id>`), por el hueco de abajo.
  - En info64, también por el rótulo de su pestaña en el grupo de torneos (ver «Torneos del grupo»), que pone el organizador y puede decir lo que el título calla: un «Torneo de Navidad Grupo C» con la pestaña «Sub 12» (decidido por Jorge el 25-oct-2026). Un rótulo que parece sensible apunta el torneo por revisar. El reprocesado no mira los rótulos: un torneo guardado antes con un rótulo así se queda, y su pestaña lleva el nombre.
  - No entran los topes de ELO («Sub 1400», «U2400»), Sub 16 y Sub 18, cadete y juvenil, ni las escuelas de ajedrez («Escuela», «Eskola»), que son clubes.
  - Las categorías de la FIDE, también con edad impar desde 2026 («- G11», «| O10»). Con una cifra («- O7», «| G9»), sólo al final del nombre y tras un guion o una barra, porque «Jornada de Entrenamiento G8» es un grupo. También entran «Kids» y «para niños», pero no «Santos Niños», que es una fiesta.
  - «Para niños» también en gallego («para nenos», «para rapaces»), catalán («per a nens», «per a infants») y euskera («Umeentzat», «Haurrentzat», «Txikientzat»), desde el 25-oct-2026: se colaba el «I Aiarako Txapelketa Umeentzat». Medido en `/torneos` de producción, esas formas sólo encontraban ese torneo.
  - **Por años de nacimiento y «por edades»** (25-oct-2026): se colaban 101 torneos, con 4.724 participaciones y 697 partidas.
    - Las categorías que dan los años de nacimiento en vez de «Sub», como el Circuito PROMOCHESS de Alicante («Cat. A (2019-2018-2017)», «Grupo B (2011, 2012 y 2013)», «(2017-18-19)»): 67 torneos. Cuentan dos o más años seguidos en los que el más joven tiene de 4 a 13 años en el año del torneo, así que una temporada («2014-2015», o «2008/09» con la barra) no entra. Por eso `isMinorsTournament` recibe la fecha; sin ella (el slug, con `keys`), sólo cuentan tres años con el más joven de 2000 o después. El calendario de info64 quita el último paréntesis del título, que puede ser el de los años: por eso se mira también la página.
    - Los «por edades» con todas las categorías juntas o por letras («Previa A», «Final D»): 34 torneos de Asturias, Burgos y Palencia. No los que dicen Sub 16, Sub 18, cadete, juvenil o veteranos (+50, +65, V50, Supra). Las letras cambian de un año a otro, así que también se van los pocos grupos de adultos por letra (decidido por Jorge).
    - Se quedan las categorías absolutas del circuito y tres grupos mixtos de niños y adultos sin federar («Cat. C y Absoluta NO federados»).
  - Medido el 23-oct-2026 en `/torneos` de producción: casan 3.593 de los unos 12.500 torneos, con 131.733 participaciones y 12.985 partidas. Las partidas son de 177 torneos, casi todas de los Campeonatos de España Sub 8 a Sub 14 y de los mundiales de cadetes.
  - Se cuelan los grupos de adultos de algunos torneos mixtos («Copa Diputación … General, S16 y S14», «Torneo Escolar … Adultos») y se escapan los que no lo dicen en el nombre. Se acepta, como en la búsqueda por sitio.
    - Añadidos el 24-oct-2026 los que se escapaban por no decirlo con las palabras de la regla, catorce torneos, todos sin partidas:
      - el «Torneig d'Escoles» de Xàtiva (cinco ediciones, de 2022 a 2026), de Sub 8 a Sub 16. Se busca la frase entera, también como «torneig descoles» en el slug;
      - los interescolares en euskera («Eskolarteko Xake Txapelketa», «Eskolartekoa»: seis);
      - en gallego, el programa «Xadrez nas Escolas» (dos) y el «Torneio das Escolas» (uno).
    - «Escola», «Escolas» y «Escola d'Escacs» solos siguen sin entrar: son clubes, como «Escolas Xadrez As Burgas».
    - Añadidos el 25-oct-2026 más escolares que no lo decían con esas palabras: 59 torneos, 1.338 participaciones y ninguna partida (medido en producción, sin ninguno de más):
      - las siglas y nombres de los juegos escolares: JDN, los Juegos Deportivos de Navarra (33, de Sub 16 y Sub 18); JJ.EE. (uno), y el «Deporte Base» de Ciudad Real (13), su campeonato en edad escolar;
      - los de un colegio: los torneos FEC Vedruna (tres), «Ajedrez en el recreo» (tres), «I.E.S.» con puntos (dos) y el «Circuito … Inter Esc», con el nombre recortado (uno);
      - «Eskola Txapelketa», el campeonato escolar en euskera (los tres de Lekunberri). «Eskola» sola sigue siendo un club.
    - Los grupos «Especial» de los torneos de jóvenes de Navarra (de 12 a 16 años; seis torneos) se quedan, como un Sub 16 (decidido por Jorge el 25-oct-2026). El Cto. de Navarra absoluto por equipos «Especial» es la división.

### `src/lib/chess/`

- `src/lib/chess/`: nombres, PGN, ECO, árbol de jugadas, UCI y repertorio. Se comparte entre servidor y cliente.

#### `dossier.ts`

- `dossier.ts`: dossier para preparar a un rival (`/jugadores/{id}/preparar`): primera jugada (`firstMoves`), líneas principales, cambios del último año, resultados según el ELO del rival y cruce con tus partidas (`crossReference`).
  - **La primera jugada** va antes de las líneas, en su tarjeta (`components/dossier/PrimeraJugada.astro`).
    - Con blancas, sus primeras jugadas; con negras, las de sus rivales y, debajo de cada una, sus respuestas.
    - Cada jugada lleva su % de partidas y enlaza al repertorio en esa posición. La puntuación (ScoreBar) va en la jugada de la primera columna: con negras, la suya contra cada primera jugada, que es lo que eliges tú.
    - Una jugada sale sola si se juega en al menos el 5 % de las partidas de la posición, como mucho 4 (3 respuestas). Las demás se suman en «otras».
    - Sale del mismo índice que las líneas: ninguna lectura de D1 más.

#### `clock.ts`

- `clock.ts`: apuros de tiempo del dossier a partir de `games.clocks` (segundos que le quedan a cada jugador tras cada media jugada, del `[%clk]` del PGN; lo trae el 43 % de las partidas). Cuenta como apuro bajar del 5 % del tiempo inicial, y el resumen no mezcla ritmos.

### `src/lib/db/`

- `src/lib/db/`: consultas de la web. `repertoire.ts` (`getPlayerGames`) da las partidas de un jugador con un color para el repertorio y el dossier. `games.ts` (`getTournamentGames`) da las de un torneo o de una de sus rondas, con el recuento por ronda, que hace de total. `pairings.ts` da las próximas partidas emparejadas, que salen en la ficha (la de un posible menor, sólo en la suya: ver «Menores»), en la página del torneo, en el dossier y, con la cookie `yo`, en la portada. `standings.ts` (`getTournamentStandings`) da la clasificación del torneo: en uno individual sustituye a los participantes en cuanto la hay, y en uno por equipos va encima de las plantillas. Recorre la clave de `standings` sin ordenar y busca cada jugador en `participations` por la suya: unas dos filas por jugador. Los códigos de los desempates se explican con `TIEBREAK_NAMES` (`src/lib/chess/tiebreaks.ts`); los que no están ahí salen sin explicar.
  - `/partidas` sin búsqueda: «Se juegan pronto» (`getTopUpcomingPairings`, las 8 mesas de más ELO medio de las próximas rondas) y «Partidas de la semana» (`getTopRecentGames`, las 10 de más ELO medio de los últimos 7 días). En las dos, como mucho dos por torneo, con `topPerTournament`: lee las candidatas sin ordenar, elige en TS y sólo después pide el detalle de las elegidas (ver «D1 cobra por filas recorridas»). `players.ts` (`getRanking`) da, sin búsqueda, el ranking de `/jugadores` (absoluto, femenino, sub-18, +50 y +65; las edades, por año natural como la FIDE y la FEDA: `ageLimit`): los 10 primeros activos y los 10 que más suben, cada lista por su índice (`players_rating_std`, `players_rating_gain`).

#### Buscar torneos por sitio

- **Buscar torneos por sitio** (decidido con Jorge el 25-oct-2026): cada torneo guarda dónde se juega, en `tournaments.provincia` y `comunidad` (códigos del INE; migración 0017). Lo saca `tournamentPlace` (`src/lib/lugares.ts`) de su ciudad y, si la ciudad no lo dice, de su nombre. Lo escribe `upsertTournament`, y lo ya guardado lo rellena el reprocesado `{"lugares":true}`.
  - **La ciudad** se cruza con los municipios del INE, por cualquiera de sus denominaciones y con el artículo delante o sin él. De forma aproximada, también con los núcleos de población del IGN de 100 habitantes o más y con los principios de nombre («Vilagarcía»).
    - Va por trozos («Collado Villalba (Madrid)»), entiende las abreviaturas («Vva.», «C. Real», «GC») y quita las calles («C/Cifuentes», «… Kalea»).
    - Reconoce las islas y el extranjero. Un país que también es un sitio de aquí (Montserrat, Santa Lucía) sólo cuenta si el resto de la ciudad no lo es.
    - Entre homónimos, se queda con el que tiene diez veces más habitantes.
  - **El nombre** (`placesInName`, con los topónimos y gentilicios de `toponimos.ts`):
    - manda si la ciudad no dice el sitio;
    - afina la ciudad que sólo dice la comunidad;
    - gana a un cruce aproximado que diga otro sitio: «Torrente», con «Open Valencia», no es Torrente de Cinca.
    - Un torneo del extranjero no tiene sitio.
  - **Medido el 25-oct-2026** con los 8.850 torneos de producción:
    - info64: el 93,3 % con provincia y el 6,1 % sin sitio (locales, erratas, en línea);
    - la FCA: todos con provincia;
    - lichess: 52 en España y 221 fuera.
    - Error conocido: «Gaia» (Portugal, sin el país) cae en Gaià (Barcelona).
  - **En `/torneos`** (`tournamentTerms`, en `fts.ts`), una provincia o una comunidad se busca por dónde se juega el torneo o por la palabra escrita en su nombre (la columna `name` del FTS). Así «galicia» no encuentra el Memorial Gallego de Gijón, y «memorial gallego» sí.
    - Gana el nombre más largo («castilla y leon» frente a «leon») y vale el plural («gallegos»).
    - Las demás palabras se buscan en el nombre y en la ciudad, que está en el FTS («gijon»). El rótulo del campo es «Nombre o lugar».
    - **Equivalencias en inglés** (`EQUIVALENTS` en `fts.ts`, un `Map`): las retransmisiones de lichess del extranjero se llaman en inglés. europeo, europea y europa buscan también «europe» (como prefijo, también «european»); mundial, «world»; olimpiada, «olympiad», y copa, «cup», con OR y también en plural. Sólo van en el texto: no cambian los nombrados primero. «ce» no, porque como prefijo casa con «Cervera». Las palabras van con AND explícito: FTS5 no admite el implícito junto a un paréntesis. Medido en remoto el 25-oct-2026, sin ruido: «europeo» pasó de 1 a 43 torneos (129 filas), «mundial» de 4 a 60 (180) y «copa» de 90 a 107 (321).
    - **Primero van los torneos que nombran el sitio** (decidido con Jorge el 25-oct-2026): por cualquiera de sus nombres o gentilicios, como prefijo, y aparte el plural en -ces («andaluces»; `named` en `tournamentTerms`). Después, el orden de siempre por fecha, en las dos pestañas.
      - Con «campeonato andalucia», los Campeonatos de Andalucía salen antes que los provinciales.
      - Esos nombres sólo ordenan: no cuelan torneos de otro sitio.
      - Con dos sitios, va antes el que nombra más de los buscados.
      - La clave va en la subconsulta que elige la página (`page.named`). Los recuentos no la llevan.
    - Sólo se perdieron los 13 resultados de otro sitio que traían los gentilicios.
    - Siguen las coincidencias de la propia palabra (unas 20, como «Sevilla la Nueva» con «sevilla»), como en cualquier búsqueda por nombre.
    - Por provincias se pasa de 1.934 resultados a 8.004, y por comunidades, de 477 a 5.891.
    - Una comunidad va por su índice (`tournaments_comunidad_start_date`) y no por sus provincias: con `IN` habría que ordenarlas todas.
    - En remoto, una búsqueda por sitio lee de 840 a 1.510 filas en los recuentos y de 6.200 a 13.100 en la lista de 50 («asturias», 13.078). La mayoría son los participantes de los torneos de la página, que con los nombrados primero son los más grandes.
      - La lista elige primero los id de la página y sólo después cuenta los participantes de esos 50 (`searchTournaments`).
      - Antes los contaba de todos los torneos que casaban, porque al ordenar SQLite calcula las columnas de cada fila antes del `LIMIT`. Así llegaba a leer 72.310 filas («madrid»).
  - **Los datos** están en `data/lugares/` (INE e IGN, CC BY 4.0). Los citan `/acerca` y `/aviso-legal`, con `INE_MUNICIPIOS` e `IGN_NUCLEOS` de `licenses.ts`.
    - `node scripts/lugares.mjs` genera `src/lib/lugares.json`.
    - Cada febrero, cuando el INE publica la relación del año: `--descargar <año>`, después la fecha y el enlace de `INE_MUNICIPIOS`, y luego el reprocesado `{"lugares":true}`.

#### Las búsquedas

- **Las búsquedas** (decidido con Jorge el 25-oct-2026, en la revisión de usabilidad):
  - **En `/jugadores`, unas cifras (de 4 a 10) son un FIDE ID** (`fideIdQuery`). Si tiene ficha (`hasProfile`: `players` por la clave o, si no, `participations_fide_id`; 1 o 2 filas), una 303 a ella; si no, «Ningún jugador con el FIDE ID …». Así se llega a los de otras federaciones, que la búsqueda por nombre no encuentra: no se indexan (decidido por Jorge).
  - **Un solo resultado** lleva a la ficha (303) sólo con el nombre completo (al menos dos palabras de 2 letras o más), en la página 1 y sin filtros. Con una palabra no: la búsqueda va por prefijo, y «caruana» da un único jugador español que no es el GM.
  - **Sin jugadores,** «Buscar «x» en partidas (N) · en torneos (M)», cada enlace sólo si su cifra pasa de 0. Las cuentan `countGamesByName` (`games_fts`) y `countTournamentsByName` (el WHERE de `searchTournaments`, `tournamentsWhere`, con los ya empezados), con el tope (`countSql`) y sólo en ese caso. En remoto: 28 filas con «gukesh» y 1.000 con «garcia»; en torneos, 1 con «gukesh» y 1.480 con «madrid».
  - **«Quitar filtros»** va junto al botón cuando hay algún filtro además del nombre, en las tres búsquedas y en la ficha. Un enlace en un `.form-row` tiene el alto de los campos (`.form-row > a`, como `.check`): alineado por abajo, su texto quedaba más bajo que el del botón.
  - **En el móvil,** `/partidas` y `/torneos` pliegan el formulario tras buscar, si hay resumen y filas en la página (`FiltrosPlegables` con `label="Búsqueda"`): el primer resultado subió de y = 626 a 351 en `/partidas`.

#### Menores

- **Menores:** puede serlo quien es sub-18 por año natural (`mayBeMinor`); sin año en la lista FIDE, o sin FIDE ID, cuenta como adulto. Las tres primeras medidas son de la auditoría legal del 23-oct-2026:
  - **Sin dossier ni repertorio, ni sus PGN**, ni siquiera con su cookie `yo`, que no prueba quién eres (ver `src/lib/me.ts`). Responden con `jugadores/[fideId]/no-disponible.astro` (404, `noindex`; el PGN, el mismo texto en plano, `MINOR_UNAVAILABLE`). Se quedan así hasta que lo vea un abogado.
    - Los enlaces a ellos (la ficha, la próxima partida, el torneo y «Se juegan pronto») salen sólo con `hasDossier` (`hasDossierSql`: tiene partidas y no puede ser menor). La edad se mira tras las partidas: una fila más por jugador con partidas.
  - **La columna Fed.** (`federaciones.ts`, 25-oct-2026): sólo códigos de federación de la FIDE (los 207 y FID).
    - Desde mayo de 2024 el árbitro de info64 puede poner ahí otro campo, y la página del torneo enseñaba la categoría o el año («S12», «2017») junto al nombre.
    - Muchos campeonatos de España traen la comunidad de los españoles (AND, MAD, CAT) junto a la federación de los extranjeros. Lo que no es un código se vacía. MAD, AND y CAN son códigos (Madagascar, Andorra, Canadá) y también comunidades: se vacían en quien está en la lista FIDE española (por su FIDE ID, una fila por cada uno) y, sin FIDE ID, si la columna trae algo que no es un código (`federationColumn`). Así se conservan los extranjeros de verdad, también en un torneo con una errata («ESp»).
    - Lo aplica `replaceParticipations` al escribir y, a lo guardado, el reprocesado `{"federaciones":true}` (`clearNonFederations`). Medido en producción: 65.785 filas en 1.123 torneos, 17.364 con cifras.
  - **Del nombre de los homónimos** («Apellido Inventado, Nombre 2011»), `publicName` (`src/ingest/nombres.ts`). Se aplica a todo nombre que se guarda, venga de donde venga: la lista FIDE, y los participantes, las plantillas, los emparejamientos y las partidas de info64 y de lichess, que copian el nombre FIDE con su año. En las partidas, también en la cabecera `White`/`Black` del PGN. Lo mismo con el de quien ha ocultado su año.
  - **Se sanea al escribir, no al leer:** las partidas se cruzan con los participantes por el nombre completo (la salida del paso del torneo, `SyncedTournament.participants`, no lo guardado). Sin el año, dos homónimos del mismo torneo serían el mismo nombre y ninguno recibiría su FIDE ID.
  - El año del nombre es el de nacimiento, así que no hace falta el FIDE ID. Los adultos lo conservan.

#### Retirada de datos

- **Retirada de datos** (tabla `retiradas`, migraciones 0010 y 0013; `/privacidad` explica cómo pedirla):
  - En participantes, partidas y emparejamientos, su nombre pasa a «Jugador retirado» (`RETIRED_NAME`), sin FIDE ID ni título. En el PGN, también sus cabeceras.
  - Las partidas de sus rivales se conservan.
  - Quien no tiene FIDE ID va con `fide_id` NULL. Hasta la 0013 era la clave primaria, y con NULL SQLite le daba el mayor de la tabla más uno: el FIDE ID de otra persona, que se quedaba sin ficha.

#### Ocultar el sexo o el año

- **Ocultar el sexo o el año** (tabla `ocultaciones`, migración 0015; art. 21 RGPD, decidido el 24-oct-2026): quien lo pide deja de enseñar su sexo, su año de nacimiento o los dos. Los trae la lista FIDE, que no deja de traerlos: el sexo viene siempre, y el año sólo desaparece si la FIDE lo oculta.
  - Una fila por FIDE ID y `campo` (`'sexo'` o `'anio'`), con la petición (`P-AAAA-NNN`). Sin FIDE ID no hay ficha que ocultar.
  - **El año** se guarda igual, con `birth_year_hidden` 1, porque hace falta para saber si puede ser menor (`mayBeMinor`, `hasDossierSql`, el sitemap); sin año contaría como adulto. No sale en ninguna página (`publicBirthYear` en `players.ts`, como el de los menores) y el jugador no entra en los rankings por edad (`rankingQueries`). La marca va en la misma fila: el plan y las filas de los rankings no cambian.
  - **Tampoco en el nombre de los homónimos** («…, Nombre 1980», unos 900 adultos): `withoutHiddenYear` (`nombres.ts`) lo quita de todo nombre que se guarda, como `publicName` el de los menores y también después de cruzar. Como la retirada, con FIDE ID sólo por él y sin él por el nombre y el año, contra la ficha (`yearKey`).
  - **Al escribir:** la lista FIDE en el SQL de `upsertFidePlayers`, por el índice único de la tabla y sin cargarla (una fila leída más por jugador que está en ella; el nombre sin el año va en `bareName`, sólo en los homónimos); los participantes, las partidas (también el PGN) y los emparejamientos, con `loadHiddenYears`, que se lee en cada escritura como `loadRetired`.
  - A lo ya guardado lo aplica el reprocesado (`{"ocultaciones":true}`, `applyHidden`), sin recorrer las partidas: las candidatas, por FIDE ID y por el FTS (`loadGameCandidates`, el de la retirada). Los participantes sí se recorren enteros (unas 700.000 filas leídas), para encontrar a los homónimos.

#### Rectificación y limitación

- **Rectificación y limitación** (`src/ingest/rectificaciones.ts`; tabla `rectificaciones`, migración 0014; arts. 16 y 18 RGPD, H-7 de la auditoría legal, 24-oct-2026): corrige un dato de una persona en un torneo, o lo deja vacío mientras se comprueba, y las relecturas de la fuente lo respetan.
  - **Quién:** el torneo, por `source` y `source_key`, y la persona tal como la lee la ingesta de la fuente, antes de rectificar: su FIDE ID, su nombre (con `nameKey`: sin tildes ni año de homónimo) o los dos. Con `ronda`, sólo su partida de esa ronda.
    - Ni el id de la partida ni su mesa valen: `saveGames` los conserva mientras no cambien la ronda, la mesa y `seq`, y la mesa se numera por orden si la fuente no la da.
  - **Qué:** `campo` y `valor`. `fide_id`, `nombre`, `titulo` y `elo`, de todo el torneo o de una ronda; `resultado` y `oculta`, de una ronda. NULL deja el dato vacío (la limitación) y `oculta` no guarda la partida. Los `CHECK` rechazan al insertarla una fila mal escrita, y el índice único, dos valores para el mismo dato.
  - **Al escribir,** en `replaceParticipations` y `saveGames`, después de `publicName` y antes de la retirada, que mira a quien es de verdad. Los emparejamientos lo toman de los participantes, por el JOIN. En el PGN, `setPgnTags` y `setPgnResult` cambian sólo esas líneas.
  - Gana la fila de una ronda sobre la del torneo y, a igualdad, la más nueva.
  - **Se aplica releyendo el torneo** (`keys`, o `tours` con `force`), no con el reprocesado: lo guardado ya está rectificado, y una segunda fila de la misma persona, que dice lo que da la fuente, no casaría con ello. Si la fuente ya no sirve las partidas, nada pisa lo guardado y vale un `UPDATE` a mano.
  - **`aplicada`:** cada escritura apunta la hora en las filas que aplica y NULL en las que le tocaba aplicar y no casan, porque la fuente lo ha corregido o ha cambiado el dato. Los participantes responden de las de todo el torneo; las partidas, de las de ronda y, sólo si casan, de las del torneo (una persona puede no tener partidas). Una guarda que conserva lo guardado no escribe ni toca `aplicada`. Con alguna en NULL, `/api/estado` da la alarma (ver «Producción»).
  - No cubre la ficha, que se corrige en la FIDE; la clasificación, que es del árbitro, ni las jugadas, que se ocultan mientras la fuente las corrige. Cómo atender una petición, en la guía de operación.

### `src/lib/me.ts`

- `src/lib/me.ts`: «tú» en el dossier: el FIDE ID propio llega en el campo `yo` de un formulario POST (desde el dossier o con «Soy yo» en tu ficha, `readMeField`) y se recuerda en la cookie funcional `yo` (un año, `HttpOnly`); `yo` vacío la borra. Con ella, tu ficha, tu dossier y tu repertorio te hablan a ti (`isOwn`: «Mi dossier», «Tus líneas principales»), y el panel de la lupa enlaza a tu ficha. Es la única cookie (ver `/privacidad`).
  - Guardada o borrada, la ficha y el dossier vuelven a sí mismos por GET (303), con el ancla del formulario (#tu). El dossier no lo hace con un ID que no existe o es el del rival, ni con un nombre: responde al POST diciendo por qué o con la lista (`redirectsAfterForm`). Esa respuesta no entra en bfcache (un POST no puede) y, al volver a ella con Atrás, el navegador pide reenviar el formulario.
  - En el dossier, `yo` puede traer tu nombre en vez del ID (`meName`). La tarjeta «Tú contra…» lista los 8 primeros que casan (`findPlayersByName` en `db/players.ts`, sin el rival), en un formulario donde cada nombre es un botón que envía su ID. No hay parámetro de vuelta desde la ficha: sería una redirección abierta.

#### Por POST, no en la URL

- **Por POST, no en la URL** (decisión de la auditoría legal, 24-oct-2026): así tu FIDE ID o tu nombre no quedan en los registros de Cloudflare, en el historial ni en un enlace que se comparta. «Soy yo» y «No soy yo» son botones `.link` dentro de la frase. Un `?yo=` en la URL ya no hace nada.

#### No prueba quién eres

- **No prueba quién eres:** cualquiera la consigue con «Soy yo». De un posible menor (ver «Menores»), con su cookie se ven su próxima partida en su ficha, que sale igual en la página del torneo, y en el dossier de un adulto «Tú contra…», que cruza sus partidas con las del adulto.

### `src/layouts/Base.astro`

- `src/layouts/Base.astro`: cabecera, pie y `<title>`. El nombre del sitio (`siteName`, «MapleChess») va detrás del título de cada página; la portada lo pone delante y Base no lo repite.

#### Cabecera

- **Cabecera:** 64 px en escritorio, con el logo a 40 px y el nombre a `--text-xl`. El logo, el relleno y el hueco crecen de 320 a 640 px de ancho; en el móvil, con el menú en otra fila, mide 98 px a 375. El visor (`100svh - 20rem`) y el explorador del repertorio (`23rem`) le reservan el alto: si la cabecera crece, hay que revisarlos.
  - La pestaña de la sección lleva `aria-current="page"` en su página y `"true"` en lo que cuelga de ella (una ficha, una partida, un torneo). Si no caben (a 250 px, la letra al 150 %), la lista lleva la sombra de borde de `.table-wrap` y se abre en la activa con `scroll-initial-target: nearest`, como mejora progresiva. Su `scroll-padding-inline-start` es el relleno: sin él, Chromium pegaba la primera al borde.

#### Pie

- **Pie:** con el fondo y la raya de la cabecera. Lleva la marca en pequeño (logo a 32 px, nombre a `--text-l`) con una frase de qué es la web, dos listas de enlaces y, debajo, las atribuciones y el código.
  - La primera lista es la portada («Prepara tu partida») y las secciones de `nav`, la misma del menú: una sección nueva sale en los dos. La segunda, las páginas del sitio: Acerca de, Privacidad y Aviso legal.
  - Las listas van junto a la marca o debajo, sin punto de corte.
  - Las reglas del menú van con `.tabs`: un `nav` a secas en el `<style>` de Base alcanzaría también el del pie.

#### Canonical

- **Canonical:** la ruta sin query sobre `site` (`canonicalHref` en `src/lib/urls.ts`), sin barra final. Los filtros, la página y la ronda son variantes de la misma página. La ficha, el torneo y la partida la construyen con su ID (prop `canonical`): `positiveInt` acepta `/jugadores/02200000`. Una página con `noindex` no lleva canonical, para no dar señales contrarias.

#### `noindex`

- **`noindex`:** búsquedas, dossier, repertorio, páginas de error, fichas sin torneos ni partidas o de posibles menores (ver «Menores»), torneos sin partidas y con menos de dos jugadores (`isIndexableTournament`: cancelados, o sin la lista ni las partidas en la fuente; 47 el 24-oct-2026) y partidas sin jugadas (`plyCount`). La partida con `?color=` sí se indexa: su canonical es la partida sin query.

#### OpenGraph

- **OpenGraph** en todas las páginas: `og:title` sin el nombre del sitio, que va en `og:site_name`; `og:url`, sólo si hay canonical. La imagen es `src/assets/compartir.png` (1200×630, `summary_large_image`), importada: lleva hash, así que cambia de URL al regenerarla.

### `src/pages/`

- `src/pages/`: páginas (formularios GET, funcionan sin JS) y endpoints `.pgn`.
  - La portada (`index.astro`) lleva un tablero de fondo en la esquina de arriba a la derecha, sólo con CSS (`repeating-conic-gradient` de `--board-dark` y `--board-light`, y una máscara). Como mucho al 12 %: sobre una casilla de nogal, el gris queda a 4,9:1. No sale al imprimir ni con `forced-colors` o `prefers-contrast: more`.

#### Torneos de la ficha

- **Torneos de la ficha** (`TorneosJugador.astro`, que la ficha usa dos veces): se ven los 20 más recientes y, si hay más de 25, el resto va en un `<details>` «Ver los N anteriores». Con 279 torneos, la ficha medía 36.100 px a 375 de ancho (24-oct-2026). El gráfico de ELO sigue con todos.
  - No se pagina: no ahorraría filas de D1, porque el gráfico, el recuento y el orden por fecha necesitan todos los torneos (838 filas con `LIMIT` y sin él, en esa ficha).
  - «Nº inicial» y «Partidas con PGN» van en dos líneas (`<br>`): en una sola le quitaban unos 100 px a la columna del torneo. En los torneos por equipos, el número es el tablero y va con el equipo.
  - **Puesto y puntos** (decidido con Jorge el 25-oct-2026, sobre maquetas): la última columna dice el puesto y los puntos de la clasificación del torneo, «1.º · 8 / 9». Antes salían sólo los puntos de las partidas con PGN, que faltan en unos 4 de cada 5 torneos; sin clasificación, siguen ésos.
    - Si no es la final (`standingsOver`), «tras la ronda 5» debajo, y los puntos sobre las rondas jugadas (`standingProgress`). Apilada, tras una coma.
    - En los torneos por equipos, el puesto del equipo tras su nombre, «C.A. Solvay (1.º)», y «(3.º, en juego)» hasta su fecha de fin, porque la fuente no dice la ronda. Se busca por el nombre, como las plantillas (en producción casan las 93.507 participaciones), en una subconsulta porque el nombre se podría repetir. Los puntos del equipo no salen.
    - La columna parte línea antes que ensanchar la tabla, que en paralelo ya pedía 958 px.
    - **Filas:** +1 por torneo individual y +2 por torneo por equipos, con los índices de la migración 0019: `standings_start_rank`, único (con uno no único se leían dos filas por torneo y, sin estadísticas, el planificador prefería recorrer la clave: 18.497 filas en vez de 1.357 en la siembra), y `standings_team_name`, parcial, sólo en las filas de equipos.
    - En una liguilla impar el descanso no puntúa: sale «5 / 9» a quien jugó 8.
  - **Mejor ELO estándar en sus torneos** (`bestStandardRating`, 25-oct-2026): sobre el gráfico de ELO, «2688 (CE …, agosto de 2020)», con el torneo enlazado. Sale de las mismas filas: sólo los torneos de ritmo estándar que ya han empezado (los participantes se guardan antes, con el ELO de la última lista), y la primera vez que lo tuvo. Con menos de dos torneos, no sale. No es su máximo FIDE: el rótulo dice «en sus torneos».

#### Las tres páginas del jugador

- **Las tres páginas del jugador** (decidido con Jorge el 25-oct-2026, sobre maquetas): bajo la cabecera de la ficha, del dossier y del repertorio van las pestañas «Ficha · Preparar · Repertorio» (`PestanasJugador.astro`; en las tuyas, «Mi ficha · Mi dossier · Mi repertorio»), con `aria-current="page"` en la actual. «Jugadores» del menú lleva `"true"`, y la miga de jugadas del explorador, `"step"`: el lector oye una sola «página actual».
  - Van sin caja, con la raya de las pestañas del menú, porque los `Segmented` de los filtros, justo debajo, llevan caja. A 250 px, las tuyas parten en dos líneas.
  - A un posible menor no se le ponen (`hasDossier`).
  - Sustituyen a «← Ficha de …» de `CabeceraJugador`, que llevaba al mismo sitio.
  - **El repertorio, desde la ficha,** va en «Aperturas más jugadas», que ya va por su color: «Explorar su repertorio con blancas», en su propia fila al final de cada grupo. En la fila del color formaría parte de la cabecera del grupo, y el lector la repetiría en cada celda. En la fila de preparar, «con blancas» era el tuyo en los botones y el suyo en el enlace.

#### Sus partidas de un torneo

- **Sus partidas de un torneo:** el número de «Partidas con PGN» lleva a `/jugadores/{id}?torneo={t}#partidas` (`nofollow`). La ficha dice el torneo encima de los filtros (va oculto en el formulario), el índice da el total de la lista, la tabla va sin su columna y la descarga lo conserva.
  - Sólo vale uno de sus torneos, de los de su tabla. Con otro, una 302 a la ficha sin él, o con el id bien escrito: `positiveInt` lee «1e3» como 1.
  - Con los dos colores, SQLite va por el índice del torneo: lee como mucho las partidas del más grande (866 el 25-oct-2026). En remoto, 189 + 177 filas por 11 partidas, y 353 + 331 forzando el del jugador (`+g.tournament_id`), que en un jugador con miles de partidas las leería todas. Con un color, va por `games_white` o `games_black`.

#### 20 partidas por página

- **20 partidas por página** en la ficha y en el repertorio (`PLAYER_PAGE_SIZE`; `toPage` y `offset` con tamaño): la lista era el 58 % de la ficha y el 79 % del repertorio. Las búsquedas siguen de 50 en 50: su tope son 20 páginas de 50.
  - Con el índice «En esta página» y las pestañas, la ficha pasó a 375 de 12.175 a 8.122 px, y los torneos de 9.170 a 5.116; el repertorio, de 8.732 a 4.730 (25-oct-2026).

#### Página del torneo

- **Página del torneo** (`torneos/[id].astro`; decidido con Jorge el 25-oct-2026, sobre maquetas): primero lo que resume el torneo. La próxima ronda, la clasificación (o, sin ella, los participantes), las partidas y, en uno por equipos, las plantillas al final. Sin ninguna partida, «Partidas» va la última, con «Aún no ha empezado.» si empieza después de hoy (`madridDate`). El orden sale de la lista `sections`, y el índice, de la misma.
  - Medido el 25-oct-2026 en producción: la clasificación del CE Absoluto 2025 pasó de 6.393 a 356 px a 375, y de 2.952 a 288 a 1280.
  - **Torneos del grupo** (`PestanasGrupo.astro`; decidido con Jorge el 25-oct-2026, sobre maquetas): las pestañas del «Grupo de Torneos» de info64, bajo la cabecera y antes del índice.
    - La ingesta las lee de la página del torneo, que ya pide (`parseTournamentPage`), y las guarda en `tournaments.related` (migración 0018) si son dos o más e incluyen el propio torneo (`relatedGroup`). Se guarda el grupo entero, también los torneos que no tenemos, y una lectura sin pestañas no lo borra (`coalesce`, como la ciudad).
    - No se rellenó lo guardado: la diaria lo trae en unas dos semanas a los torneos vivos, y los antiguos no lo tienen. Rellenarlo sería pedir `/schedule` (26 KB) de cada torneo, de madrugada.
    - **Se desplazan** en una fila, como el menú, y se abren en la actual: partiendo línea, cinco pestañas ocupaban cuatro filas a 250 px.
    - **La consulta** va con `CROSS JOIN` sobre `json_each`, por la clave única: de 4 a 24 filas. Con `JOIN`, SQLite recorría todos los torneos de info64; con `IN (SELECT …)`, contaba además la lista.
  - **Resumen** (decidido con Jorge el 25-oct-2026): bajo la línea gris, «100 jugadores · 7 GM · 16 IM · ELO medio 2211» (`tournamentSummary`), de la clasificación o de los participantes, ya leídos: 0 filas más. Sólo GM e IM, y el ELO medio de los que lo tienen. Por equipos, los títulos de las plantillas y la media del ELO medio de los equipos de la clasificación. No va en los torneos propios de lichess: sus jugadores son sólo los de sus partidas.
  - **Por equipos:**
    - **Plantillas:** un `<details>` por equipo, con sus jugadores y el ELO medio de la clasificación (el que publica info64; sin clasificación, no sale). Los jugadores sin equipo de una retransmisión de lichess van al final, en «Sin equipo». En papel salen abiertas (`::details-content`). En el CE de Rápidas por Equipos 2026 (52 equipos) pasaron de 20.425 a 3.136 px a 375.
    - **El encuentro** de cada partida (`gameMatches`, `src/lib/encuentros.ts`) sale de las plantillas, que ya se leen, por FIDE ID y, sin él, por el nombre: info64 recorta los nombres de las plantillas, y por nombre sólo casaban 42 de 50 partidas. Los equipos van en el orden de la primera partida del encuentro en la página, y sin marcador, que pediría leer la ronda entera. En `GamesTable` es la prop `match`: en el móvil, una línea bajo los jugadores; en escritorio, la columna «Encuentro», que con nombres largos alarga las filas. Si no casa ninguna partida de la página, no hay columna.
    - **La clasificación** no enseña el desempate que es la propia puntuación: el que da lo mismo que «Pts.» en todas las filas (`pointsTiebreaks`, mirado en los datos y no en el código). La nota lo nombra («MP no sale en la tabla: es la misma cifra que Pts.»).
      - Sólo con 4 filas o más. En la D1 remota (25-oct-2026) era MP en 64 torneos, MatPnt en 59 y GP o GamPnt en 26, de 584 por equipos con clasificación.
      - En los individuales coincide por casualidad (victorias = puntos sin tablas: Mwns en 47 y WIN en 41, casi todos de 3 a 6 jugadores), y no se quita.

#### Campeones de España

- **Campeones de España** (`torneos/campeones.astro`; decidido con Jorge el 25-oct-2026, sobre maquetas): una tabla por categoría con el año, el campeón y sus puntos y, debajo, su torneo y «sus partidas» (`/jugadores/{id}?torneo={t}#partidas`). Indexable y en el sitemap. La enlazan `/torneos`, junto a las pestañas, y la página de cada campeonato de la lista, junto a sus botones (`championshipsOf`, sin D1). No va en el menú.
  - **La lista va a mano** en `src/lib/campeonatos.ts`, por categoría y año, con la clave natural del torneo (`source`, `source_key`) y no su id. No se busca por el nombre: «absoluto» casa con cientos de regionales y abiertos, y hay torneos con nombre de campeonato que no son el oficial (el «Relámpago Hotel Churra» de 2023).
  - **Siete categorías,** desde 2015: Absoluto, Femenino, Rápido, Relámpago, Veteranos +50 y +65, y División de Honor. Sin las de menores (Sub 16, Sub 18, sus rápidos, las selecciones cadete y la Copa Sub-18), ni los tramos de ELO ni el Universitario. Faltan las ediciones que no están en D1 (el Rápido de 2017 y 2020, el Relámpago de 2015 a 2017 y de 2020, los Veteranos de 2020).
  - **El campeón** es el primero de la clasificación final; con empate, el primero por desempate. Si no lo es, la edición lleva su número inicial (`startRank`), nunca su nombre ni su FIDE ID, porque el repositorio es público: la mejor mujer de un absoluto mixto (desde 2018, y en 2016) o el mejor español de un abierto («1.º español»: el Rápido de 2015, que encabeza un jugador de Perú).
    - Comprobado con la FEDA (hasta 2020), Wikipedia y OlimpBase. En Veteranos +50 de 2015 el primero por desempate tenía Fed. «FID» en el torneo y no hay resultado publicado: se queda él.
  - **Unas 440 filas por visita** (`getChampions`, una sentencia por edición en un `db.batch`): 4 por edición, 2 en las de equipos y, con número inicial, además tantas como el puesto, hasta llegar a su fila de `standings`.

#### Páginas legales

- **Páginas legales:** `privacidad.astro` y `aviso-legal.astro`, junto a `acerca.astro` en el pie, con `.page-head` y `.prose`. La política cuenta lo que hace `main`, no lo previsto: el PR que cambia qué se publica, se guarda o se registra de alguien (la ingesta, los menores, las retiradas, una cookie, un proveedor) la actualiza a la vez, con su fecha.
  - `/privacidad` abre con el resumen (la capa básica del art. 11 LOPDGDD) en filas de `.def-list` y un índice que sale de la misma lista que los títulos de los apartados (`sections`). Desde 66rem el índice va a la derecha del texto y se queda fijo al bajar; por debajo, tras el resumen. Sus anclas (`#oposicion`, `#derechos`…) las enlazan el README y las otras páginas: no se cambian.

### `src/middleware.ts`

- `src/middleware.ts`: `Cache-Control: private, max-age=0, must-revalidate` por defecto (`private`: las páginas cambian con la cookie `yo`). Una ruta sólo fija la suya si admite caché (las descargas PGN). Además, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` y HSTS de un año en todas las respuestas, y el límite de ritmo (ver «D1 cobra por filas recorridas»). Sin `Referrer-Policy`: «← Volver» depende del valor por defecto.

#### CSP

- **CSP:** la pone Astro (`security.csp` en `astro.config.mjs`) como cabecera, con los hashes de sus scripts y estilos en línea, `'self'`, `'wasm-unsafe-eval'` y `style-src-attr 'unsafe-inline'` (los atributos `style` de los gráficos y de chessground). Los `<script>` y `<style>` que emite Astro llevan su hash; uno creado desde JS, un atributo `on…` o un recurso de otro origen se bloquean. `pnpm dev` no la aplica: se prueba con `pnpm build` y `pnpm exec wrangler dev`, mirando la consola.

### `src/client/`

- `src/client/`: código de navegador (`<visor-partida>`, motor, `<explorador-repertorio>` y el cierre del panel de búsqueda). Tiene **su propio `tsconfig`** y se incluye con `<script src>`; ver «Trampas».

#### Los dos tableros, en un solo script

- **Los dos tableros, en un solo script:** `src/client/tableros.ts`, que carga `components/visor/ScriptTableros.astro` en el visor y en el explorador. Con un script por componente, Vite sacaba lo común (chessground, chessops, el panel del motor) a otro archivo que el navegador sólo pedía tras leer el primero, y Astro no emite `modulepreload`. Cada página trae así el código del otro elemento: 1,8 KB comprimidos más en el repertorio.

#### Antes de montarse chessground

- **Antes de montarse chessground** (decidido con Jorge el 25-oct-2026):
  - `.board` lleva las casillas de `board.css` (`.board:not(.cg-wrap)`);
  - chessground se crea ya en la posición que va a enseñar, la del `#j` o la final (`linkTarget` en `visor-partida.ts`).
  - Antes, en un móvil lento, el hueco quedaba vacío de 0,3 a 0,55 s y las piezas entraban volando desde la salida.
  - Pintar en el servidor el tablero del visor se descartó: el servidor no ve el `#j`, y con un enlace a una jugada enseñaría otra posición durante unos 0,3 s.

#### La vuelta desde la partida

- **La vuelta desde la partida** (`backTarget` en `params.ts` y `backLink` en `partidas/[id].astro`; 25-oct-2026): «← Volver a la búsqueda», «← Volver a Partidas» (`/partidas` sin búsqueda) y, si es de uno de los dos jugadores, «← Volver a la ficha de {nombre}», al dossier o al repertorio (los tuyos, «a mi ficha»). Tras «Anterior» o «Siguiente del torneo», «← Volver al torneo», a la ronda y la página de la partida (`gameRoundPage`: una fila por mesa anterior de la ronda, por el índice único). Sin lecturas de D1 más que ésa: el Referer se compara con las partidas adyacentes, que ya se leen. Si el enlace es la página de antes, vuelve con el historial (`onBack`).

#### Comentario de la jugada en el móvil

- **Comentario de la jugada en el móvil:** en una columna, el de la jugada actual sale bajo los botones (`.move-note`), sólo en las partidas con comentarios y con su línea reservada, para que el motor no salte. En dos columnas, no. Se anuncia con la jugada: va oculto a la vista dentro de la región viva (`showCurrent`), y la línea lleva `aria-hidden`.

#### Variante propia

- **Variante propia** (`visor-partida.ts`, `variante.ts`; decidido con Jorge el 24-oct-2026, sobre maquetas): en el visor se mueven las piezas del bando al que le toca, como en el explorador (o se escribe la jugada, ver «Escribir jugadas»), y pulsar una línea del motor la convierte en variante. No se guarda nada ni cambia el PGN.
  - Jugar la jugada de la partida o la de una variante del PGN sigue la partida. Si no, empieza la variante, en una franja encima del motor (en una columna, bajo los botones): «Variante propia», «Volver a la partida» y sus jugadas. Una jugada nueva en mitad de la variante sustituye a lo que seguía.
  - **En el enlace** (decidido con Jorge el 25-oct-2026): el `#j` lleva la variante hasta la jugada que se ve, `#j12+g1f3+b8c6` (UCI estándar, separada por `+`; desde la inicial, `#j0+e2e4`), y «Copiar enlace» la copia. Al retroceder en la variante se acorta, y con «Volver a la partida» queda `#j12`.
    - Al cargar (y con `hashchange`), `followLink` (`variante.ts`) juega las jugadas desde el nodo: mientras coinciden con la partida o con una variante del PGN, se siguen por ella, y desde la primera que no, son variante propia.
    - Lo que no es legal se descarta sin aviso, y la URL no se toca hasta la siguiente jugada.
    - «Copiar PGN» copia la partida sin la variante, y «Copiar FEN», la posición del tablero. Los tres van en la barra de acciones de la página, dentro de `<visor-partida>`: el botón cuadrado «FEN» salió de los controles el 25-oct-2026.
  - Las líneas del motor son botones (`.pv-line`). Llevan su primera jugada en `data-uci`, para la flecha gris al señalarlas, y se actualizan sobre los mismos nodos: si se rehacían, unas siete veces por segundo, se perdían el clic y el foco. En el explorador, pulsar una línea juega su primera jugada.
  - Deslizar sobre el tablero vale si el dedo no empieza en una pieza del bando que mueve ni hay una pieza elegida (`onlyBoard`): del 76 % del tablero en la apertura al 92 % en el final. Al tocar una pieza, chessground no deja desplazar la página, como en el explorador.

#### Coronar

- **Coronar** (`components/visor/Coronacion.astro`, `client/visor/coronacion.ts`; decidido con Jorge el 25-oct-2026): en el visor y en el explorador, un peón que llega a la última fila abre un `<dialog>` nativo con las cuatro piezas (las del tablero, sobre el arce, en las mismas reglas de `board.css`) y su nombre. Es un formulario `method="dialog"`: cada pieza lo cierra con su nombre en `returnValue`; Esc o «Cancelar», sin ninguna, y el peón vuelve.
  - El foco va a la dama (`autofocus`): sin él, Chrome enfoca el diálogo. Con el teclado, Intro corona dama.
  - Devolver una pieza es poner el tablero entero (`setBoard` en el visor, `position()` en el explorador): tras mover, chessground ya ha cambiado el turno y quitado los destinos.
  - Con el diálogo abierto, ← y → no cambian de jugada (`onKey` ignora lo que pasa dentro de un `dialog`).
  - Por debajo de 20,5rem las piezas van de dos en dos: la fila pide 324 px con «Caballo».
  - La página atenuada detrás es el token `--backdrop`.

#### Escribir jugadas

- **Escribir jugadas** (`components/visor/CampoJugada.astro`, `client/visor/campo-jugada.ts`; maqueta aprobada por Jorge el 25-oct-2026): un campo «Tu jugada», porque chessground no tiene teclado (WCAG 2.1.1). En el visor va arriba del lateral, encima del motor (en una columna, bajo los botones). En el explorador, detrás de la tabla, también en dos columnas, y no en la última jugada del repertorio (decidido con Jorge el 25-oct-2026, sobre maquetas): delante, en un móvil de 667 px de alto la primera fila empezaba a 634 px y no se veía ninguna entera tras cada jugada; detrás, se ven dos. Vacío no se envía (`required`).
  - `readMove` lee SAN o UCI, y también lo que chessops no acepta: «nf3», «0-0», «e2-e4», «bd5» (la «b» minúscula es primero el peón) y los signos de detrás. Una coronación sin pieza abre el diálogo de coronar. Lo ambiguo («Puede ser Nbd4 o Nfd4.», con figuras) y lo ilegal se dicen bajo el campo, en una región viva y con `aria-invalid`.
  - Las jugadas legales van en un `<datalist>`, que se rellena al entrar en el campo y tras cada jugada. Con `list`, el campo es un combobox.
    - `MoveInput.focus()` lo rellena antes de poner el foco: si pasa de vacío a lleno con el foco dentro, Chrome baja hasta el campo aunque se pida `preventScroll`, y en el explorador, tras escribir una jugada, el tablero se iba de la vista en el móvil. Así se ven el tablero y las primeras jugadas, y al teclear el navegador trae el campo.

#### Lo que puede fallar o limitarse va después del estado

- **Lo que puede fallar o limitarse va después del estado:** la URL, el portapapeles, el almacenamiento. Safari lanza un `SecurityError` tras 100 `history.replaceState` en 10 s (en 30 s hasta Safari 16), así que el visor escribe `#j` 300 ms después de la última jugada, en un `try/catch`.

#### `panel-busqueda.ts`

- `panel-busqueda.ts`: el popover de la cabecera se cierra cuando el foco sale de él hacia otro elemento; si no, quedaba encima del elemento enfocado. Sin `relatedTarget` no se cierra: Safari no enfoca el botón «Buscar» al pulsarlo. También se cierra en `pagehide`, al buscar: si no, al volver con Atrás bfcache lo enseñaba abierto.

#### bfcache

- **bfcache:** todas las páginas entran (salvo la respuesta a un POST del dossier, ver `me.ts`), también la partida con el motor (su Worker se congela y sigue al volver). Comprobado el 23-oct-2026 en Chrome, con el evento `Page.backForwardCacheNotUsed` de CDP: `notRestoredReasons` sólo dice «masked», y Playwright arranca Chromium sin bfcache.

### `src/assets/fonts/`

- `src/assets/fonts/`: la serif de los titulares (`--font-serif`), Source Serif 4 de Adobe (OFL) en peso 600, recortada y renombrada «Titulares»; su licencia, en `public/fonts/OFL.txt`. Se sirve desde el propio sitio, nunca desde un CDN. Pasa por Vite, como el CSS, para que lleve hash y quede en `/_astro/`, que el adaptador sirve con caché inmutable de un año. La regenera `scripts/fuente-titulares.py` (Python con fonttools), que también calcula el ajuste de métricas de sus respaldos en `global.css`. Si cambia, hay que volver a sacar el nombre en trazos de la tarjeta para compartir (`scripts/nombre-marca.py`, ver `public/favicon.svg`). Aquí está también la fuente de las figuras de la notación, `figuras.woff2` (ver «Notación»), que va incrustada en el CSS.

### `src/styles/global.css`

- `src/styles/global.css`: **tokens** de color, espaciado, radio y tipografía, con `light-dark()`. Usar tokens, nunca valores literales.
  - Todo menos los `@font-face` va en `@layer base`: cualquier regla de un componente le gana, tenga la especificidad que tenga. Sin la capa mandaba el orden de las hojas, que sigue al de los imports, y por el orden alfabético los componentes llegan antes que `Base.astro`. Si un componente no debe pisar una clase global (los colores de `.result.win`), que no declare esa propiedad. `board.css` y el CSS de chessground van sin capa: `board.css` pisa a chessground por orden.
  - Tres papeles para el color. **Marca:** madera de arce y nogal frío (`--maple`, `--walnut`, `--brand`), para logo, favicón y tablero; es distinta de las maderas de lichess y chess24, y nunca se usa para interacción. **Acento:** azul tinta (`--accent`), para enlaces, botones, foco, lo actual y la última jugada. **Significado:** resultados y ritmos, siempre con texto o leyenda al lado. En las barras de reparto (ScoreBar), las tablas van atenuadas hacia la superficie (`--result-draw-soft`): ganadas, tablas y perdidas tienen casi la misma luminosidad y, cuando faltaba un tramo, sólo el tono decía cuáles quedaban.
  - Campos, selects, botones y Segmented miden `--control-height`, para que cuadren en una fila: el alto lo da `min-height`, no el relleno. La sombra (`--shadow-m`) es sólo para lo que flota: el buscador y el aviso de copiado.
    - El `label` es una rejilla de una columna `minmax(0, 1fr)`. Con una columna `auto`, su mínimo era el ancho propio del campo (206 px por `size=20`), y a 250 px el campo de «Tú contra…» y el del buscador de la cabecera se salían de su caja. Así encoge cuando no cabe, también dentro de una fila flex, y con sitio mide lo mismo.

#### Texto grande

- **Texto grande:** un mínimo en rem dentro de una rejilla o de un `clamp` va dentro de `min(100%, …)`. Con la letra del navegador al 150 %, `minmax(18rem, 1fr)` (las tarjetas de la portada) o `--board-min` desbordaban el móvil. Para comprobarlo, una ventana de 250 px equivale a 375 px con la letra al 150 %.

#### Barras del móvil

- **Barras del móvil:**
  - `theme-color` (en `Base.astro`) es el `--bg` del fondo de la página, en claro y en oscuro, escrito en `src/lib/theme-color.ts`: una meta no lee variables CSS. Un test lo compara con el token.
  - No es el `--surface` de la cabecera porque Chrome Android descarta los colores con luminosidad HSL mayor que 0,94 (`isThemeColorTooBright`, la media del canal más alto y el más bajo): `--surface` da 0,98 y la barra se quedaba blanca. `--bg` da 0,937, justo en el límite, y el test lo comprueba.
  - En modo oscuro, Chrome no usa el color de la página en una pestaña normal, sólo en apps web instaladas (`shouldAllowThemingInNightMode`). Safari 26 sólo lo usa en la app instalada: en una pestaña tiñe con el fondo de la página, que es el mismo `--bg`.
  - Con `viewport-fit=cover`, la página llega hasta el borde de abajo: en Android 135+ con gestos no sale la barra de Chrome sobre la de gestos, y la franja enseña el fondo de la página.
  - Un elemento fijo nuevo pegado a un borde (un aviso abajo, una barra) tiene que hacer lo mismo.

#### App web instalable

- **App web instalable** (`/manifest.webmanifest`, `src/lib/manifest.ts`):
  - Un manifest no distingue claro y oscuro: Blink no lee colores oscuros del manifest, `color_scheme_dark` sigue en propuesta y los campos `dark_theme_color`/`dark_background_color` de Chrome son de un experimento abandonado. Por eso:
    - **`background_color` es el nogal (`--walnut`, `WALNUT` en `manifest.ts`).** En la app instalada es el fondo de la pantalla de arranque y la franja que asoma bajo la barra de gestos. Con el `--bg` claro, en modo oscuro quedaba una franja crema, y sin `background_color` Chrome pone `#F8F9FA` (`webapp_default_bg`, sin variante oscura). El nogal de la marca no se funde con la página en ningún modo, pero no desentona en ninguno. Un test lo compara con el token;
    - **no lleva `theme_color`, a propósito:** Chrome puede pintar con él la barra de abajo (`WebappIntentDataProvider.getNavigationBarColor`), con el mismo problema de un solo color. Quitarlo (#10) no cambió nada a la vista mientras `background_color` fue el claro. Un test lo comprueba;
    - la barra de arriba la da la meta `theme-color` de cada tema, que Chrome sí usa en oscuro en una app instalada.
  - Chrome guarda los colores del manifest al instalar y tarda días en actualizarlos: para probar un cambio, desinstalar y volver a instalar.
  - El manifest no fija caché propia: va con la del middleware, que revalida siempre. Con una hora de caché, al reinstalar justo después de desplegar, Chrome seguía usando el manifest viejo.
  - Se comprueba con CDP: `Page.getAppManifest` y `Page.getInstallabilityErrors`.
  - Ni Chromium de escritorio ni Playwright los simulan solos: se comprueban con `Emulation.setSafeAreaInsetsOverride` de CDP, y en un móvil de verdad.

#### Contraste

- Contraste: 4,5:1 para texto y 3:1 para bordes de campos y partes de gráficos (WCAG 2.2 AA), en claro y en oscuro. También los placeholders, en `--text-muted`: el gris del navegador quedaba a 3,7:1 en oscuro.

#### Barras de desplazamiento

- **Barras de desplazamiento:** `scrollbar-color` en `:root`, que se hereda: el pulgar en `--border-strong` (3:1 o más sobre `--bg` y `--surface`, en claro y en oscuro) y el carril transparente. Lo de dentro de `body`, con `scrollbar-width: thin`; la barra de la página conserva su ancho. Nada de `::-webkit-scrollbar`: Chrome lo ignora donde hay `scrollbar-color`. Sólo se ven con barras clásicas (Windows, Linux); las superpuestas (macOS, móviles) pintan sólo el pulgar, al desplazar.

#### Enlaces

- **Enlaces:** subrayado fino y tenue (el 40 % de su color), entero al pasar o enfocar. No se quita en ninguna parte: el acento frente al texto da 1,9:1 en claro y 1,5:1 en oscuro, y el color solo no basta (WCAG 1.4.1). En un titular (los nombres del h1 de la partida) el enlace va en el color del texto, con el mismo subrayado, y en el acento al pasar por encima: en acento, era lo que más pesaba de la página.

#### Tablas

- **Tablas:** cabecera sin fondo, con la raya en `--border-strong`. El fondo `--surface-muted` es sólo para las filas de grupo (`.group-row`: un torneo en «Se juegan pronto», un color en las aperturas de la ficha). Al pasar por encima sólo se marcan las filas que son un enlace (GamesTable). Una celda sin dato se deja vacía: `td:empty` pinta la raya en gris.
  - Una tabla que se apila con un container query (GamesTable, Emparejamientos, las aperturas de la ficha) pasa a columnas sólo donde le cabe lo que piden como mínimo, medido con su contenido real (la tabla a `width: min-content`). GamesTable pide de 835 a 878 px y se pone en paralelo desde 60rem.
  - En el móvil ninguna tabla esconde tras un scroll horizontal el dato que decide. Los listados de más de 3–4 columnas sin estructura propia (la búsqueda de jugadores, los torneos de la ficha, `/torneos`) llevan `.table-wrap.stack`:
    - por debajo de 60rem, cada fila es un bloque con la primera celda a todo el ancho y las demás debajo, en pequeño;
    - cada cifra lleva su rótulo (`<span class="cell-label" aria-hidden="true">`), sólo en las celdas con dato, para que `td:empty` siga pintando la raya;
    - en paralelo piden de 725 a 958 px. Los 958 son los torneos de la ficha, a 2 px de los 60rem.
  - Las tablas cortas se compactan en vez de apilarse (el ranking y los participantes del torneo): el nombre parte línea y el relleno se estrecha bajo 26rem.
    - Los participantes, además, se apilan por debajo de 17,5rem de tabla (pantallas de menos de unos 314 px; 375 con la letra a partir del 120 %): ni sin el FIDE ID caben el número, el nombre, la federación y el ELO, que piden de 190 a 279 px (30 torneos, 24-oct-2026). Las plantillas de cada equipo, también.
  - La clasificación del torneo también, con los desempates detrás del scroll. Bajo 30rem el nombre pide `min(10rem, 45cqi)`: sin eso, con cinco desempates, se quedaba en unos 90 px a 375. Medido en cuatro torneos de 250 a 700 px, no desborda donde antes cabía.
  - **El explorador del repertorio,** por debajo de 19.5rem de ventana, pone cada jugada en dos líneas: arriba la jugada y sus partidas, y debajo la barra a lo ancho. «Resultado» queda sólo para los lectores de pantalla (decidido con Jorge el 25-oct-2026, sobre maquetas).
    - A 250 px, la tabla pedía de 224 a 246 px en una tarjeta de 184, y la puntuación quedaba tras el scroll.
    - Va con media query: con `container-type`, la tarjeta dejaba de aportar el mínimo de la tabla a la columna lateral, y a 960 px la tabla se desplazaba 36 px.
  - **Indicio de scroll:** una `.table-wrap` que se desplaza enseña una sombra (`--border-strong`, 3:1) en el borde por el que queda tabla. Son sombras fijas y, encima, tapas del color de la superficie con `background-attachment: local`, que Safari hace bien desde la 15.4. Va debajo de las celdas: una con fondo (la fila de un grupo) la tapa. Las tablas que se desplazan dentro de una `.card` (el explorador del repertorio) no la llevan.
  - Una regla de página con `@container` sobre `.data-table` debe ir acotada a su tabla. La del ranking, sin acotar, se aplicaba también a la búsqueda en cuanto ésta pasó a ser contenedor.
  - El número de la partida en su ronda es la **mesa** («ronda 3, mesa 12»), no «tablero» ni «m.». «Tablero» queda para el puesto dentro de un equipo (las plantillas).
    - En la lista apilada de `GamesTable`, la ronda lleva su rótulo («ronda 5 · mesa 4», `.cell-label` con `aria-hidden`).
    - El enlace de cada fila de `GamesTable` lleva delante del resultado «Ver la partida», oculto a la vista (`.visually-hidden`): sin él, el lector de pantalla listaba 50 enlaces «1-0». Por eso ya no lleva `title`.

#### Iconos

- **Iconos** (`Icon.astro`, trazos de 24×24 en un mapa): sólo para acciones de significado universal (buscar, navegar, girar, descargar, copiar), que se repiten o que van donde falta sitio. Siempre con texto visible, salvo en los botones cuadrados (`.button.secondary.square`) con `aria-label` y `title`: los controles del visor, la paginación y la lupa. Nunca de adorno; tampoco para «preparar», los ritmos ni los resultados. Descargar es siempre «Descargar PGN», con un calificativo en gris si cambia lo que te llevas («· selección»). La excepción son las líneas del dossier: un enlace pequeño, «PGN» con el icono, que para el lector es «Descargar PGN de esta línea». Va seis veces por dossier, junto a «Explorar», y un botón pesaría demasiado (25-oct-2026).

### `public/favicon.svg`

- `public/favicon.svg`: el logo «!?» con los colores escritos, la misma figura que `Logo.astro`. `scripts/iconos.mjs` (con resvg) saca de él `favicon.ico`, `apple-touch-icon.png` y los iconos del manifest; hay que volver a ejecutarlo si cambia.
  - Los del manifest son `icono-192.png`, `icono-512.png` e `icono-maskable-512.png`. El maskable va a sangre, con el «!?» al 80 %, dentro de la zona segura de Android: el círculo central de radio 0,4 del lado. Medido: el glifo llega a 170,6 px del centro, y la zona segura, a 204,8.
  - También la tarjeta para compartir, `src/assets/compartir.png`: la losa y el nombre apilados en el centro (algunas apps recortan a un cuadrado), sobre arce claro y con una franja de casillas de arce y nogal. Los colores salen de los tokens de `global.css`. resvg no lee WOFF2, así que el nombre va en trazos en `scripts/nombre-marca.svg`, que saca `scripts/nombre-marca.py` (fonttools, brotli y uharfbuzz) de la fuente de los titulares, con su interletraje.
  - Componente sólo cuando se repite estructura o lógica: `Segmented.astro` (selector con enlaces de color, periodo, ritmo, ronda del torneo y pestañas de `/torneos`; las de periodo y ritmo están en `src/lib/options.ts`; con `showLabel`, el rótulo encima, como un campo. Cada opción mide al menos 2,5rem de ancho: las rondas medían 23,6 px en el móvil, y con 8 o más parten línea. Un filtro es `role="group"`, y sólo las pestañas de `/torneos` son un `nav` (`navigation`): con un `nav` por selector, el repertorio tenía siete zonas de navegación), `Icon.astro`, `RitmoSelect.astro`, `FiltrosPlegables.astro` (los filtros del dossier y del repertorio y, con `label="Búsqueda"`, el formulario de `/partidas` y `/torneos` tras buscar: en el móvil, plegados en un `<details>` que resume lo elegido; desde 40rem, siempre a la vista con `::details-content`), `CabeceraJugador.astro`, `ProximasPartidas.astro`, `Emparejamientos.astro` (mesas de la próxima ronda del torneo y, agrupadas por torneo, las de «Se juegan pronto») y `TorneosJugador.astro` (los torneos de la ficha, a la vista y plegados).

## Comandos

### `medir.mjs`

- **`medir.mjs`** (25-oct-2026) usa `playwright-core`, fijado en la 1.60.0 porque es la de `chromium-1223`, el que ya está en la carpeta de navegadores de Playwright, que comparten otros proyectos. Dependabot no lo sube. Nunca `playwright install`: puede borrar de esa carpeta versiones que usan otros.

## Colaboración

### Repositorio público en GitHub

- **Repositorio público en GitHub** (`origin`, `SOURCE_CODE` en `src/lib/licenses.ts`, enlazado desde el pie y `/acerca`).

#### Capturas del README

- **Capturas del README** (`docs/capturas/`, 25-oct-2026): de producción, en WebP y en claro y oscuro, que el README elige con `<picture>` y `prefers-color-scheme`. Sólo enseñan GM de élite (la partida 53051, Anton Guijarro contra Gukesh, y el dossier de Anton, 2285525) y nombres de torneos: nunca a otros jugadores ni a posibles menores. El visor, a 1280×800 con el motor encendido; las del móvil, a 390×844. Las ocho pesan unos 480 KB.

## Fuentes de datos

### info64.org

- **info64.org** (FEDA): Django sin API.

#### Clasificación

- Clasificación: `/{slug}/standings`. El título dice tras qué ronda va («Standings after the round 5»); sin resultados, y en los de equipos aunque hayan terminado, sólo «Standings», y entonces todos tienen 0 puntos. La cabecera de cada desempate es su código de Vega, distinto según el torneo y el año (BH, BH/M1, APRO; en 2015, BucT, Cmlt; en equipos, MatPnt). Las columnas van por la cabecera, porque las clases se repiten (`playerstartrank` vale para el puesto, el número inicial y los puntos). No da las partidas jugadas: sólo el cuadro cruzado, de 680 KB con 100 jugadores. Las rondas del torneo salen de los enlaces del menú.

### Lista FIDE

- **Lista FIDE** (`players_list.zip`, unos 45 MB): se descomprime en streaming con fflate, porque el Worker tiene 128 MB de memoria. Se filtra ESP (unos 98.000 jugadores; más de la mitad de los que tienen ELO, inactivos).
  - Al cambiar de lista, el ELO estándar que había pasa a `rating_std_prev` («Los que más suben»). `rating_list` guarda el mes de la lista (`YYYY-MM`) de la que sale el ELO de cada jugador, y es el mes en que se importa: así un reintento o un `force` en el mismo mes no lo pisa (`upsertFidePlayers` en `repo.ts`). No vale el `Last-Modified`, porque FIDE regenera el fichero a mitad de mes sin cambiar los ELO. El comentario de la migración 0007, ya aplicada, aún habla del `Last-Modified`. La primera lista con ELO anterior es la de noviembre de 2026.

#### El filtro va sobre los bytes

- **El filtro va sobre los bytes** (`FideListParser`): sólo se decodifican las líneas ESP, una a una. Decodificado el texto entero, cada nombre era un trozo de la cadena del bloque descomprimido, sin copiar, y lo retenía: los jugadores ocupaban 317 MB (el TXT entero) en vez de 30, y el 21-oct-2026 un intento falló por memoria. El TXT es ASCII y con saltos LF, así que las columnas de la cabecera valen en bytes. Los lotes de `upsertFidePlayers` se generan de uno en uno (`jsonChunks`).

### lichess

- **lichess:** una petición cada vez; ante un 429, esperar al menos un minuto (`LICHESS_STEP`).
  - En `LICHESS_SYNC`, cada petición va en su paso y le sigue una pausa de 6 s (`LICHESS_PAUSE`). Desde Workers, a una petición cada uno o dos segundos, lichess respondía 429 tras unas quince seguidas: la primera tanda de la carga inicial (150 torneos) recibió 43 y tardó 2 h.
  - Oficiales con españoles (`LICHESS_SYNC`), aunque info64 no las enlace. En la medición de abril a septiembre de 2026 eran unas 1.280 partidas nuevas al mes; el 97 % trae `%clk`.

#### Con un token de lichess de sólo lectura

- **Con un token de lichess de sólo lectura** (secreto `LICHESS_TOKEN`, sólo `study:read`, en `Authorization: Bearer`; `lichessHeaders` en `lichess/api.ts`). Sale de la cuenta personal de quien opera producción, no de una del proyecto: las condiciones de lichess no permiten más de una cuenta por persona, salvo excepciones a su criterio. La API de retransmisiones limita mucho las peticiones anónimas y anuncia que dejará de responderlas ([lila#21283](https://github.com/lichess-org/lila/pull/21283)); con token, 120 peticiones JSON por minuto. Sólo va a lichess. Vacío en `.dev.vars`, se pide como anónimo. Está en `secrets.required`: `wrangler deploy` no despliega si falta en el Worker.

#### Datos del torneo por una de sus rondas

- **Datos del torneo por una de sus rondas** (`GET /api/broadcast/-/-/{idRonda}`, `fetchRound`): da lo mismo que `GET /api/broadcast/{id}` salvo las demás rondas. El del torneo daba un 429 cada tres minutos incluso a esa pausa: 59 en la segunda tanda, que tardó 3 h. El listado y la carga inicial ya traen una ronda de cada torneo. El endpoint del torneo queda para los demás torneos de un grupo y para `tours`.

#### Licencia CC BY-SA 4.0

- **Licencia CC BY-SA 4.0** (database.lichess.org): hay que citar la fuente y la licencia (pie, `/acerca`, torneo y partida, con `CC_BY_SA` de `src/lib/licenses.ts`). Lo derivado se ofrece con la misma licencia.
  - Una partida es de lichess si sus cabeceras `GameURL`, `Site` o `BroadcastURL` llevan una dirección de lichess (`lichessUrl`), no por el torneo: las descargas no leen más filas, y también se encuentran las de info64 que son una exportación de lichess (el CE Absoluto 2025, con su análisis). Lo mismo decide el crédito de debajo de la partida: en esas de info64, «retransmisión de lichess publicada en info64 (FEDA)». Comprobado el 24-oct-2026: ninguna partida de un torneo con `games_source = 'lichess'` va sin esas cabeceras.
  - **La página del torneo** no lee los PGN: lo decide por `games_source` y, en los de info64, por `tournaments.lichess_games` (migración 0016), cuántas de sus partidas guardadas son de lichess según `lichessUrl`. Con todas, «Sus partidas son de una retransmisión de lichess publicada en info64 (FEDA)»; con algunas, «N de sus M partidas…».
    - Medido el 24-oct-2026 en la D1 remota: 22 torneos de info64 con 2.574 partidas de lichess, 15 enteros (los CE Absolutos 2024 y 2025, el Iberoamericano…) y 7 en parte (el Memorial Pedro Lezcano 2026, 104 de 492).

### Archivo de la Federación Cántabra de Ajedrez (FCA)

- **Archivo de la Federación Cántabra de Ajedrez (FCA)** (`src/ingest/fca/`, `FCA_IMPORT`; decidido con Jorge el 24-oct-2026): https://www.fcajedrez.es/partidas/, PGN estáticos de la Liga Regional y los campeonatos regionales de 2007 a 2010, de 2012 y de 2021, sin cambios desde abril de 2024. Ninguno de sus torneos estaba en info64.

#### Menores

- **Menores:** los archivos de Sub 12 y Sub 14 no se piden, y de los demás se saltan los torneos de menores por el nombre (`isMinorsTournament`). Quedan 2.683 partidas en 46 torneos. Dos de 2021 vienen sin fecha y no salen en el listado de `/torneos`.

#### Sin FIDE ID

- **Sin FIDE ID** (`FideMatcher`, `fca/jugadores.ts`): cada nombre se cruza con la lista FIDE española.
  - Los apellidos y el nombre de pila del archivo tienen que ser el principio de los de la lista: «Mora, Jesus» → «Mora Gutiérrez, Jesús María».
  - Medido en local: 884 partidas con los dos jugadores enlazados, 1.343 con uno y 456 sin ninguno; 229 jugadores de la lista.

## Trampas conocidas

### Fila entera como enlace (`GamesTable`)

- **Fila entera como enlace (`GamesTable`):** el enlace del resultado se estira sobre la fila con un `::after`. No vale `position: relative` en un `<tr>` de tabla: Safari no lo trata como bloque contenedor hasta la 27 (WebKit 240961), y la capa de cada fila taparía la tabla entera. Por eso las filas son rejillas: con áreas en el móvil y con subgrid en la tabla ancha, todo bajo `@supports (grid-template-columns: subgrid)`. Con `display: grid` la tabla conserva sus roles: compruébalo con el `ariaSnapshot` de Playwright, no con un árbol aplanado. Por debajo de 60rem la cabecera queda sólo para los lectores de pantalla (oculta como `.visually-hidden`).
  - El explorador del repertorio hace lo mismo con la jugada de cada fila (25-oct-2026): con áreas por debajo de 19.5rem y con subgrid por encima, sobre columnas `auto`, así que la columna lateral no cambia. La tabla va a plomo con el título de la tarjeta, así que el fondo al pasar y el anillo del foco van en un `::before` de la fila que sobresale `--space-2` por los lados. La capa tapa la barra de resultados: su desglose («5 ganadas, 3 tablas, 4 perdidas», `formatResults`) va también en el `title` del enlace.

### Partidas repetidas en info64

- **Partidas repetidas en info64:** a veces publica el PGN entero dos veces (Xàbia 2026, CE Absoluto 2024), o la misma partida con y sin relojes o resultado, cortada a las pocas jugadas o sin jugadas. `uniqueGames()` junta las copias con la misma ronda y jugadores cuando la línea de una es el principio de la de la otra: se queda la de más jugadas y, si no tiene resultado, toma el de la otra. Una partida sin terminar (`*`) con otras jugadas, junto a una terminada de los mismos jugadores en la misma ronda, se descarta: es una grabación fallida o un tablero mal asignado. `seq > 0` queda para partidas distintas con la misma ronda.tablero (encuentros por equipos, desempates).

### D1 cobra por filas recorridas

- **D1 cobra por filas recorridas:** evita `count(*)` y `ORDER BY` sin índice en páginas con tráfico. Los totales de la portada están en `site_totals` y se recalculan al final de cada sincronización.
  - Cuenta las entradas de índice recorridas, no las lecturas de la fila por rowid: medido en producción, 228 partidas por `games_white` son 229 filas, se pidan las columnas que se pidan. Un índice cubriente no abarata nada.
  - Ordenar sin índice vuelve a contar cada fila, aunque haya `LIMIT`, y una función de ventana, otras dos más. Medido el 21-oct-2026 con las 872 partidas de una semana por `games_date`: 872 filas leerlas, 1.731 con `ORDER BY … LIMIT 10` y 3.471 con `ROW_NUMBER() OVER (PARTITION BY tournament_id …)`. Para elegir unas pocas de unos cientos, mejor leerlas sin ordenar y elegir en TS.
  - Si una consulta hay que ordenarla, una columna con subconsulta (un recuento) se calcula para cada fila que casa, antes del `LIMIT`. Hay que elegir primero la página de id y calcularla sólo para ella. En `searchTournaments` (25-oct-2026), la lista de «madrid» pasó así de 72.310 filas a 5.146.

#### Búsquedas

- **Búsquedas** (`searchGames`, `searchPlayers`, `findPlayersByName`; 22-oct-2026):
  - las búsquedas, con tope: el recuento para en 1.001 filas (`countSql`) y las páginas en la 20 (`SEARCH_PAGES`, `searchPage`); por encima, «más de 1000». Si el nombre es el único filtro, se cuenta en el FTS. La ficha (`searchGames` con un jugador, también con un torneo o una lista) no lleva tope: su recuento va por su índice y es barato, así que da el total exacto y todas sus páginas. `pageParam` no pone tope, ni tampoco los torneos;
  - con el nombre o el ECO, el recuento va primero y decide si recorrer el índice del orden (`games_date`, `players_rating_std`) con `INDEXED BY` (`countAndPlan`, `walkOrderIndex`). Con muchas coincidencias se recorre en las 20 páginas. Con un apellido raro, recorrerlo leería la tabla entera. Con el recuento en el tope, en una página honda se cuenta hasta √(necesarias × filas de la tabla) para decidir: «santos» (1.263 partidas) lee en la página 20 6.315 filas ordenándolas y 105.076 recorriendo `games_date`. Con `LIMIT 5000` SQLite prefería ordenar la tabla, así que con sólo fechas se recorre siempre;
  - medido en la D1 remota, en la página 1 y en la 20: `/partidas?desde=1000-01-01`, 1.738 y 4.372 (antes del tope, 529.752 en cualquiera); `?eco=B`, 4.034 y 17.243; «garcia», 21.190 y 42.494; `/jugadores?q=garcia`, 12.241 y 43.918; `?sexo=F`, 22.840;
  - el título y el sexo van por su índice (`players_title`, parcial, y `players_sex`, migración 0009), en el orden de `PLAYER_ORDER`: el listado para al llenar la página y el recuento cuenta sólo los suyos. `/jugadores?titulo=GM` leía 103.538 filas en remoto (el recuento recorría la tabla); con 98.000 jugadores sembrados, de 98.106 a 111;
  - sin `sqlite_stat1`, el planificador cree que `players_sex` filtra mucho, aunque son dos valores. En «Los que más suben» femenino lo prefería a `players_rating_gain` y ordenaba a todas las jugadoras (de 206 filas a 11.885): allí el sexo va con `+p.sex`, que no usa índice. Con nombre y `sexo=M`, el recuento va por `players_sex` y lee un 15 % más (63.042 → 72.678 en local); con `sexo=F`, la mitad (149.710 → 70.798). Se acepta;
  - la importación FIDE escribe una entrada más por jugador en `players_sex`: de 294.141 filas escritas a 393.198, el 0,8 % de los 50 M incluidos al mes.

#### Descargas PGN

- **Descargas PGN** en dos fases: los id por índice (`exportGameIds`) y los PGN de 500 en 500 (`gamesPgn`), enviados en trozos (`pgnResponse`). La de una búsqueda lleva las mismas que enseña, como mucho 1.000 (`exportLimit`); la de un jugador, un torneo o el repertorio, hasta 5.000. La segunda fase suma dos filas por partida, a cambio de la memoria constante. Medido: la de `?desde=1000-01-01` (5.000) leía unas 400.000 filas y juntaba 20,7 MB en memoria, y ahora (1.000) unas 4.200; la de «garcia», de 62.300 a unas 43.500.

#### Sitemap

- **Sitemap** (22-oct-2026, en remoto): el índice lee 3 filas (`max(id)` por la clave primaria y `site_totals`). Los trozos de partidas leen una fila por id del rango (48.601, 49.113 y 34.726) y el de torneos, 12.528. Desde que sólo entran los torneos con partidas o al menos dos jugadores (24-oct-2026), el de torneos lee 23.365 por 8.803 torneos: además de su fila, hasta dos entradas de participantes en cada uno de los 7.322 sin partidas. Los de jugadores leen las filas que salta `OFFSET` más una por ficha que entra: 69.829 y 119.968. Un `EXISTS` que no encuentra nada no suma. Sin los posibles menores (23-oct-2026) leen menos, porque con su año, que está en la misma fila, ya no se buscan sus torneos ni sus partidas: en local, con 98.000 jugadores sembrados, de 80.000 a 72.500 y de 126.800 a 119.600. El recorrido completo son unas 335.000 filas: leído a diario, el 0,04 % de lo incluido al mes. `max` y `min` en la misma consulta recorren la tabla: van por separado.

#### Límite de ritmo

- **Límite de ritmo** (`src/middleware.ts`, binding `RATE_LIMITER`): 30 peticiones caras por minuto y por IP (búsquedas, PGN, dossier, repertorio y los trozos del sitemap que salen de D1; nunca fichas, partidas, torneos ni `/api`), con la página 429 y `Retry-After`. En local, `RATE_LIMIT=on` en `.dev.vars`. `robots.txt` aparta además `/partidas?`, `/jugadores?` y `/torneos?`.
  - **Apagado en producción a propósito** (`"RATE_LIMIT": "off"` en `wrangler.jsonc`; decidido el 22-oct-2026). Va por IP, y la documentación de Cloudflare lo desaconseja porque muchos usuarios comparten la suya: la wifi de una sala de juego o de un club, los datos del móvil. Con 30 por minuto, una sala con muchos jugadores preparando la ronda se bloquearía, y el repertorio hace una petición por jugada. El coste ya lo acotan los topes de las búsquedas. Cuándo encenderlo está en la guía de operación.
