"""Bounded, offline document normalization. Original bytes are never replaced.

Only an invocation-private PDF is produced. The caller retains its per-page,
owner/revision-fenced protocol and deletes the whole job directory afterwards.
"""
import os
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import xml.etree.ElementTree as ET
import zipfile
import zlib

MAX_INPUT = 100_000_000
MAX_EXPANDED = 536_870_912
MAX_XML = 8_388_608
MAX_XML_TOTAL = 33_554_432
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


class OfficeError(Exception):
    """The message is one fixed public rejection code, never parser output."""


class DefinitiveOfficeRejection(OfficeError):
    """An explicit input/protection refusal, never parser or process failure."""


def _reject():
    raise DefinitiveOfficeRejection("UNSUPPORTED_FORMAT")


def _xml(data):
    if len(data) > MAX_XML:
        raise OfficeError("OUTPUT_LIMIT")
    # These packages use UTF-8 XML. Reject DTDs before any XML parser can resolve
    # entities, including alternate UTF-16 encodings of a malicious declaration.
    if b"\x00" in data or re.search(br"<!\s*(?:DOCTYPE|ENTITY)", data, re.I):
        _reject()
    try:
        tree = ET.fromstring(data)
    except (ET.ParseError, ValueError):
        raise OfficeError("INVALID_MEDIA") from None
    count = 0
    for node in tree.iter():
        count += 1
        if count > 200_000:
            raise OfficeError("OUTPUT_LIMIT")
        tag = node.tag.rsplit("}", 1)[-1].lower()
        attrs = {key.rsplit("}", 1)[-1].lower(): value for key, value in node.attrib.items()}
        if (attrs.get("targetmode", "").lower() == "external" or
                attrs.get("isembeded") == "0" or tag in {"oleobject", "altchunk", "script"}):
            _reject()
        # An empty workbookProtection is the ordinary unprotected placeholder
        # emitted by openpyxl. No password, lock or algorithm field is allowed.
        if (tag in {"encryption-data", "encryptedkey", "keyinfo", "documentprotection",
                    "writeprotection", "sheetprotection", "workbookprotection"} and
                not (tag == "workbookprotection" and not attrs)):
            _reject()
        for key in ("href", "src", "target", "sub-path"):
            value = attrs.get(key, "")
            if re.match(r"^(?:[a-z][a-z0-9+.-]*:|//|\\\\)", value, re.I):
                _reject()
        instruction = attrs.get("instr", "") if tag == "fldsimple" else node.text or ""
        if tag in {"fldsimple", "instrtext", "f"} and re.search(
                r"\b(?:DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE|WEBSERVICE|RTD|HYPERLINK)\b|\[[^\]]+\]!", instruction, re.I):
            _reject()
    return tree


def _zip_format(source):
    try:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            if len(entries) > 20_000 or sum(e.file_size for e in entries) > MAX_EXPANDED:
                raise OfficeError("OUTPUT_LIMIT")
            names = set()
            xml_bytes = 0
            expanded = 0
            for entry in entries:
                name = entry.filename
                path = PurePosixPath(name)
                if (name in names or path.is_absolute() or ".." in path.parts or
                        "\\" in name or "\x00" in name or entry.flag_bits & 1 or
                        (entry.external_attr >> 16) & 0o170000 == 0o120000):
                    _reject()
                names.add(name)
                # ZipExtFile bounds its output by the central directory's
                # declared size. Independently verify the real compressed
                # stream before native parsers can see a forged small size.
                with archive.open(entry):
                    pass  # Also validates local header/name and overlap bounds.
                expanded += _verify_zip_stream(source, entry, MAX_EXPANDED - expanded)
                lowered = name.lower()
                if (any(part in {"embeddings", "externallinks", "activex", "scripts"} for part in lowered.split("/")) or
                        lowered.endswith(("vbaproject.bin", ".svg", ".html", ".htm")) or
                        lowered.endswith("connections.xml")):
                    _reject()
                if lowered.endswith((".xml", ".rels", ".hpf")):
                    xml_bytes += entry.file_size
                    if entry.file_size > MAX_XML or xml_bytes > MAX_XML_TOTAL:
                        raise OfficeError("OUTPUT_LIMIT")
                    with archive.open(entry) as member:
                        data = member.read(MAX_XML + 1)
                    if len(data) != entry.file_size:
                        raise OfficeError("INVALID_MEDIA")
                    _xml(data)
            formats = [fmt for member, fmt in (("word/document.xml", "docx"),
                       ("xl/workbook.xml", "xlsx"), ("ppt/presentation.xml", "pptx")) if member in names]
            if formats and "[Content_Types].xml" not in names:
                _reject()
            if "Contents/content.hpf" in names and "Contents/header.xml" in names and "mimetype" in names:
                if archive.getinfo("mimetype").file_size != len(b"application/hwp+zip") or archive.read("mimetype") != b"application/hwp+zip":
                    _reject()
                formats.append("hwpx")
            if len(formats) != 1:
                _reject()
            return formats[0]
    except (zipfile.BadZipFile, RuntimeError, EOFError, OSError, zlib.error, struct.error):
        raise OfficeError("INVALID_MEDIA") from None


