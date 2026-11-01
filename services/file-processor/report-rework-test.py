"""Synthetic multi-page rework documents through the production PDF renderer.

Mount .wrangler/report-rework at /report-rework and this file beside report.py.
No network, model, legal API or real case material is involved.
"""
import re
import subprocess
from pathlib import Path

from report import render, resource
from weasyprint import HTML
from weasyprint.formatting_structure.boxes import TextBox

root = Path("/report-rework")
for name in ("claim", "response", "claim-masked", "response-masked"):
    source = (root / f"{name}.html").read_text(encoding="utf-8")
    document = HTML(string=source, url_fetcher=resource).render()
    assert 2 <= len(document.pages) <= 20
    for number, page in enumerate(document.pages, start=1):
        text_boxes = [
            box for box in page._page_box.descendants()
            if isinstance(box, TextBox) and box.text.strip()
        ]
        # All pages must contain actual body text beyond recurring page furniture.
        assert sum(len(box.text) for box in text_boxes) > 60, (name, number, "blank page")
        for box in text_boxes:
            assert box.position_x >= 45, (name, number, box.text, "left overflow")
            assert box.position_x + box.width <= page.width - 45, (name, number, box.text, "right overflow")
            assert box.position_y >= 20, (name, number, box.text, "top overflow")
            assert box.position_y + box.height <= page.height - 20, (name, number, box.text, "bottom overflow")
    output = root / f"{name}.pdf"
    output.write_bytes(render(source))
    text = subprocess.check_output(["pdftotext", "-layout", str(output), "-"]).decode("utf-8")
    compact = re.sub(r"\s+", "", text)
    for phrase in (
        "합성 조항 원문: 당사자가 합의한 반환 조건을 확인한다.",
        "합성 판례 원문: 송금 사실과 반환 약정의 존재는 구별하여 살핀다.",
        "반환 약정의 해석을 다투는 점이 같습니다.",
        "이 사건에서는 같은 자료를 확인하지 못했습니다.",
        "긴 조항 검증 35",
        "증거 1 · 1쪽",
        "출처와 분석 기준",
    ):
        assert re.sub(r"\s+", "", phrase) in compact, (name, phrase)
    assert ("인정하는사실과다투는사실" in compact) == name.startswith("response")
    images = subprocess.check_output(["pdfimages", "-list", str(output)]).decode("utf-8")
    photo_count = sum(" jpeg " in line for line in images.splitlines())
    assert photo_count >= 2 if "masked" not in name else photo_count == 0
    subprocess.run([
        "pdftoppm", "-scale-to", "1600", "-png", str(output), str(root / f"{name}-page")
    ], check=True)
    print(f"{name}: {len(document.pages)} pages; exact quotes, comparison, evidence, bounds and photos passed")
