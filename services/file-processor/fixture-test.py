"""Runs inside the actual Linux image; source inputs are synthetic fixtures only.
No source text/hash/frame/audio is logged or copied to CI artifacts.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

FIXTURES = Path("/fixtures")
CASES = [("text-two-pages.pdf", "document", "pdf"), ("scan-image-only.pdf", "document", "pdf"),
         ("utf8-markers.txt", "document", "txt"), ("not-a-pdf.pdf", "document", "txt"), ("image-markers.png", "image", "png"),
         ("image-markers.jpg", "image", "jpeg"), ("speech-ko.wav", "audio", "wav"),
         ("speech-en.wav", "audio", "wav"), ("scenes-silent.mp4", "video", "mp4"),
         ("scenes-speech.mp4", "video", "mp4")]
count = 0
for filename, category, fmt in CASES:
    with tempfile.TemporaryDirectory(prefix="baro-fixture-") as tmp:
        root = Path(tmp)
        shutil.copyfile(FIXTURES / filename, root / "input")
        result = subprocess.run(["python3", "/app/processor.py", str(root), "probe", "0"], capture_output=True, timeout=120)
        assert result.returncode == 0
        probe = json.loads((root / "manifest.json").read_text())["probe"]
        assert probe["category"] == category and probe["format"] == fmt
        assert probe["byteLength"] == (FIXTURES / filename).stat().st_size
        units = probe.get("pageCount", 1)
        for unit in range(units):
            result = subprocess.run(["python3", "/app/processor.py", str(root), "process", str(unit)], capture_output=True, timeout=120)
            assert result.returncode == 0
            output = json.loads((root / "manifest.json").read_text())
            assert output["unit"] == unit
            assert output["outputBytes"] == sum(a["byteLength"] for a in output["artifacts"])
            for artifact in output["artifacts"]:
                content = (root / artifact["path"]).read_bytes()
                assert len(content) == artifact["byteLength"] <= 1_048_576
                assert hashlib.sha256(content).hexdigest() == artifact["contentHash"]
            if filename == "text-two-pages.pdf":
                content = "".join((root / a["path"]).read_text() for a in output["artifacts"])
                assert ("BARO SYNTHETIC FIXTURE - PAGE 1" if unit == 0 else "BARO SYNTHETIC FIXTURE - PAGE 2") in content
            if filename == "scan-image-only.pdf":
                assert output["coverage"]["status"] == "partial"
                assert output["coverage"]["pages"][0]["status"] == "low_quality"
            if category == "audio":
                assert len([a for a in output["artifacts"] if a["kind"] == "audio"]) == 1
            if category == "video":
                samples = [a for a in output["artifacts"] if a["kind"] == "frame" and a["position"]["sampling"] == "one_second"]
                scenes = [a for a in output["artifacts"] if a["kind"] == "frame" and a["position"]["sampling"] == "scene_change"]
                assert [a["position"]["timestampSeconds"] for a in samples] == list(range(8))
                assert any(abs(a["position"]["timestampSeconds"] - 1.4) < .11 for a in scenes)
                assert any(abs(a["position"]["timestampSeconds"] - 3.2) < .11 for a in scenes)
                assert any(a["kind"] == "audio" for a in output["artifacts"]) == probe["hasAudio"]
        count += 1
# A generated 31-second, 2-fps video crosses the durable unit boundary. This is
# real local codec execution, not a nominal FPS/frame-index fixture assertion.
with tempfile.TemporaryDirectory(prefix="baro-boundary-") as tmp:
    root = Path(tmp)
    made = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                           "color=c=blue:s=96x64:r=2:d=31", "-c:v", "libx264", "-g", "10",
                           "-threads", "1", "-pix_fmt", "yuv420p", "-f", "mp4", str(root / "input")],
                          capture_output=True, timeout=60)
    assert made.returncode == 0
    offset = 0
    for unit in range(2):
        result = subprocess.run(["python3", "/app/processor.py", str(root), "process", str(unit), str(offset)],
                                capture_output=True, timeout=180)
        assert result.returncode == 0
        output = json.loads((root / "manifest.json").read_text())
        assert output["frameOffset"] == offset
        assert output["decodedFrameCount"] == (60 if unit == 0 else 2)
        samples = [a for a in output["artifacts"] if a["kind"] == "frame" and a["position"]["sampling"] == "one_second"]
        assert [a["position"]["timestampSeconds"] for a in samples] == list(range(unit * 30, min((unit + 1) * 30, 31)))
        assert [a["position"]["frameIndex"] for a in samples] == list(range(unit * 60, min((unit + 1) * 60, 62), 2))
        offset += output["decodedFrameCount"]
    assert offset == 62
    count += 1
for filename in ["truncated-video.mp4"]:
    with tempfile.TemporaryDirectory(prefix="baro-fixture-") as tmp:
        root = Path(tmp)
        shutil.copyfile(FIXTURES / filename, root / "input")
        result = subprocess.run(["python3", "/app/processor.py", str(root), "probe", "0"], capture_output=True, timeout=120)
        assert result.returncode != 0 and (root / "error.json").exists()
        count += 1
print("Linux native synthetic fixtures: %d PASS (not ASR/vision/R2/cloud evidence)" % count)
