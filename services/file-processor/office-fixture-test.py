"""Actual Linux converter checks, with authored synthetic documents only.

Print fixed format/stage names and elapsed numbers, never native stderr, text,
source paths, IDs or parser messages. Each unit gets a fresh request directory.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET

FIXTURES = Path("/document-fixtures")
CASES = {
    "docx": "office-two-pages.docx", "doc": "office-two-pages.doc",
    "xlsx": "office-two-sheets.xlsx", "xls": "office-two-sheets.xls",
    "pptx": "office-two-slides.pptx", "ppt": "office-two-slides.ppt",
    "hwp": "synthetic-two-page.hwp", "hwpx": "synthetic-two-page.hwpx",
    "txt": "utf8-two-pages.txt",
}
selected = sys.argv[1:] or list(CASES)
assert selected and all(fmt in CASES for fmt in selected)


def execute(source, mode, unit=0, expect_success=True, definitive=False):
    with tempfile.TemporaryDirectory(prefix="baro-office-fixture-") as temporary:
        root = Path(temporary)
        shutil.copyfile(source, root / "input")
        original = hashlib.sha256((root / "input").read_bytes()).digest()
        started = time.monotonic()
        result = subprocess.run(["python3", "/app/processor.py", str(root), mode, str(unit)],
                                capture_output=True, timeout=150)
        elapsed = round((time.monotonic() - started) * 1000)
        assert not result.stdout and not result.stderr, "Native output must stay private"
        assert hashlib.sha256((root / "input").read_bytes()).digest() == original
        if not expect_success:
            assert result.returncode != 0 and not (root / "manifest.json").exists()
            failure = json.loads((root / "error.json").read_text())
            code = failure["code"]
            assert code in {"UNSUPPORTED_FORMAT", "INVALID_MEDIA", "LIMIT", "OUTPUT_LIMIT"}
            if definitive:
                assert failure == {"code": code, "rejection": "office_input"}
            return None, "", elapsed
        code = json.loads((root / "error.json").read_text())["code"] if (root / "error.json").exists() else None
        assert result.returncode == 0, {"mode": mode, "unit": unit, "nativeCode": code}
        manifest = json.loads((root / "manifest.json").read_text())
        text = ""
        for artifact in manifest.get("artifacts", []):
            content = (root / artifact["path"]).read_bytes()
            assert len(content) == artifact["byteLength"] <= 1_048_576
            assert hashlib.sha256(content).hexdigest() == artifact["contentHash"]
            assert artifact["position"]["page"] == unit + 1
            assert artifact["kind"] == "extracted_text"
            text += content.decode("utf-8")
        return manifest, text, elapsed


for fmt in selected:
    source = FIXTURES / CASES[fmt]
    assert source.is_file(), {"format": fmt, "fixturePresent": False}
    manifest, _, probe_ms = execute(source, "probe")
    assert manifest["probe"] == {"category": "document", "format": fmt,
                                  "byteLength": source.stat().st_size, "pageCount": 2}
    durations = []
    for unit in range(2):
        result, text, elapsed = execute(source, "process", unit)
        assert result["unit"] == unit and result["totalUnits"] == 2
        assert result["coverage"]["pageCount"] == 2
        assert result["coverage"]["pages"] == [{"page": unit + 1, "status": "processed"}]
        assert ("BLUEBOX17" if unit == 0 else "END_NATIVE_DOCUMENT") in text
        assert ("합성 자료 첫째 쪽" if unit == 0 else "합성 자료 둘째 쪽") in text
        if fmt != "txt" and unit == 0:
            assert "합성 표" in text and "ORANGECIRCLE42" in text
        durations.append(elapsed)
    print(json.dumps({"format": fmt, "probeMs": probe_ms, "unitMs": durations,
                      "pages": 2, "result": "passed"}), flush=True)

# Reject active/protected/corrupt package content before LibreOffice starts.
# These mutations are made on our own DOCX, never on an external document.
if "docx" in selected:
    with tempfile.TemporaryDirectory(prefix="baro-rejected-office-") as temporary:
        root = Path(temporary)
        original = FIXTURES / CASES["docx"]
        for name, member, payload in (
            ("external", "word/_rels/document.xml.rels", b'<Relationships><Relationship TargetMode="External" Target="https://example.invalid/blocked"/></Relationships>'),
            ("macro", "word/vbaProject.bin", b"synthetic-not-a-macro"),
            ("entity", "word/document.xml", b'<!DOCTYPE d [<!ENTITY x SYSTEM "file:///blocked">]><d>&x;</d>'),
            ("protected", "word/settings.xml", b'<settings><documentProtection enforcement="1"/></settings>'),
        ):
            target = root / name
            with zipfile.ZipFile(original) as archive, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
                for entry in archive.infolist():
                    if entry.filename != member:
                        output.writestr(entry.filename, archive.read(entry))
                output.writestr(member, payload)
            execute(target, "probe", expect_success=False)
        target = root / "truncated"
        target.write_bytes(original.read_bytes()[:150])
        execute(target, "probe", expect_success=False)
    print("Native Office unsafe/corrupt synthetic inputs: 5 PASS", flush=True)

    # The converter's resulting PDF determines page count. A ZIP page estimate
    # must not admit 501 pages or silently truncate a 500-page document.
    with tempfile.TemporaryDirectory(prefix="baro-office-pages-") as temporary:
        root = Path(temporary)
        with zipfile.ZipFile(FIXTURES / CASES["docx"]) as original:
            xml = ET.fromstring(original.read("word/document.xml"))
            namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            body = xml.find(namespace + "body")
            section = ET.tostring(body.find(namespace + "sectPr"))
            for count in [500, 501]:
                body.clear()
                for index in range(count):
                    paragraph = ET.SubElement(body, namespace + "p")
                    run = ET.SubElement(paragraph, namespace + "r")
                    if index:
                        ET.SubElement(run, namespace + "br", {namespace + "type": "page"})
                    ET.SubElement(run, namespace + "t").text = "SYNTHETIC PAGE"
                body.append(ET.fromstring(section))
                target = root / str(count)
                with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
                    for entry in original.infolist():
                        output.writestr(entry.filename, ET.tostring(xml) if entry.filename == "word/document.xml" else original.read(entry))
                result, _, elapsed = execute(target, "probe", expect_success=count == 500)
                if count == 500:
                    assert result["probe"]["pageCount"] == 500
                print(json.dumps({"format": "docx", "pages": count, "probeMs": elapsed,
                                  "result": "accepted" if count == 500 else "rejected"}), flush=True)

if "doc" in selected:
    execute(FIXTURES / "encrypted.docx", "probe", expect_success=False)
    print("Native encrypted OOXML rejection: 1 PASS", flush=True)
if "xls" in selected:
    execute(FIXTURES / "protected.xls", "probe", expect_success=False, definitive=True)
    print("Native protected legacy spreadsheet rejection: 1 PASS", flush=True)

print("Native document conversion checks passed (synthetic local codecs; not cloud/provider evidence)")