def _verify_zip_stream(source, entry, limit):
    if entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
        _reject()
    inflater = zlib.decompressobj(-15) if entry.compress_type == zipfile.ZIP_DEFLATED else None
    total, crc = 0, 0
    with source.open("rb") as stream:
        stream.seek(entry.header_offset)
        header = stream.read(30)
        if len(header) != 30 or header[:4] != b"PK\x03\x04":
            raise OfficeError("INVALID_MEDIA")
        name_size, extra_size = struct.unpack_from("<HH", header, 26)
        stream.seek(name_size + extra_size, 1)
        remaining = entry.compress_size
        while remaining:
            chunk = stream.read(min(65_536, remaining))
            if not chunk:
                raise OfficeError("INVALID_MEDIA")
            remaining -= len(chunk)
            pending = chunk
            while pending:
                decoded = inflater.decompress(pending, min(65_536, limit - total + 1)) if inflater else pending
                total += len(decoded)
                crc = zlib.crc32(decoded, crc)
                if total > limit:
                    raise OfficeError("OUTPUT_LIMIT")
                if inflater and inflater.unused_data:
                    raise OfficeError("INVALID_MEDIA")
                pending = inflater.unconsumed_tail if inflater else b""
    if (inflater and not inflater.eof) or total != entry.file_size or crc != entry.CRC:
        raise OfficeError("INVALID_MEDIA")
    return total


def _hwp_records(data):
    offset = 0
    while offset < len(data):
        if len(data) - offset < 4:
            raise OfficeError("INVALID_MEDIA")
        header = struct.unpack_from("<I", data, offset)[0]
        offset += 4
        size = header >> 20
        if size == 0xfff:
            if len(data) - offset < 4:
                raise OfficeError("INVALID_MEDIA")
            size = struct.unpack_from("<I", data, offset)[0]
            offset += 4
        if offset + size > len(data):
            raise OfficeError("INVALID_MEDIA")
        yield header & 0x3ff, data[offset:offset + size]
        offset += size


def _bounded_stream(stream, compressed, limit):
    inflater = zlib.decompressobj(-15) if compressed else None
    total = 0
    for chunk in iter(lambda: stream.read(65_536), b""):
        decoded = inflater.decompress(chunk, limit - total + 1) if inflater else chunk
        total += len(decoded)
        if total > limit or (inflater and inflater.unconsumed_tail):
            raise OfficeError("OUTPUT_LIMIT")
    if inflater:
        # The pinned hwplib writer appends a zero marker + original uint32 byte
        # length after raw DEFLATE. Accept only that exact checked trailer;
        # arbitrary concatenated data/streams remain invalid.
        trailer = inflater.unused_data
        if not inflater.eof or (trailer and trailer != b"\0" * 4 + struct.pack("<I", total)):
            raise OfficeError("INVALID_MEDIA")
    return total


