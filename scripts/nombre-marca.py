"""
Escribe «MapleChess» en trazos, con la fuente de los titulares, en
scripts/nombre-marca.svg. De ahí lo toma scripts/iconos.mjs para la tarjeta
que se ve al compartir un enlace (src/assets/compartir.png): resvg no lee
WOFF2, y así iconos.mjs no necesita la fuente.

Necesita Python 3 con fonttools, brotli y uharfbuzz
(pip install fonttools brotli uharfbuzz). Hay que volver a ejecutarlo si
cambia la fuente (scripts/fuente-titulares.py) o el nombre:

    python scripts/nombre-marca.py

El texto se compone con HarfBuzz, como en el navegador: con el interletraje
(kern) de la fuente. El SVG va en unidades de la fuente, con el viewBox
ajustado a la tinta.
"""

import io
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "src" / "assets" / "fonts" / "titulares-600.woff2"
OUT = ROOT / "scripts" / "nombre-marca.svg"
TEXT = "MapleChess"


def main() -> None:
    font = TTFont(FONT)
    # HarfBuzz no lee WOFF2: se le pasa la misma fuente sin comprimir.
    font.flavor = None
    ttf = io.BytesIO()
    font.save(ttf)

    hb_font = hb.Font(hb.Face(hb.Blob(ttf.getvalue())))
    buf = hb.Buffer()
    buf.add_str(TEXT)
    buf.guess_segment_properties()
    hb.shape(hb_font, buf, {"kern": True, "liga": True})

    glyphs = font.getGlyphSet()
    order = font.getGlyphOrder()
    path = SVGPathPen(glyphs)
    bounds = BoundsPen(glyphs)
    x = 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        # Coordenadas de la fuente con la y hacia arriba; en SVG va hacia abajo.
        transform = (1, 0, 0, -1, x + pos.x_offset, -pos.y_offset)
        glyph = glyphs[order[info.codepoint]]
        glyph.draw(TransformPen(path, transform))
        glyph.draw(TransformPen(bounds, transform))
        x += pos.x_advance

    x_min, y_min, x_max, y_max = bounds.bounds
    width, height = x_max - x_min, y_max - y_min
    OUT.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x_min} {y_min} {width} {height}">\n'
        f"\t<!-- «{TEXT}» en Titulares 600, generado por scripts/nombre-marca.py -->\n"
        f'\t<path d="{path.getCommands()}"/>\n'
        "</svg>\n",
        encoding="utf-8",
    )
    em = font["head"].unitsPerEm
    print(f"{OUT.relative_to(ROOT)}: {width} x {height} unidades (em = {em}), avance {x}")


if __name__ == "__main__":
    main()
