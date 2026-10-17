"""Offline package rejection fixtures; no converter/provider calls."""
import pathlib
import tempfile
import unittest
import zipfile
import subprocess
import struct
import json
import sys
import os
import hashlib
import http.client
import selectors
import shutil
from unittest.mock import patch

import office


class OfficePackageSecurity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.source = self.root / "input"

    def tearDown(self):
        self.tmp.cleanup()

    def package(self, extras=None, main="<document><p>합성 BLUEBOX17</p></document>"):
        entries = {"[Content_Types].xml": "<Types/>", "word/document.xml": main}
        entries.update(extras or {})
        with zipfile.ZipFile(self.source, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, value in entries.items():
                archive.writestr(name, value)

    def reject(self, extras=None, main=None, code="UNSUPPORTED_FORMAT"):
        self.package(extras, main or "<document/>")
        with self.assertRaisesRegex(office.OfficeError, "^" + code + "$"):
            office.detect(self.source)

    def test_literal_text_and_korean_are_not_external_resources(self):
        self.package(main="<document><p>합성 https://example.invalid 문구</p></document>")
        self.assertEqual(office.detect(self.source), "docx")

    def test_converter_unavailability_is_not_a_permanent_input_rejection(self):
        for status, code in [(2, "INVALID_MEDIA"), (1, "PROCESSING_FAILED"), (-9, "PROCESSING_FAILED")]:
            with patch.object(office.subprocess, "run", return_value=subprocess.CompletedProcess([], status)) as run:
                with self.assertRaisesRegex(office.OfficeError, "^" + code + "$") as caught:
                    office.normalize(self.source, self.root, "docx")
                self.assertEqual(isinstance(caught.exception, office.DefinitiveOfficeRejection), status == 2)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args.kwargs["timeout"], 120)
        with patch.object(office.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaisesRegex(office.OfficeError, "^PROCESSING_FAILED$"):
                office.normalize(self.source, self.root, "docx")

    def test_only_explicit_office_refusals_reach_the_probe_marker(self):
        import processor
        self.package(main='<workbook><workbookProtection lockStructure="1"/></workbook>')
        with patch.object(sys, "argv", ["processor.py", str(self.root), "probe", "0"]):
            self.assertEqual(processor.main(), 1)
        self.assertEqual(json.loads((self.root / "error.json").read_text()),
                         {"code": "UNSUPPORTED_FORMAT", "rejection": "office_input"})
        for status in [2, 1, -9]:
            with patch.object(office, "detect", return_value="xls"), \
                    patch.object(office.subprocess, "run", return_value=subprocess.CompletedProcess([], status)), \
                    patch.object(sys, "argv", ["processor.py", str(self.root), "probe", "0"]):
                self.assertEqual(processor.main(), 1)
            expected = {"code": "INVALID_MEDIA", "rejection": "office_input"} if status == 2 else {"code": "PROCESSING_FAILED"}
            self.assertEqual(json.loads((self.root / "error.json").read_text()), expected)

    def test_parser_timeout_and_io_failures_never_receive_the_probe_marker(self):
        import processor
        self.package()
        failures = [OSError("synthetic"), ValueError("synthetic"),
                    subprocess.TimeoutExpired("synthetic", 120),
                    office.OfficeError("INVALID_MEDIA"), office.OfficeError("OUTPUT_LIMIT")]
        for error in failures:
            with patch.object(office, "normalize", side_effect=error), \
                    patch.object(sys, "argv", ["processor.py", str(self.root), "probe", "0"]):
                self.assertEqual(processor.main(), 1)
            failure = json.loads((self.root / "error.json").read_text())
            self.assertEqual(set(failure), {"code"})
        # HEIC/native command rejection already shares INVALID_MEDIA; it must
        # remain non-definitive even though the public code matches Office.
        with patch.object(processor, "inspect", side_effect=processor.Rejected("INVALID_MEDIA")), \
                patch.object(sys, "argv", ["processor.py", str(self.root), "probe", "0"]):
            self.assertEqual(processor.main(), 1)
        self.assertEqual(json.loads((self.root / "error.json").read_text()), {"code": "INVALID_MEDIA"})

    def test_actual_http_probe_preserves_only_the_explicit_refusal(self):
        # Startup-only local shims: actual ingress/hash/child/error/cleanup code.
        # These synthetic packages fail before a converter or network is used.
        directory = pathlib.Path(__file__).parent.resolve()
        source = (directory / "server.mjs").read_text()
        for before, after in [
            ('spawn("python3",', 'spawn(' + json.dumps(sys.executable) + ','),
            ('"/app/processor.py"', json.dumps(str(directory / "processor.py"))),
            ('server.listen(8080, "0.0.0.0");',
             'server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));'),
        ]:
            self.assertEqual(source.count(before), 1)
            source = source.replace(before, after)
        script = self.root / "server.mjs"
        script.write_text(source)
        node = shutil.which("node")
        self.assertIsNotNone(node)
        child = subprocess.Popen([node, str(script)], stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, env={**os.environ, "TMPDIR": str(self.root)})
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(5), "Synthetic native server did not start")
            port = int(child.stdout.readline())
            self.package(main='<workbook><workbookProtection lockStructure="1"/></workbook>')
            protected = self.source.read_bytes()
            for data, mismatch, expected in [
                (protected, False, {"code": "UNSUPPORTED_FORMAT", "rejection": "office_input"}),
                (b"PK\x03\x04truncated", False, {"code": "INVALID_MEDIA"}),
                (protected, True, {"code": "PROCESSING_FAILED"}),
            ]:
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                try:
                    connection.request("POST", "/probe", body=data, headers={
                        "x-baro-capability": "0" * 64, "x-baro-bytes": str(len(data)),
                        "x-baro-hash": "0" * 64 if mismatch else hashlib.sha256(data).hexdigest(),
                    })
                    response = connection.getresponse()
                    self.assertEqual(response.status, 422)
                    self.assertEqual(json.loads(response.read(1024)), expected)
                    self.assertFalse(list(self.root.glob("baro-job-*")))
                finally:
                    connection.close()
        finally:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
            child.stdout.close()

    def test_external_relationship_is_rejected_before_conversion(self):
        for target in ("https://example.invalid/private", "file:///etc/passwd"):
            with self.subTest(target_kind=target.split(":")[0]):
                self.reject({"word/_rels/document.xml.rels": '<Relationships><Relationship TargetMode="External" Target="' + target + '"/></Relationships>'})

    def test_entities_and_alternate_encoding_are_rejected(self):
        for xml in ('<!DOCTYPE x [<!ENTITY canary SYSTEM "file:///etc/passwd">]><x>&canary;</x>',
                    '<!DOCTYPE x [<!ENTITY canary "expanded">]><x>&canary;</x>',
                    '<x>text</x>'.encode('utf-16')):
            self.reject(main=xml)

    def test_macro_embedded_object_and_external_connection_are_rejected(self):
        for path in ("word/vbaProject.bin", "word/embeddings/oleObject1.bin", "xl/connections.xml",
                     "xl/externalLinks/externalLink1.xml", "word/activeX/activeX1.xml", "Scripts/script.js"):
            self.reject({path: "<x/>"})

    def test_document_and_workbook_protection_are_explicitly_rejected(self):
        for tag in ("documentProtection", "writeProtection", "sheetProtection"):
            self.reject(main="<document><" + tag + "/></document>")
        self.reject(main='<workbook><workbookProtection lockStructure="1"/></workbook>')
        self.reject(main='<workbook><workbookProtection workbookPassword="CAFE"/></workbook>')
        self.package(main='<workbook><workbookProtection/></workbook>')
        self.assertEqual(office.detect(self.source), "docx")

    def test_hwp_deflate_expansion_and_trailing_data_are_rejected(self):
        import io
        import zlib
        compressor = zlib.compressobj(wbits=-15)
        packed = compressor.compress(b"synthetic" * 1000) + compressor.flush()
        self.assertEqual(office._bounded_stream(io.BytesIO(packed), True, 9000), 9000)
        self.assertEqual(office._bounded_stream(io.BytesIO(packed + b"\0" * 4 + struct.pack("<I", 9000)), True, 9000), 9000)
        with self.assertRaisesRegex(office.OfficeError, "^OUTPUT_LIMIT$"):
            office._bounded_stream(io.BytesIO(packed), True, 8999)
        with self.assertRaisesRegex(office.OfficeError, "^INVALID_MEDIA$"):
            office._bounded_stream(io.BytesIO(packed + b"trailing"), True, 9000)
        for suffix in [b"\0" * 4 + struct.pack("<I", 8999), b"\0" * 7, b"\0" * 4 + struct.pack("<I", 9000) + b"x"]:
            with self.assertRaisesRegex(office.OfficeError, "^INVALID_MEDIA$"):
                office._bounded_stream(io.BytesIO(packed + suffix), True, 9000)

    def test_forged_small_binary_zip_size_cannot_hide_real_expansion(self):
        import zlib
        self.package({"word/media/image.png": b"x" * 100_000})
        data = bytearray(self.source.read_bytes())
        name = b"word/media/image.png"
        # Both size/CRC declarations pretend this is one byte. ZipExtFile alone
        # stops at that declared size; the actual raw DEFLATE stream is longer.
        local = data.index(name) - 30
        central = data.index(name, local + 30 + len(name)) - 46
        self.assertEqual(data[local:local + 4], b"PK\x03\x04")
        self.assertEqual(data[central:central + 4], b"PK\x01\x02")
        struct.pack_into("<I", data, local + 14, zlib.crc32(b"x"))
        struct.pack_into("<I", data, local + 22, 1)
        struct.pack_into("<I", data, central + 16, zlib.crc32(b"x"))
        struct.pack_into("<I", data, central + 24, 1)
        self.source.write_bytes(data)
        with self.assertRaisesRegex(office.OfficeError, "^INVALID_MEDIA$"):
            office.detect(self.source)

    def test_executable_fields_do_not_read_files_or_fetch(self):
        for instruction in ('DDEAUTO command', 'INCLUDETEXT "file:///etc/passwd"',
                            'INCLUDEPICTURE "https://example.invalid/a"', 'WEBSERVICE("https://example.invalid")'):
            self.reject(main='<document><instrText>' + instruction.replace('&', '&amp;') + '</instrText></document>')

    def test_archive_traversal_absolute_and_symlink_are_rejected(self):
        for name in ("../outside", "/outside", "word\\outside"):
            self.reject({name: "canary"})
        self.package()
        with zipfile.ZipFile(self.source, "a") as archive:
            link = zipfile.ZipInfo("word/link")
            link.external_attr = 0o120777 << 16
            archive.writestr(link, "/etc/passwd")
        with self.assertRaises(office.OfficeError):
            office.detect(self.source)

    def test_duplicate_and_ambiguous_packages_are_rejected(self):
        self.reject({"xl/workbook.xml": "<workbook/>"})
        self.package()
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with zipfile.ZipFile(self.source, "a") as archive:
                archive.writestr("word/document.xml", "<changed/>")
        with self.assertRaises(office.OfficeError):
            office.detect(self.source)

    def test_decompression_and_metadata_bounds_apply_before_parse(self):
        self.package({"word/media/data.bin": b"0" * 100})
        with patch.object(office, "MAX_EXPANDED", 50), self.assertRaisesRegex(office.OfficeError, "^OUTPUT_LIMIT$"):
            office.detect(self.source)
        with patch.object(office, "MAX_XML", 10), self.assertRaisesRegex(office.OfficeError, "^OUTPUT_LIMIT$"):
            office.detect(self.source)

    def test_hwpx_requires_actual_mimetype_and_does_not_read_linked_files(self):
        with zipfile.ZipFile(self.source, "w") as archive:
            for name, value in {"mimetype": "application/hwp+zip", "Contents/content.hpf": "<content/>",
                                "Contents/header.xml": '<header><bin isEmbeded="0" href="file:///etc/passwd"/></header>'}.items():
                archive.writestr(name, value)
        with self.assertRaisesRegex(office.OfficeError, "^UNSUPPORTED_FORMAT$"):
            office.detect(self.source)

    def test_malformed_package_is_not_treated_as_success(self):
        self.source.write_bytes(b"PK\x03\x04invalid")
        with self.assertRaisesRegex(office.OfficeError, "^INVALID_MEDIA$"):
            office.detect(self.source)


if __name__ == "__main__":
    unittest.main()
