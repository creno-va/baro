"""Pinned, bounded HEIC decode into new RGB pixels. No EXIF/ICC/XMP is copied."""
import json
from pathlib import Path
import subprocess
import tempfile

from PIL import Image

MAX_BYTES = 100_000_000
MAX_PIXELS = 40_000_000
NATIVE = "/app/heif-native"
HEVC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs"}


class HeifError(Exception):
    def __init__(self):
        super().__init__("INVALID_MEDIA")


def is_heic(source):
    """Actual HEVC-compatible ftyp brand, never extension/MIME or AVIF."""
    with Path(source).open("rb") as handle:
        header = handle.read(4096)
    if len(header) < 16 or header[4:8] != b"ftyp":
        return False
    size = int.from_bytes(header[:4], "big")
    if size < 16 or size > len(header) or size % 4:
        return False
    return header[8:12] in HEVC_BRANDS or any(
        header[index:index + 4] in HEVC_BRANDS for index in range(16, size, 4)
    )


def _metadata(value):
    if not isinstance(value, dict) or set(value) != {"width", "height", "multiFrame"}:
        raise HeifError()
    width, height = value["width"], value["height"]
    if (type(width) is not int or type(height) is not int or
            not 1 <= width <= MAX_PIXELS or not 1 <= height <= MAX_PIXELS or
            width * height > MAX_PIXELS or type(value["multiFrame"]) is not bool):
        raise HeifError()
    return value


def _run(source, output=None):
    try:
        source = Path(source)
        if not 0 < source.stat().st_size <= MAX_BYTES or not is_heic(source):
            raise HeifError()
        arguments = [NATIVE, "probe" if output is None else "decode", str(source)]
        if output is not None:
            arguments.append(str(output))
        result = subprocess.run(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=60, check=False)
        if result.returncode or len(result.stdout) > 256:
            raise HeifError()
        return _metadata(json.loads(result.stdout))
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise HeifError() from None


def inspect_heic(source):
    return _run(source)


def open_primary(source, root):
    """Return (detached RGB image, multiFrame); primary only is always partial."""
    before = inspect_heic(source)
    with tempfile.TemporaryDirectory(prefix="heic-", dir=root) as temporary:
        output = Path(temporary) / "primary.ppm"
        after = _run(source, output)
        try:
            if after != before or not 0 < output.stat().st_size <= MAX_PIXELS * 3 + 64:
                raise HeifError()
            with Image.open(output) as image:
                if (image.format != "PPM" or image.mode != "RGB" or
                        image.size != (before["width"], before["height"])):
                    raise HeifError()
                image.load()
                detached = image.copy()
                detached.info.clear()
        except (OSError, ValueError):
            raise HeifError() from None
    return detached, before["multiFrame"]
