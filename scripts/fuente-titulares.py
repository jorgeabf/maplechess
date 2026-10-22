"""
Genera src/assets/fonts/titulares-600.woff2 a partir de Source Serif 4 de
Adobe y calcula el ajuste de métricas de sus respaldos (los @font-face de
src/styles/global.css).

Necesita Python 3 con fonttools y brotli (pip install fonttools brotli) y la
fuente variable de la versión publicada (source-serif-4.005_Desktop.zip,
VAR/SourceSerif4Variable-Roman.ttf, en github.com/adobe-fonts/source-serif):

    python scripts/fuente-titulares.py SourceSerif4Variable-Roman.ttf [respaldo.ttf ...]

Los respaldos son las negritas del sistema que se ven mientras se descarga la
fuente (C:/Windows/Fonts/georgiab.ttf; NotoSerif[wdth,wght].ttf de Google
Fonts, que se instancia a 700). Para cada uno imprime size-adjust y los
*-override. El ancho medio se mide sobre los titulares fijos y los nombres de
jugadores y torneos de la D1 local, si existe.
"""

import sqlite3
import sys
from collections import Counter
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "assets" / "fonts" / "titulares-600.woff2"
FAMILY = "Titulares"
# Peso 600 (--weight-strong), el único que usa la web en serif. Tamaño óptico
# 24: los titulares van de 14 px (fila de equipo) a 40 px (portada).
AXES = {"wght": 600, "opsz": 24}
# Latín básico, Latin-1 (español, catalán, gallego, euskera, portugués),
# comillas, rayas, viñeta, puntos suspensivos y euro. Igual que el
# unicode-range del @font-face.
UNICODES = "U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2022,U+2026,U+20AC"
FEATURES = ["kern", "liga", "locl", "ccmp", "mark", "mkmk", "tnum"]
HEADINGS = [
    "MapleChess", "¿Contra quién juegas?", "Últimos torneos con partidas",
    "Acerca de MapleChess", "De dónde salen los datos", "Software", "Datos personales", "Cookies",
    "Jugadores", "Partidas", "Torneos", "Resultados", "Aperturas más jugadas", "Próximas partidas",
    "Sus líneas principales con blancas", "Tú contra", "Cambios en el último año", "Resultados según el rival",
    "Apuros de tiempo", "Sus últimas partidas con negras", "Partidas que pasan por esta posición",
    "Juegan sus rivales", "No encontramos esa página", "Vuestras partidas", "Nuevas", "Las ha dejado",
]
NUMBERS = ["2712", "2650", "2598", "1987", "97.987", "1.802", "15", "2345", "1876", "2103"]


def build(source: Path) -> None:
    font = instantiateVariableFont(TTFont(source), AXES, updateFontNames=False)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = FEATURES
    opts.name_IDs = [0, 5, 13, 14]  # copyright, versión y licencia; el resto se reescribe
    opts.name_languages = [0x409]
    opts.hinting = False
    opts.notdef_outline = True
    opts.drop_tables += ["STAT"]  # sin ejes tras instanciar
    subsetter = subset.Subsetter(opts)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)

    # La licencia (OFL 1.1, condición 3) reserva el nombre «Source» a la
    # original: una versión modificada no puede presentarse con él.
    version = font["head"].fontRevision
    for name_id, value in {
        1: f"{FAMILY} SemiBold",
        2: "Regular",
        3: f"{version:.3f};{FAMILY}-SemiBold",
        4: f"{FAMILY} SemiBold",
        6: f"{FAMILY}-SemiBold",
        16: FAMILY,
        17: "SemiBold",
    }.items():
        font["name"].setName(value, name_id, 3, 1, 0x409)
    font.flavor = "woff2"
    font.save(OUT)
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.1f} KB, {len(font.getGlyphOrder())} glifos")


def corpus() -> Counter:
    text = HEADINGS * 20 + NUMBERS * 20
    for db_path in (ROOT / ".wrangler" / "state" / "v3" / "d1").glob("*/*.sqlite"):
        if db_path.name == "metadata.sqlite":
            continue
        db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        text += [r[0] for r in db.execute("select name from players")]
        text += [r[0] for r in db.execute("select name from tournaments")]
    return Counter("".join(text))


def average_width(font: TTFont, chars: Counter) -> float:
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    total = count = 0
    for char, n in chars.items():
        glyph = cmap.get(ord(char))
        if glyph is not None:
            total += font["hmtx"][glyph][0] / upm * n
            count += n
    return total / count


def overrides(fallbacks: list[str]) -> None:
    web = TTFont(OUT)
    upm = web["head"].unitsPerEm
    hhea = web["hhea"]
    ascent, descent, line_gap = hhea.ascent / upm, -hhea.descent / upm, hhea.lineGap / upm
    chars = corpus()
    width = average_width(web, chars)
    for path in fallbacks:
        font = TTFont(path)
        if "fvar" in font:
            font = instantiateVariableFont(font, {"wght": 700, "wdth": 100}, updateFontNames=False)
        # size-adjust también escala los *-override: por eso se dividen por él.
        adjust = width / average_width(font, chars)
        print(f"\n{Path(path).name}")
        print(f"\tsize-adjust: {adjust * 100:.2f}%;")
        print(f"\tascent-override: {ascent / adjust * 100:.2f}%;")
        print(f"\tdescent-override: {descent / adjust * 100:.2f}%;")
        print(f"\tline-gap-override: {line_gap / adjust * 100:.2f}%;")


if __name__ == "__main__":
    build(Path(sys.argv[1]))
    overrides(sys.argv[2:])
