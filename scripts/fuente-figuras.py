"""
Genera src/assets/fonts/figuras.woff2, la fuente de la notación con figuras:
sólo cinco glifos, el rey, la dama, la torre, el alfil y el caballo, en las
mayúsculas K, Q, R, B y N. El @font-face «Figuras» de src/styles/global.css
la aplica sólo a esas letras (unicode-range), y sólo en los elementos que
muestran jugadas: se ve la figura y el texto sigue diciendo «Nf3», al copiar,
en el PGN y para los lectores de pantalla.

Necesita Python 3 con fonttools y brotli (pip install fonttools brotli). Las
figuras salen de los SVG que escribe el generador de las piezas, en
scripts/piezas/figuras/ si no se da otra carpeta:

    python scripts/fuente-figuras.py [carpeta]

Cada figura (K.svg, Q.svg, R.svg, B.svg y N.svg) va en las mismas unidades
que las otras cuatro, con el borde de abajo de su viewBox en la línea base, y
tiene uno o varios <path> sólo de relleno: sin trazos, sin contornos solapados
y con los huecos en sentido contrario al contorno que los rodea (regla
nonzero). El resto del viewBox no cuenta: el alto y el ancho salen de la tinta.

La fuente va en CFF, que guarda las curvas cúbicas del SVG tal cual. El
script falla si la woff2 llega a 4 KB: por debajo, Vite la incrusta en el CSS
como data: y las figuras salen desde el primer pintado; por encima, iría en un
archivo aparte y, hasta que llegara, se verían las letras.
"""

import io
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.roundingPen import RoundingPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.subset import parse_unicodes
from fontTools.svgLib.path import parse_path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "scripts" / "piezas" / "figuras"
OUT = ROOT / "src" / "assets" / "fonts" / "figuras.woff2"
FAMILY = "Figuras"
# B, K, N, Q y R, nada más: ni siquiera el espacio. Así la primera fuente
# disponible de la pila, la que da la altura de la línea, sigue siendo la de
# texto. Igual que el unicode-range del @font-face.
UNICODES = "U+0042,U+004B,U+004E,U+0051,U+0052"
UPM = 1000
# Alto de la figura más alta, en milésimas de em: algo más que las mayúsculas
# de las fuentes de texto (700 en Segoe UI, 670 en Titulares), como el rey en
# los libros. Lo que deja a cada lado, lo justo para que «Nf3» o «exf8=Q+» se
# lean como una palabra. Elegidos con Jorge el 24-oct-2026, sobre una lista
# de jugadas real, entre 700, 760 y 820 de alto con 30, 40 y 55 de margen: con
# 700, a 14 px las figuras se empastaban, y con 820 pesaban más que la jugada.
# Las demás miden HEIGHT por la raíz cuadrada de su alto entre el de la más
# alta, medidos en la tinta: guardan el orden de alturas del tablero con menos
# diferencia, y la torre, que con una escala común se quedaba en unos tres
# cuartos del rey, pasa a un 85 %. Elegido por Jorge el 24-oct-2026 entre esa
# escala común, ésta (la intermedia) y todas a HEIGHT.
HEIGHT = 760
SIDE = 40
# Altura sobre y bajo la línea base. No mueven nada: la altura de la línea la
# da la fuente de texto (ver UNICODES).
ASCENT = 800
DESCENT = 200
# Vite incrusta como data: los archivos de menos de 4096 bytes
# (build.assetsInlineLimit).
MAX_BYTES = 4096
# Fecha fija en la cabecera: la misma entrada da siempre el mismo archivo, y
# Vite le pone el mismo hash.
TIMESTAMP = timestampFromString("Sat Oct 24 00:00:00 2026")
SVG = "{http://www.w3.org/2000/svg}"


def read_svg(path: Path) -> tuple[RecordingPen, float]:
    """
    Los contornos de la figura en las unidades del SVG, con la y hacia abajo, y
    la línea base: el borde de abajo del viewBox (min-y más el alto).
    """
    root = ET.parse(path).getroot()
    # Cuatro números separados por espacios o comas, como dice SVG.
    try:
        _, min_y, width, height = map(float, re.split(r"[\s,]+", root.get("viewBox", "").strip()))
    except ValueError:
        sys.exit(f"{path.name}: el viewBox tiene que tener cuatro números")
    if width <= 0 or height <= 0:
        sys.exit(f"{path.name}: el ancho y el alto del viewBox tienen que ser positivos")
    for element in root.iter():
        if element.get("transform") is not None or element.get("stroke", "none") != "none":
            sys.exit(f"{path.name}: sólo rellenos, sin transform ni stroke")
    pen = RecordingPen()
    for element in root.iter(f"{SVG}path"):
        parse_path(element.get("d"), pen)
    return pen, min_y + height


