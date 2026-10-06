"""Build the local PDF font from the vendored OFL font; no network or new license.
Requires fonttools==4.66.1 and brotli==1.2.0. Run from repository root.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont("public/fonts/PretendardVariable.woff2", recalcTimestamp=False)
font = instantiateVariableFont(font, {"wght": 400}, inplace=True)
font.flavor = None
# The OFL reserves Pretendard: use a distinct family for this static derivative.
for record in font["name"].names:
    names = {1: "Baro Report", 2: "Regular", 3: "Baro Report Regular 1.0",
             4: "Baro Report Regular", 6: "BaroReport-Regular", 16: "Baro Report", 17: "Regular"}
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.save("public/fonts/BaroReport-Regular.ttf", reorderTables=True)
assert Path("public/fonts/BaroReport-Regular.ttf").stat().st_size < 4_000_000
