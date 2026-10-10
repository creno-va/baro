"""Small regression checks for lossless extraction optimizations, no providers.

This is independent of the full native fixture corpus. Native video is optional
locally, and required with --require-video in the existing Linux fixture job.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import struct
import wave

from PIL import Image, ImageDraw

SPEC = importlib.util.spec_from_file_location("processor", Path(__file__).with_name("processor.py"))
processor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(processor)


class LosslessExtraction(unittest.TestCase):
    def test_exif_orientation_and_transparent_marks(self):
        with tempfile.TemporaryDirectory(prefix="baro-pixel-test-") as tmp:
            root = Path(tmp)
            source = root / "input"
            for orientation in (2, 3, 4, 5, 6, 7, 8):
                image = Image.new("RGB", (80, 40), "white")
                ImageDraw.Draw(image).rectangle((0, 0, 20, 20), fill="black")
                exif = Image.Exif()
                exif[274] = orientation
                image.save(source, "JPEG", exif=exif, comment=b"synthetic private comment")
                from PIL import ImageOps
                with Image.open(source) as original:
                    expected = ImageOps.exif_transpose(original)
                    expected.save(root / "expected.jpg", "JPEG", quality=80)
                result = processor.process(source, root, processor.inspect(source), 0, 0)
                output = root / result["artifacts"][0]["path"]
                self.assertEqual(output.read_bytes(), (root / "expected.jpg").read_bytes())
                processor.sanitize(source, root, processor.inspect(source))
                with Image.open(root / "sanitized.bin") as sanitized:
                    self.assertEqual(sanitized.size, expected.size)
                    self.assertFalse(sanitized.getexif())
                    self.assertNotIn("comment", sanitized.info)
            for mode, transparent, opaque in [("RGBA", (0, 0, 0, 0), (0, 0, 0, 255)),
                                               ("LA", (0, 0), (0, 255))]:
                image = Image.new(mode, (100, 60), transparent)
                ImageDraw.Draw(image).rectangle((30, 20, 60, 40), fill=opaque)
                image.save(source, "PNG")
                result = processor.process(source, root, processor.inspect(source), 0, 0)
                with Image.open(root / result["artifacts"][0]["path"]) as output:
                    self.assertGreater(output.getpixel((5, 5))[0], 245)
                    self.assertLess(output.getpixel((40, 30))[0], 10)

    def test_mixed_page_reads_raster_body_and_keeps_native_header(self):
        with tempfile.TemporaryDirectory(prefix="baro-mixed-test-") as tmp:
            root = Path(tmp)
            source = root / "input"
            source.write_bytes(b"synthetic PDF transport fixture")
            calls = []
            def extract(args, *a, **kw):
                calls.append(args[0])
                return {"pdftotext": b"HEADER", "pdfimages": b"page num type\n1 0 image 600 180",
                        "pdftoppm": b"", "tesseract": b"RASTER BODY"}[args[0]]
            with patch.object(processor, "command", extract):
                result = processor.process(source, root, {"category": "document", "format": "pdf", "pageCount": 1}, 0, 0)
            text = "".join((root / a["path"]).read_text() for a in result["artifacts"])
            self.assertIn("HEADER", text)
            self.assertIn("RASTER BODY", text)
            self.assertIn("pdftoppm", calls)
            self.assertEqual(result["coverage"]["pages"][0]["status"], "low_quality")
            self.assertEqual(result["coverage"]["status"], "partial")

    def test_text_bom_newlines_empty_pages_and_scalar_boundaries(self):
        # Both reader and wire-artifact boundaries, including astral scalars.
        cases = ["\ufeffA\r\nB\rC\n\t\f\f끝😀\f", "\f", " \t\r\n",
                 "x" * 65_535 + "😀한\r\n" + "y" * 34_460 + "😀끝\fnext",
                 "\ufeffa\ufeffb", "한😀" * 100_001]
        for content in cases:
            with self.subTest(length=len(content)), tempfile.TemporaryDirectory(prefix="baro-text-test-") as tmp:
                root = Path(tmp)
                source = root / "input"
                source.write_bytes(content.encode("utf-8"))
                pages = content.encode("utf-8").decode("utf-8-sig").split("\f")
                probe = processor.inspect(source)
                self.assertEqual(probe["pageCount"], len(pages))
                for unit, expected in enumerate(pages):
                    manifest = processor.process(source, root, probe, unit, 0)
                    artifacts = manifest["artifacts"]
                    chunks = [(root / a["path"]).read_bytes() for a in artifacts]
                    self.assertTrue(b"".join(chunks) == expected.encode("utf-8"), "text bytes mismatch")
                    self.assertTrue([b.decode("utf-8") for b in chunks] ==
                                    [expected[i:i + 100_000] for i in range(0, len(expected), 100_000)], "scalar boundaries mismatch")
                    self.assertEqual(manifest["outputBytes"], len(expected.encode("utf-8")))
                    self.assertEqual(manifest["coverage"], {"category": "document", "status": "complete",
                                     "pageCount": len(pages), "pages": [{"page": unit + 1, "status": "processed"}]})
                    for artifact, chunk in zip(artifacts, chunks):
                        self.assertTrue(artifact["contentHash"] == hashlib.sha256(chunk).hexdigest(), "artifact digest mismatch")

    def test_probe_rejections_and_existing_page_limit(self):
        with tempfile.TemporaryDirectory(prefix="baro-probe-test-") as tmp:
            source = Path(tmp) / "input"
            def no_media(args, *a, **kw):
                self.assertEqual(args[0], "ffprobe")
                raise processor.Rejected("INVALID_MEDIA")
            with patch.object(processor, "command", no_media):
                for content in [b"\xef\xbb\xbf", b"hello\x00", b"hello\x0b", b"hello\x1f",
                                b"\xf0\x9f", b"x" * 65_536 + b"\xff", b"\f" * 100_000 + b"\xff"]:
                    source.write_bytes(content)
                    with self.assertRaisesRegex(processor.Rejected, "^INVALID_MEDIA$"):
                        processor.inspect(source)
            source.write_bytes(b"\f" * 99_999)
            self.assertEqual(processor.inspect(source)["pageCount"], 100_000)
            source.write_bytes(b"\f" * 100_000)
            with self.assertRaisesRegex(processor.Rejected, "^LIMIT$"):
                processor.inspect(source)
            source.write_bytes(b"ok")
            probe = processor.inspect(source)
            for unit in [-1, 1]:
                with self.assertRaisesRegex(processor.Rejected, "^INVALID_UNIT$"):
                    processor.process(source, source.parent, probe, unit, 0)

    def test_images_equal_previous_rgb_conversion_and_metadata_behavior(self):
        with tempfile.TemporaryDirectory(prefix="baro-image-test-") as tmp:
            root = Path(tmp)
            modes = {"RGB": (17, 99, 201), "RGBA": (17, 99, 201, 100),
                     "L": 139, "P": 45, "CMYK": (20, 70, 30, 50)}
            cases = [(mode, color, "JPEG" if mode == "CMYK" else "PNG") for mode, color in modes.items()]
            cases += [("RGB", modes["RGB"], fmt) for fmt in ["BMP", "WEBP", "TIFF", "JPEG"]]
            for mode, color, fmt in cases:
                source = root / "input"
                size = (96, 64) if fmt in ("BMP", "TIFF") else (1900, 1300)
                with Image.new(mode, size) as image:
                    if mode == "P":
                        image.putpalette([v for i in range(256) for v in (i, 255 - i, i // 2)])
                    ImageDraw.Draw(image).rectangle((77, 111, 1703, 1209), fill=color)
                    image.save(source, fmt)
                self.assertLessEqual(source.stat().st_size, 4_000_000)
                with Image.open(source) as image:
                    if mode == "RGBA":
                        old = Image.new("RGB", image.size, "white")
                        old.paste(image, mask=image.getchannel("A"))
                    else:
                        old = image.convert("RGB")
                    old.thumbnail((1600, 1600))
                    old.save(root / "expected.jpg", "JPEG", quality=80)
                probe = processor.inspect(source)
                manifest = processor.process(source, root, probe, 0, 0)
                output = root / manifest["artifacts"][0]["path"]
                self.assertTrue(output.read_bytes() == (root / "expected.jpg").read_bytes(), "image bytes mismatch: " + mode + "/" + fmt)
                with Image.open(output) as image:
                    self.assertFalse(image.getexif())
                    self.assertNotIn("icc_profile", image.info)
                    self.assertNotIn("comment", image.info)
                self.assertEqual(manifest["coverage"]["status"], "partial")
            # Force a nonuniform JPEG with metadata and a real resize.
            with Image.new("RGB", (3400, 1300), (17, 99, 201)) as image:
                for x in range(0, 3400, 7):
                    ImageDraw.Draw(image).line((x, 0, x, 1299), fill=(231, 30, 70), width=2)
                exif = Image.Exif()
                exif[270] = "synthetic metadata"
                image.save(source, "JPEG", exif=exif, icc_profile=b"synthetic ICC", comment=b"synthetic comment")
            with Image.open(source) as image:
                old = image.convert("RGB")
                old.thumbnail((1600, 1600))
                old.save(root / "expected.jpg", "JPEG", quality=80)
            with Image.open(root / "expected.jpg") as expected:
                expected_comment = expected.info.get("comment")
            manifest = processor.process(source, root, processor.inspect(source), 0, 0)
            output = root / manifest["artifacts"][0]["path"]
            self.assertTrue(output.read_bytes() == (root / "expected.jpg").read_bytes(), "JPEG bytes mismatch")
            with Image.open(output) as image:
                self.assertFalse(image.getexif())
                self.assertNotIn("icc_profile", image.info)
                # The previous Pillow path propagates a JPEG comment. Preserve
                # that behavior here; changing metadata requires a separate fix.
                self.assertEqual(image.info.get("comment"), expected_comment)

    def test_multiframe_image_stays_partial(self):
        with tempfile.TemporaryDirectory(prefix="baro-multiframe-test-") as tmp:
            root = Path(tmp)
            for fmt in ["GIF", "TIFF"]:
                with Image.new("RGB", (16, 16), "red") as first, Image.new("RGB", (16, 16), "blue") as second:
                    first.save(root / "input", fmt, save_all=True, append_images=[second])
                manifest = processor.process(root / "input", root, processor.inspect(root / "input"), 0, 0)
                self.assertTrue(manifest["artifacts"][0]["multiFrame"])
                self.assertEqual(manifest["coverage"], {"category": "image", "status": "partial", "observation": "missing"})

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "native audio tools unavailable")
    def test_wav_units_preserve_every_sample_across_thirty_seconds(self):
        with tempfile.TemporaryDirectory(prefix="baro-audio-test-") as tmp:
            root = Path(tmp)
            # Locally generated saw wave; not speech or an ASR evaluation.
            content = b"".join(struct.pack("<h", ((index % 128) - 64) * 128) for index in range(31 * 16_000))
            with wave.open(str(root / "input"), "wb") as output:
                output.setparams((1, 2, 16_000, 0, "NONE", "not compressed"))
                output.writeframes(content)
            probe = processor.inspect(root / "input")
            chunks = []
            for unit, expected_samples in [(0, 30 * 16_000), (1, 16_000)]:
                manifest = processor.process(root / "input", root, probe, unit, 0)
                artifact = manifest["artifacts"][0]
                with wave.open(str(root / artifact["path"])) as pcm:
                    self.assertEqual(pcm.getnframes(), expected_samples)
                    self.assertEqual((pcm.getnchannels(), pcm.getsampwidth(), pcm.getframerate()), (1, 2, 16_000))
                    chunks.append(pcm.readframes(pcm.getnframes()))
                interval = manifest["coverage"]["audio"]["intervals"][0]
                self.assertEqual(interval, {"startSeconds": unit * 30, "endSeconds": min((unit + 1) * 30, 31), "status": "missing"})
            self.assertTrue(b"".join(chunks) == content, "PCM samples omitted or changed")

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "native video tools unavailable")
    def test_coincident_video_samples_keep_both_artifacts_and_coverage(self):
        with tempfile.TemporaryDirectory(prefix="baro-video-test-") as tmp:
            root = Path(tmp)
            made = subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-threads", "1",
                "-filter_threads", "1", "-filter_complex_threads", "1", "-f", "lavfi", "-i", "color=c=blue:s=96x64:r=10:d=2",
                "-f", "lavfi", "-i", "color=c=red:s=96x64:r=10:d=2", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
                "-map", "[v]", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-f", "mp4", str(root / "input")],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
            self.assertEqual(made.returncode, 0)
            counts = Counter()
            original = subprocess.Popen
            def counted(command, *a, **kw):
                counts[Path(command[0]).name] += 1
                return original(command, *a, **kw)
            with patch.object(subprocess, "Popen", counted):
                manifest = processor.process(root / "input", root, processor.inspect(root / "input"), 0, 0)
            self.assertEqual(counts, {"ffmpeg": 5, "ffprobe": 2})
            frames = manifest["coverage"]["frames"]
            self.assertEqual([f["timestampSeconds"] for f in frames if f["sampling"] == "one_second"], [0, 1, 2, 3])
            self.assertEqual([f["timestampSeconds"] for f in frames if f["sampling"] == "scene_change"], [2.0])
            self.assertEqual(len(manifest["artifacts"]), 5)
            self.assertEqual(manifest["decodedFrameCount"], 40)
            duplicates = [a for a in manifest["artifacts"] if a["position"]["timestampSeconds"] == 2]
            self.assertEqual(len(duplicates), 2)
            self.assertTrue(duplicates[0]["contentHash"] == duplicates[1]["contentHash"], "duplicate digest mismatch")
            self.assertTrue((root / duplicates[0]["path"]).read_bytes() == (root / duplicates[1]["path"]).read_bytes(), "duplicate frame bytes mismatch")
            self.assertEqual(manifest["outputBytes"], sum(a["byteLength"] for a in manifest["artifacts"]))
            self.assertEqual(manifest["coverage"]["status"], "partial")
            # Reuse still consumes an artifact and its bytes under both existing caps.
            with patch.object(processor, "MAX_OUTPUT", manifest["outputBytes"] - 1):
                with self.assertRaisesRegex(processor.Rejected, "^OUTPUT_LIMIT$"):
                    processor.process(root / "input", root, processor.inspect(root / "input"), 0, 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-video", action="store_true")
    args, remaining = parser.parse_known_args()
    if args.require_video and not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        parser.error("native ffmpeg and ffprobe required")
    unittest.main(argv=[__file__] + remaining)