def _ole_format(source):
    import olefile
    try:
        with olefile.OleFileIO(source, raise_defects=olefile.DEFECT_INCORRECT) as ole:
            paths = ole.listdir()
            if len(paths) > 20_000 or sum(ole.get_size(p) for p in paths) > MAX_EXPANDED:
                raise OfficeError("OUTPUT_LIMIT")
            hwp = ole.exists("FileHeader")
            for path in paths:
                if any(p.lower() in {"vba", "_vba_project", "project", "scripts", "objectpool",
                                    "encryptedpackage", "encryptioninfo"} for p in path):
                    # HWP stores inert default script metadata even without its
                    # script-present flag. H2Orestart imports no script streams;
                    # actual scripts/protection flags below remain forbidden.
                    if not (hwp and path[0] == "Scripts"):
                        _reject()
            formats = [fmt for member, fmt in (("WordDocument", "doc"),
                       ("Workbook", "xls"), ("Book", "xls"), ("PowerPoint Document", "ppt")) if ole.exists(member)]
            if hwp:
                header = ole.openstream("FileHeader").read(256)
                if len(header) != 256 or not header.startswith(b"HWP Document File\x00"):
                    _reject()
                flags = struct.unpack_from("<I", header, 36)[0]
                # Compression is supported; protected/distribution/script/DRM
                # flags are rejected before the converter sees the document.
                if flags & ~1:
                    _reject()
                info = ole.openstream("DocInfo").read(MAX_XML + 1)
                if flags & 1:
                    inflater = zlib.decompressobj(-15)
                    info = inflater.decompress(info, MAX_XML + 1)
                    if not inflater.eof or inflater.unconsumed_tail:
                        raise OfficeError("OUTPUT_LIMIT")
                if len(info) > MAX_XML:
                    raise OfficeError("OUTPUT_LIMIT")
                binaries = {}
                for tag, record in _hwp_records(info):
                    # HWP_TAG_BIN_DATA: only embedded raster data, no linked file
                    # or embedded OLE storage that may reference another file.
                    if tag == 18:
                        if len(record) < 6:
                            raise OfficeError("INVALID_MEDIA")
                        bits, identifier, chars = struct.unpack_from("<HHH", record)
                        if bits & 15 != 1 or bits & 0x30 == 0x30 or len(record) != 6 + chars * 2:
                            _reject()
                        extension = record[6:].decode("utf-16le", errors="strict").lower()
                        if extension not in {"png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"}:
                            _reject()
                        name = f"bin{identifier:04x}.{extension}"
                        if name in binaries:
                            _reject()
                        binaries[name] = bool(flags & 1) if bits & 0x30 == 0 else bits & 0x30 == 0x10
                expanded = 0
                for path in paths:
                    if path[0] not in {"BodyText", "DocInfo", "BinData"}:
                        continue
                    compressed = bool(flags & 1)
                    if path[0] == "BinData":
                        if len(path) != 2 or path[1].lower() not in binaries:
                            _reject()
                        compressed = binaries[path[1].lower()]
                    with ole.openstream(path) as stream:
                        expanded += _bounded_stream(stream, compressed, min(MAX_INPUT, MAX_EXPANDED - expanded))
                formats.append("hwp")
            if len(formats) != 1:
                _reject()
            return formats[0]
    except (OSError, ValueError, struct.error, zlib.error):
        raise OfficeError("INVALID_MEDIA") from None


def detect(source):
    with source.open("rb") as stream:
        magic = stream.read(8)
    if not magic.startswith(b"PK\x03\x04") and magic != OLE_MAGIC:
        return None
    if not 0 < source.stat().st_size <= MAX_INPUT:
        raise OfficeError("LIMIT")
    return _zip_format(source) if magic.startswith(b"PK") else _ole_format(source)


def normalize(source, root, fmt):
    # Isolated process owns the UNO connection, job profile and all descendants.
    # The outer service also kills its process group on timeout/cancel/failure.
    result = subprocess.run(["python3", str(Path(__file__).with_name("office-convert.py")),
                             str(root), fmt], stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            timeout=120, check=False,
                            env={**os.environ, "HOME": str(root), "XDG_CACHE_HOME": str(root / "cache"),
                                 "XDG_CONFIG_HOME": str(root / "config")})
    output = root / "normalized.pdf"
    if result.returncode != 0:
        # Exit 2 is a known input/protection rejection. Startup, process death,
        # timeout and unknown UNO failures remain recoverable service failures.
        if result.returncode == 2:
            raise DefinitiveOfficeRejection("INVALID_MEDIA")
        raise OfficeError("PROCESSING_FAILED")
    if not output.is_file():
        raise OfficeError("PROCESSING_FAILED")
    if not 0 < output.stat().st_size <= MAX_INPUT:
        raise OfficeError("OUTPUT_LIMIT")
    return output
