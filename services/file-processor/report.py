"""Offline HTML -> PDF. No scripts, network or arbitrary file resource loading."""
import base64
import io
import hashlib
import json
import sys
import warnings
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote_to_bytes

from PIL import Image, ImageOps
from weasyprint import HTML

Image.MAX_IMAGE_PIXELS = 25_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)
MAX_INPUT = 20_000_000
MAX_OUTPUT = 24_000_000


def resource(url):
    if not url.startswith("data:") or len(url) > 14_000_000:
        raise ValueError("RESOURCE_DENIED")
    header, encoded = url.split(",", 1)
    mime = header[5:].split(";")[0]
    data = base64.b64decode(encoded, validate=True) if header.endswith(";base64") else unquote_to_bytes(encoded)
    if mime == "font/ttf" and 1000 <= len(data) <= 4_000_000:
        return {"string": data, "mime_type": mime}
    if mime == "image/svg+xml" and len(data) < 4096:
        # Only the constant, escaped application logo is generated as SVG.
        if hashlib.sha256(data).hexdigest() != "62a9350c6538fd572dfae9a6dcd2b0d981291ec602d4b1b31be6cf080055aef0":
            raise ValueError("RESOURCE_DENIED")
        return {"string": data, "mime_type": mime}
    if mime not in ("image/jpeg", "image/png", "image/webp") or len(data) > 5_000_000:
        raise ValueError("RESOURCE_DENIED")
    image = Image.open(io.BytesIO(data))
    if image.format not in ("JPEG", "PNG", "WEBP") or getattr(image, "n_frames", 1) != 1:
        raise ValueError("INVALID_MEDIA")
    image = ImageOps.exif_transpose(image)
    image.thumbnail((2200, 2200))
    background = Image.new("RGB", image.size, "white")
    rgba = image.convert("RGBA")
    background.paste(rgba, mask=rgba.getchannel("A"))
    output = io.BytesIO()
    background.save(output, format="JPEG", quality=90)
    return {"string": output.getvalue(), "mime_type": "image/jpeg"}


class Images(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "iframe", "object", "embed", "base", "link"):
            raise ValueError("RESOURCE_DENIED")
        if tag == "img":
            self.urls.append(dict(attrs).get("src", ""))


def render(source):
    if len(source.encode("utf-8")) > MAX_INPUT or 'data-baro-report="1"' not in source:
        raise ValueError("LIMIT")
    images = Images()
    images.feed(source)
    if len(images.urls) > 13:
        raise ValueError("LIMIT")
    # WeasyPrint treats unavailable images as nonfatal. Validate every image
    # first so a selected medical/evidence photo can never silently disappear.
    resources = {url: resource(url) for url in images.urls}

    def fetch(url):
        return resources[url] if url in resources else resource(url)

    document = HTML(string=source, url_fetcher=fetch).render()
    if len(document.pages) > 100:
        raise ValueError("OUTPUT_LIMIT")
    output = document.write_pdf()
    if len(output) > MAX_OUTPUT:
        raise ValueError("OUTPUT_LIMIT")
    return output


if __name__ == "__main__":
    root = Path(sys.argv[1])
    try:
        if (root / "input").stat().st_size > MAX_INPUT:
            raise ValueError("LIMIT")
        (root / "report.pdf").write_bytes(render((root / "input").read_text(encoding="utf-8")))
    except Exception:
        (root / "error.json").write_text(json.dumps({"code": "INVALID_MEDIA"}))
        sys.exit(1)