def bounds(pen: RecordingPen) -> tuple[float, float, float, float]:
    bounds_pen = BoundsPen(None)
    pen.replay(bounds_pen)
    return bounds_pen.bounds


def to_font(pen: RecordingPen, baseline: float, scale: float, x_min: float) -> RecordingPen:
    """
    La figura en unidades de la fuente: la y hacia arriba, la línea base del
    SVG en la de la fuente y la tinta a SIDE del origen. Los contornos
    exteriores, en sentido antihorario, como pide CFF.
    """
    font_pen = RecordingPen()
    pen.replay(TransformPen(RoundingPen(font_pen), (scale, 0, 0, -scale, SIDE - x_min * scale, baseline * scale)))
    area = AreaPen()
    font_pen.replay(area)
    if area.value >= 0:
        return font_pen
    reversed_pen = RecordingPen()
    font_pen.replay(ReverseContourPen(reversed_pen))
    return reversed_pen


def build(source: Path) -> None:
    letters = [chr(code) for code in parse_unicodes(UNICODES)]
    figures = {letter: read_svg(source / f"{letter}.svg") for letter in letters}
    # Alto de la tinta de cada figura sobre la línea base, en unidades del SVG.
    heights = {letter: baseline - bounds(pen)[1] for letter, (pen, baseline) in figures.items()}
    tallest = max(heights.values())

    charstrings, metrics = {}, {}
    notdef = T2CharStringPen(UPM // 2, None)
    charstrings[".notdef"], metrics[".notdef"] = notdef.getCharString(), (UPM // 2, 0)
    for letter, (pen, baseline) in figures.items():
        # Una escala por figura, para que mida HEIGHT × √(su alto / el de la
        # más alta) (ver HEIGHT): la más alta, HEIGHT.
        scale = HEIGHT * (heights[letter] / tallest) ** 0.5 / heights[letter]
        x_min, _, x_max, _ = bounds(pen)
        glyph = to_font(pen, baseline, scale, x_min)
        advance = round((x_max - x_min) * scale) + 2 * SIDE
        t2 = T2CharStringPen(advance, None)
        glyph.replay(t2)
        charstrings[letter] = t2.getCharString()
        metrics[letter] = (advance, round(bounds(glyph)[0]))

    fb = FontBuilder(UPM, isTTF=False)
    fb.font.recalcTimestamp = False
    fb.updateHead(fontRevision=1.0, created=TIMESTAMP, modified=TIMESTAMP)
    fb.setupGlyphOrder([".notdef", *letters])
    fb.setupCharacterMap({ord(letter): letter for letter in letters})
    ps_name = f"{FAMILY}-Regular"
    fb.setupCFF(ps_name, {"FullName": FAMILY, "FamilyName": FAMILY}, charstrings, {})
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=-DESCENT)
    fb.setupOS2(
        sTypoAscender=ASCENT,
        sTypoDescender=-DESCENT,
        sTypoLineGap=0,
        usWinAscent=max(ASCENT, HEIGHT),
        usWinDescent=DESCENT,
        sCapHeight=HEIGHT,
        fsSelection=0x40,  # regular
        fsType=0,  # sin restricciones de incrustación
    )
    fb.setupNameTable(
        {
            "copyright": "© 2026 Oscar Arce y Jorge Arce",
            "familyName": FAMILY,
            "styleName": "Regular",
            "uniqueFontIdentifier": f"1.000;{ps_name}",
            "fullName": FAMILY,
            "version": "Version 1.000",
            "psName": ps_name,
            "licenseDescription": "GPL-3.0-or-later",
            "licenseInfoURL": "https://www.gnu.org/licenses/gpl-3.0.html",
        },
        mac=False,
    )
    fb.setupPost()
    fb.font.flavor = "woff2"

    data = io.BytesIO()
    fb.save(data)
    size = len(data.getvalue())
    if size >= MAX_BYTES:
        sys.exit(f"La woff2 ocupa {size} bytes: tiene que quedarse por debajo de {MAX_BYTES} para ir incrustada en el CSS")
    OUT.write_bytes(data.getvalue())
    widths = ", ".join(f"{letter} {metrics[letter][0]}" for letter in letters)
    print(f"{OUT.relative_to(ROOT)}: {size} bytes; avances: {widths}")


if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE)
