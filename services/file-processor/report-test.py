"""Actual offline WeasyPrint output from the application HTML template."""
import io
import re
import subprocess
import tempfile
import hashlib
import time
import urllib.request
import urllib.error
from pathlib import Path
from PIL import Image
from report import render, resource
from weasyprint import HTML
from weasyprint.formatting_structure.boxes import TextBox

root = Path("/report-fixture")
source = (root / "report.html").read_text(encoding="utf-8")
output = root / "report.pdf"
document = HTML(string=source, url_fetcher=resource).render()
for page in document.pages:
    for box in page._page_box.descendants():
        if isinstance(box, TextBox):
            assert box.position_x + box.width <= page.width - 55, (box.text, box.position_x, box.width, page.width)
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


# Exercise the real private HTTP ingress/hash/subprocess/PDF/cleanup path too.
server = subprocess.Popen(["node", "/app/server.mjs"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for attempt in range(100):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8080/ready", timeout=1) as ready:
                assert ready.status == 200
            break
        except OSError:
            time.sleep(0.05)
    else:
        raise AssertionError("private server did not start")
    body = source.encode("utf-8")
    headers = {"x-baro-capability": "a" * 64, "x-baro-bytes": str(len(body)), "x-baro-hash": hashlib.sha256(body).hexdigest()}
    request = urllib.request.Request("http://127.0.0.1:8080/report", data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.headers.get_content_type() == "application/pdf"
        received = response.read(24_000_001)
        assert received.startswith(b"%PDF-") and len(received) <= 24_000_000
    for attempt in range(100):
        if not list(Path("/tmp").glob("baro-job-*")):
            break
        time.sleep(0.05)
    else:
        raise AssertionError("private job material was not cleaned")
    for override in [{"x-baro-capability": "invalid"}, {"x-baro-bytes": "20000001"}]:
        request = urllib.request.Request("http://127.0.0.1:8080/report", data=b"x", headers={**headers, **override}, method="POST")
        try:
            urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            assert error.code == 400
        else:
            raise AssertionError("invalid private request accepted")
    print("Private HTTP HTML -> native subprocess -> PDF and material cleanup passed.")
finally:
    server.terminate()
    server.wait(timeout=5)
