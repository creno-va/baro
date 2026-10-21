"""Actual offline WeasyPrint output from the application HTML template."""
import io
import re
import subprocess
import tempfile
from pathlib import Path
from PIL import Image
from report import render, resource

root = Path("/report-fixture")
source = (root / "report.html").read_text(encoding="utf-8")
output = root / "report.pdf"
output.write_bytes(render(source))
text = subprocess.check_output(["pdftotext", "-layout", str(output), "-"]).decode("utf-8")
for phrase in ["사건 상담 준비", "촬영 날짜", "선택한 근거 사진", "자료 버전 3", "자료 버전 4", "합성 기록 25"]:
    assert phrase in text, phrase
images = subprocess.check_output(["pdfimages", "-list", str(output)]).decode("utf-8")
assert sum(" jpeg " in line for line in images.splitlines()) >= 2, images
info = subprocess.check_output(["pdfinfo", str(output)]).decode("utf-8")
assert re.search(r"^JavaScript:\s+no$", info, re.M)
assert 2 <= int(next(line.split(":")[1] for line in info.splitlines() if line.startswith("Pages:"))) <= 12
with tempfile.TemporaryDirectory() as temporary:
    masked = Path(temporary) / "masked.pdf"
    masked.write_bytes(render((root / "masked.html").read_text(encoding="utf-8")))
    masked_images = subprocess.check_output(["pdfimages", "-list", str(masked)]).decode("utf-8")
    assert not any(" jpeg " in line for line in masked_images.splitlines())
for url in ["file:///etc/passwd", "http://127.0.0.1/", "https://example.com/private", "data:image/png;base64,invalid", "data:text/html;base64,PGgxPmJhZDwvaDE+"]:
    try:
        resource(url)
    except Exception:
        pass
    else:
        raise AssertionError("resource accepted")
    try:
        render(source.replace("</main>", f'<img src="{url}"></main>'))
    except Exception:
        pass
    else:
        raise AssertionError("selected image silently omitted")
# Render every page for the same-SHA visual review artifact.
subprocess.run(["pdftoppm", "-scale-to", "1600", "-png", str(output), str(root / "report-page")], check=True)
print("Offline HTML/PDF: Korean text, selected images, masking, blocked resources and page rendering passed.")
