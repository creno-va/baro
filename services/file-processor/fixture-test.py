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
        native_code = None
        if result.returncode and (root / "error.json").exists():
            native_code = json.loads((root / "error.json").read_text()).get("code")
        assert result.returncode == 0, {"unit": unit, "nativeCode": native_code}
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

# Actual image/PDF codecs reconstruct pixels into a new document; no original
# object/action/attachment/metadata is copied. Not a claim of actual public R2.
for filename in ["image-markers.png", "image-markers.jpg", "text-two-pages.pdf", "scan-image-only.pdf"]:
    with tempfile.TemporaryDirectory(prefix="baro-sanitized-") as tmp:
        root = Path(tmp)
        shutil.copyfile(FIXTURES / filename, root / "input")
        result = subprocess.run(["python3", "/app/processor.py", str(root), "sanitize", "0"], capture_output=True, timeout=180)
        assert result.returncode == 0
        metadata = json.loads((root / "manifest.json").read_text())
        assert metadata["passes"] == 2
        content = (root / "sanitized.bin").read_bytes()
        assert len(content) == metadata["byteLength"] <= 100_000_000
        assert hashlib.sha256(content).hexdigest() == metadata["contentHash"]
        assert metadata["chunkCount"] == (len(content) + 1_048_575) // 1_048_576
        if metadata["format"] == "pdf":
            assert content.startswith(b"%PDF-1.4")
            for forbidden in [b"/JavaScript", b"/OpenAction", b"/Launch", b"/EmbeddedFiles", b"/AcroForm", b"/Annots", b"/URI"]:
                assert forbidden not in content
            info = subprocess.run(["pdfinfo", str(root / "sanitized.bin")], capture_output=True, check=True).stdout.decode()
            import re
            assert int(re.search(r"^Pages:\s+(\d+)", info, re.M)[1]) == metadata["probe"]["pageCount"]
        else:
            from PIL import Image
            with Image.open(root / "sanitized.bin") as image:
                assert image.format == "JPEG" and not image.getexif()
                assert "icc_profile" not in image.info and "comment" not in image.info
print("Linux sanitized image/PDF fixtures: 4 PASS (not public R2/moderation evidence)")

# Execute the actual Node ingress/stream encoder in the built Linux image too.
# Loopback remains local even with Docker --network none; all bytes are synthetic.
import base64
import time
import urllib.request
native_server = subprocess.Popen(["node", "/app/server.mjs"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for attempt in range(50):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8080/ready", timeout=1) as ready:
                assert ready.status == 200
            break
        except (OSError, TimeoutError):
            assert native_server.poll() is None
            time.sleep(.1)
    else:
        raise AssertionError("Native fixture server did not become ready")
    for filename in ["image-markers.png", "text-two-pages.pdf"]:
        source = (FIXTURES / filename).read_bytes()
        request = urllib.request.Request("http://127.0.0.1:8080/sanitize", data=source, method="POST", headers={
            "x-baro-capability": "0" * 64, "x-baro-bytes": str(len(source)),
            "x-baro-hash": hashlib.sha256(source).hexdigest(),
        })
        with urllib.request.urlopen(request, timeout=240) as response:
            metadata = json.loads(response.readline(1_500_001))
            assert metadata["type"] == "sanitized_manifest" and metadata["value"]["passes"] == 2
            metadata = metadata["value"]
            first_hashes = []
            for stage in range(2):
                total = 0
                hasher = hashlib.sha256()
                for index in range(metadata["chunkCount"]):
                    record = json.loads(response.readline(1_500_001))
                    assert record["type"] == "sanitized_chunk" and record["pass"] == stage and record["index"] == index
                    chunk = base64.b64decode(record["data"], validate=True)
                    assert len(chunk) == min(1_048_576, metadata["byteLength"] - total)
                    total += len(chunk)
                    hasher.update(chunk)
                    if stage == 0:
                        first_hashes.append(hashlib.sha256(chunk).digest())
                    else:
                        assert first_hashes[index] == hashlib.sha256(chunk).digest()
                assert total == metadata["byteLength"] and hasher.hexdigest() == metadata["contentHash"]
            assert json.loads(response.readline(1_500_001)) == {"type": "complete"}
            assert not response.read(1)
finally:
    native_server.terminate()
    try:
        native_server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        native_server.kill()
        native_server.wait(timeout=5)
print("Linux native HTTP two-pass sanitizer: 2 PASS (synthetic loopback only)")

# Regression: input zero-seek discards AAC encoder priming/edit-list samples.
# Validate actual PCM and reported intervals for both the first unit and the
# 30-second boundary, rather than asserting a nominal duration in metadata.
import wave
for fmt, codec in [("m4a", "aac"), ("wav", "pcm_s16le"), ("flac", "flac")]:
    for duration in [2, 31]:
        with tempfile.TemporaryDirectory(prefix="baro-audio-coverage-") as tmp:
            root = Path(tmp)
            source = root / ("synthetic." + fmt)
            subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                            "sine=frequency=523:sample_rate=16000:duration=" + str(duration),
                            "-c:a", codec, "-threads", "1", str(source)], check=True, capture_output=True)
            shutil.copyfile(source, root / "input")
            sample_total = 0
            previous_end = 0
            for unit in range((duration + 29) // 30):
                result = subprocess.run(["python3", "/app/processor.py", str(root), "process", str(unit)],
                                        capture_output=True, timeout=180)
                assert result.returncode == 0, {"format": fmt, "duration": duration, "unit": unit}
                output = json.loads((root / "manifest.json").read_text())
                audio = next(a for a in output["artifacts"] if a["kind"] == "audio")
                with wave.open(str(root / audio["path"]), "rb") as pcm:
                    assert (pcm.getframerate(), pcm.getnchannels(), pcm.getsampwidth()) == (16000, 1, 2)
                    count = pcm.getnframes()
                start = audio["position"]["startSeconds"]
                end = audio["position"]["endSeconds"]
                assert abs(start - previous_end) <= 1 / 16000
                assert abs((end - start) * 16000 - count) <= 1
                sample_total += count
                previous_end = end
            assert abs(sample_total - duration * 16000) <= 1
print("Native audio PCM/interval regression: 6 PASS (synthetic local codecs only)")

# A two-second video with only one second of sound must retain the real audio
# gap as a failure. It must never pad PCM or report nominal full coverage.
with tempfile.TemporaryDirectory(prefix="baro-audio-gap-") as tmp:
    root = Path(tmp)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                    "color=c=blue:s=96x64:r=2:d=2", "-f", "lavfi", "-i",
                    "sine=frequency=523:sample_rate=16000:duration=1", "-c:v", "libx264",
                    "-c:a", "aac", "-threads", "1", "-pix_fmt", "yuv420p", "-f", "mp4",
                    str(root / "input")], check=True, capture_output=True)
    result = subprocess.run(["python3", "/app/processor.py", str(root), "process", "0"],
                            capture_output=True, timeout=180)
    assert result.returncode != 0
    assert json.loads((root / "error.json").read_text())["code"] == "AUDIO_COVERAGE_MISMATCH"
    assert not (root / "manifest.json").exists()
print("Native missing PCM coverage: 1 PASS (gap rejected, synthetic local codecs only)")
