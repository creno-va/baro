"""Convert the existing OFL web font into a native TTF without changing its glyphs/axes.
Python>=3.10, fonttools==4.66.1, brotli==1.2.0. No network, dates or web-source writes.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path

import brotli
import fontTools
from fontTools.ttLib import TTFont

assert fontTools.version == "4.66.1" and brotli.__version__ == "1.2.0"
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/fonts/PretendardVariable.woff2"
LICENSE = ROOT / "public/fonts/OFL.txt"
OUTPUT = ROOT / "apps/mobile/assets/fonts"


def generate():
    font = TTFont(SOURCE, recalcTimestamp=False)
    original = font.getBestCmap().copy()
    glyph_order = font.getGlyphOrder().copy()
    # This format derivative uses a distinct family for the OFL Reserved Font Name.
    names = {1: "BaroMobile", 2: "Regular", 3: "BaroMobile Variable 1.0", 4: "BaroMobile",
             6: "BaroMobile-Regular", 13: LICENSE.read_text(), 16: "BaroMobile", 17: "Regular", 25: "BaroMobile"}
    instance_ids = {i.postscriptNameID for i in font["fvar"].instances}
    for record in font["name"].names:
        value = names.get(record.nameID)
        if value is None and record.nameID in instance_ids:
            value = record.toUnicode().replace("PretendardVariable", "BaroMobile")
        if value is not None:
            record.string = value.encode(record.getEncoding())
    font.flavor = None
    output = io.BytesIO()
    font.save(output, reorderTables=True)
    binary = output.getvalue()
    verified = TTFont(io.BytesIO(binary), recalcTimestamp=False)
    assert verified.getBestCmap() == original
    assert verified.getGlyphOrder() == glyph_order
    assert [i.coordinates for i in verified["fvar"].instances] == [i.coordinates for i in font["fvar"].instances]
    assert sum(c in original for c in range(0xAC00, 0xD7A4)) == 11172
    digest = lambda value: hashlib.sha256(value).hexdigest()
    manifest = {"version": 1, "family": "BaroMobile", "source": "public/fonts/PretendardVariable.woff2",
                "sourceSha256": digest(SOURCE.read_bytes()), "licenseSha256": digest(LICENSE.read_bytes()),
                "outputSha256": digest(binary), "glyphs": font["maxp"].numGlyphs, "codepoints": len(original), "hangul": 11172,
                "tools": {"fonttools": fontTools.version, "brotli": brotli.__version__}}
    return binary, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    binary, manifest = generate()
    files = {"BaroMobile.ttf": binary, "manifest.json": manifest, "OFL.txt": LICENSE.read_bytes()}
    if args.check:
        assert all((OUTPUT / name).read_bytes() == value for name, value in files.items()), "MOBILE_FONT_DRIFT"
    else:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        for name, value in files.items():
            (OUTPUT / name).write_bytes(value)
    print("Native TTF matches the existing OFL source glyphs/axes; web source unchanged")
