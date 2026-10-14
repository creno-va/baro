"""Actual pinned Linux HEIC decoder, synthetic inputs only; no cloud evidence."""
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageChops, ImageStat
import heif


FIXTURE = Path("/fixtures/image-markers.heic")


def box(kind, payload):
    return struct.pack(">I", len(payload) + 8) + kind + payload


def multi_image_fixture(source):
    """Duplicate this synthetic fixture's single HEVC item without reencoding.

    The two real top-level item IDs reference the same synthetic codec bytes.
    This is fixture construction, never a parser used on product uploads.
    """
    start = source.index(b"meta") - 4
    size = int.from_bytes(source[start:start + 4], "big")
    metadata = source[start + 8:start + size]
    children = []
    offset = 4
    while offset < len(metadata):
        length = int.from_bytes(metadata[offset:offset + 4], "big")
        children.append((metadata[offset + 4:offset + 8], metadata[offset + 8:offset + length]))
        offset += length
    delta = 21 + 9 + 14
    revised = []
    for kind, payload in children:
        if kind == b"iinf":
            assert payload[:6] == b"\0\0\0\0\0\1" and len(payload) == 27
            entry = bytearray(payload[6:])
            entry[12:14] = b"\0\2"
            payload = payload[:4] + b"\0\2" + payload[6:] + entry
        elif kind == b"iprp":
            where = payload.index(b"ipma") - 4
            properties, associations = payload[:where], payload[where + 8:]
            assert associations[:8] == b"\0\0\0\0\0\0\0\1" and len(associations) == 17
            second = b"\0\2" + associations[10:]
            payload = properties + box(b"ipma", associations[:4] + b"\0\0\0\2" + associations[8:] + second)
        elif kind == b"iloc":
            assert payload[:8] == b"\0\0\0\0\x44\0\0\1" and len(payload) == 22
            entry = bytearray(payload[8:])
            original_offset = int.from_bytes(entry[6:10], "big")
            entry[6:10] = struct.pack(">I", original_offset + delta)
            second = b"\0\2" + entry[2:]
            payload = payload[:6] + b"\0\2" + entry + second
        revised.append(box(kind, payload))
    result = source[:start] + box(b"meta", metadata[:4] + b"".join(revised)) + source[start + size:]
    assert len(result) == len(source) + delta
    return result


class HeicFixtures(unittest.TestCase):
    def test_actual_primary_pixels_orientation_metadata_and_cleanup(self):
        self.assertTrue(heif.is_heic(FIXTURE))
        self.assertEqual(heif.inspect_heic(FIXTURE), {"width": 1000, "height": 700, "multiFrame": False})
        with tempfile.TemporaryDirectory() as temporary:
            image, multi = heif.open_primary(FIXTURE, temporary)
            self.assertEqual(image.mode, "RGB")
            self.assertEqual(image.size, (1000, 700))
            self.assertFalse(multi)
            self.assertFalse(image.getexif())
            self.assertEqual(image.info, {})
            self.assertEqual(list(Path(temporary).iterdir()), [])
            # Compare actual pixels against the authored PNG, allowing HEVC loss.
            with Image.open("/fixtures/image-markers.png") as original:
                difference = ImageStat.Stat(ImageChops.difference(image, original.convert("RGB")))
                self.assertLess(max(difference.mean), 12)
            image.close()

    def test_actual_multiple_items_decode_only_one_primary(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "input"
            source.write_bytes(multi_image_fixture(FIXTURE.read_bytes()))
            self.assertTrue(heif.inspect_heic(source)["multiFrame"])
            image, multi = heif.open_primary(source, temporary)
            self.assertTrue(multi)
            self.assertEqual(image.size, (1000, 700))
            self.assertEqual(list(Path(temporary).iterdir()), [source])
            image.close()

    def test_invalid_and_excessive_dimensions_fail_before_output(self):
        original = FIXTURE.read_bytes()
        oversized = bytearray(original)
        offset = oversized.index(b"ispe")
        oversized[offset + 8:offset + 16] = struct.pack(">II", 10000, 10000)
        for content in [original[:200], bytes(oversized)]:
            with self.subTest(size=len(content)), tempfile.TemporaryDirectory() as temporary:
                source = Path(temporary) / "input"
                source.write_bytes(content)
                with self.assertRaises(heif.HeifError):
                    heif.open_primary(source, temporary)
                self.assertEqual(list(Path(temporary).iterdir()), [source])

    def test_byte_cap_does_not_start_native_decoder(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "input"
            source.write_bytes(FIXTURE.read_bytes())
            with source.open("r+b") as output:
                output.truncate(heif.MAX_BYTES + 1)
            with patch.object(heif.subprocess, "run") as native:
                with self.assertRaises(heif.HeifError):
                    heif.inspect_heic(source)
                native.assert_not_called()

    def test_native_failure_never_exports_error_text_or_retries(self):
        for result in [subprocess.CompletedProcess([], 1, b"private raw native detail"),
                       subprocess.TimeoutExpired("private path", 60)]:
            with patch.object(heif.subprocess, "run") as native:
                if isinstance(result, Exception):
                    native.side_effect = result
                else:
                    native.return_value = result
                with self.assertRaisesRegex(heif.HeifError, "^INVALID_MEDIA$"):
                    heif.inspect_heic(FIXTURE)
                self.assertEqual(native.call_count, 1)

    def test_probe_decode_metadata_mismatch_and_missing_image_are_rejected(self):
        before = {"width": 1000, "height": 700, "multiFrame": False}
        for after in [{**before, "width": 999}, {**before, "multiFrame": True}, before]:
            with tempfile.TemporaryDirectory() as temporary, patch.object(heif, "_run", side_effect=[before, after]):
                with self.assertRaises(heif.HeifError):
                    heif.open_primary(FIXTURE, temporary)
                self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_strict_metadata_and_actual_ftyp(self):
        for metadata in [{"width": True, "height": 1, "multiFrame": False},
                         {"width": 10000, "height": 10000, "multiFrame": False},
                         {"width": 1, "height": 1, "multiFrame": "false"},
                         {"width": 1, "height": 1, "multiFrame": False, "source": "private"}]:
            with self.assertRaises(heif.HeifError):
                heif._metadata(metadata)
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "pretend.heic"
            source.write_bytes(box(b"ftyp", b"avif\0\0\0\0mif1avif"))
            self.assertFalse(heif.is_heic(source))
            source.write_bytes(b"this is text, not an image")
            self.assertFalse(heif.is_heic(source))

    def test_existing_output_is_never_replaced_or_deleted(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "keep.ppm"
            output.write_bytes(b"preserve synthetic bytes")
            result = subprocess.run([heif.NATIVE, "decode", str(FIXTURE), str(output)],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b"")
            self.assertEqual(output.read_bytes(), b"preserve synthetic bytes")


if __name__ == "__main__":
    unittest.main(verbosity=1)
