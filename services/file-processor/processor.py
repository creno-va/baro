"""Offline native extraction. No network/model access, input names or content logs.

The parent enforces a whole-job timeout and destroys this job's private directory.
Only PDF/text, supported raster codecs and FFmpeg-readable media are processed;
office/HWP archives are explicitly unsupported, never mislabeled as complete.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import io
import wave
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000
MAX_ARTIFACT = 1_048_576
MAX_OUTPUT = 536_870_912
# Technical scene candidates, not a claim that every semantic scene is detectable.
# 0.05 catches the corpus's measured 0.097842/0.089128 changes after 160x90 scaling.
SCENE_SCORE_THRESHOLD = 0.05
TEXT_CHUNK = 65_536
INVALID_TEXT_CONTROL = re.compile(r"[\x00-\x08\x0b\x0e-\x1f]")


class Rejected(Exception):
    pass


def command(args, timeout=60):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=timeout, check=False,
                            env={**os.environ, "OMP_THREAD_LIMIT": "1"})
    if result.returncode != 0 or len(result.stdout) > MAX_ARTIFACT:
        raise Rejected("INVALID_MEDIA")
    return result.stdout


def ffmpeg(source, args, seek=None):
    prefix = ["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1"]
    if seek is not None and seek > 0:
        prefix += ["-ss", str(seek)]
    return command(prefix + ["-i", str(source), "-threads", "1"] + args)


def text_chunks(source):
    # Preserve CR/LF and strip only the leading UTF-8 BOM, as the byte decoder did.
    with source.open("r", encoding="utf-8-sig", errors="strict", newline="") as handle:
        for chunk in iter(lambda: handle.read(TEXT_CHUNK), ""):
            yield chunk


def text_page_chunks(source, unit):
    page = 0
    for chunk in text_chunks(source):
        parts = chunk.split("\f")
        for index, part in enumerate(parts):
            if page == unit:
                yield part
            if index < len(parts) - 1:
                if page == unit:
                    return
                page += 1


def inspect(source):
    size = source.stat().st_size
    if size < 1 or size > 1_000_000_000:
        raise Rejected("LIMIT")
    with source.open("rb") as handle:
        magic = handle.read(16)
    if magic.startswith(b"%PDF-"):
        info = command(["pdfinfo", str(source)]).decode("utf-8", errors="strict")
        pages = re.search(r"^Pages:\s+(\d+)\s*$", info, re.M)
        if not pages or not 1 <= int(pages[1]) <= 500 or size > 100_000_000:
            raise Rejected("LIMIT")
        return dict(category="document", format="pdf", byteLength=size, pageCount=int(pages[1]))
    if magic.startswith((b"PK\x03\x04", b"\xd0\xcf\x11\xe0")):
        raise Rejected("UNSUPPORTED_FORMAT")
    try:
        with Image.open(source) as image:
            formats = {"JPEG": "jpeg", "PNG": "png", "WEBP": "webp", "GIF": "gif",
                       "BMP": "bmp", "TIFF": "tiff"}
            if image.format not in formats or size > 100_000_000:
                raise Rejected("UNSUPPORTED_FORMAT")
            width, height = image.size
            if width * height > 40_000_000 or width < 1 or height < 1:
                raise Rejected("LIMIT")
            image.verify()
            return dict(category="image", format=formats[image.format], byteLength=size,
                        width=width, height=height)
    except (OSError, ValueError):
        pass
    # Text is detected by actual UTF-8/control validation, not extension or MIME.
    if size <= 100_000_000:
        try:
            pages, nonempty, valid = 1, False, True
            for chunk in text_chunks(source):
                nonempty = True
                if INVALID_TEXT_CONTROL.search(chunk):
                    valid = False
                    break
                pages += chunk.count("\f")
            if nonempty and valid:
                if pages > 100_000:
                    raise Rejected("LIMIT")
                return dict(category="document", format="txt", byteLength=size, pageCount=pages)
        except UnicodeDecodeError:
            pass
    try:
        info = json.loads(command(["ffprobe", "-v", "error", "-threads", "1", "-protocol_whitelist", "file,pipe",
                                   "-show_entries", "format=format_name,duration,start_time:stream=codec_type,width,height,r_frame_rate,start_time",
                                   "-of", "json", str(source)]))
    except (ValueError, Rejected):
        raise Rejected("INVALID_MEDIA") from None
    duration = float(info["format"].get("duration", 0))
    if not math.isfinite(duration) or duration <= 0 or duration > 3600:
        raise Rejected("LIMIT")
    # This extractor currently requires a zero-based media timeline. Do not fabricate
    # coverage for streams with edit-list/time-base offsets we have not normalized.
    origin = float(info["format"].get("start_time", 0))
    if not math.isfinite(origin) or abs(origin) > .001:
        raise Rejected("UNSUPPORTED_TIMELINE")
    streams = info.get("streams", [])
    if len(streams) > 16:
        raise Rejected("LIMIT")
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    names = info["format"]["format_name"].split(",")
    if video:
        start = float(video.get("start_time", 0))
        if not math.isfinite(start) or abs(start) > .001:
            raise Rejected("UNSUPPORTED_TIMELINE")
        if video.get("width", 0) * video.get("height", 0) > 40_000_000:
            raise Rejected("LIMIT")
        formats = [n for n in ["mp4", "mov", "webm", "avi", "matroska"] if n in names]
        if not formats:
            raise Rejected("UNSUPPORTED_FORMAT")
        return dict(category="video", format="mkv" if formats[0] == "matroska" else formats[0],
                    byteLength=size, durationSeconds=duration, hasAudio=has_audio)
    formats = [n for n in ["mp3", "wav", "m4a", "ogg", "flac", "aac"] if n in names]
    if "mov" in names and has_audio:
        formats = ["m4a"]
    if not formats or not has_audio:
        raise Rejected("UNSUPPORTED_FORMAT")
    return dict(category="audio", format=formats[0], byteLength=size, durationSeconds=duration)


def normalized_rgb(image):
    image.load()
    if image.getexif().get(274, 1) in (2, 3, 4, 5, 6, 7, 8):
        image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        flattened = Image.new("RGB", image.size, "white")
        flattened.paste(rgba, mask=rgba.getchannel("A"))
        return flattened
    return image if image.mode == "RGB" else image.convert("RGB")


def process(source, root, probe, unit, frame_offset):
    artifacts = []
    output_bytes = 0

    def artifact(path, kind, position, **extra):
        nonlocal output_bytes
        size = path.stat().st_size
        if not 0 < size <= MAX_ARTIFACT or output_bytes + size > MAX_OUTPUT or len(artifacts) >= 20_000:
            raise Rejected("OUTPUT_LIMIT")
        output_bytes += size
        artifacts.append(dict(index=len(artifacts), kind=kind, position=position, byteLength=size,
                              contentHash=hashlib.sha256(path.read_bytes()).hexdigest(),
                              path=path.name, **extra))

    def text_artifacts(chunks, position):
        # Keep every character. Split on Unicode scalar boundaries below wire/artifact caps.
        pending = ""
        def emit(text):
            path = root / ("artifact-%06d.txt" % len(artifacts))
            path.write_text(text, encoding="utf-8")
            artifact(path, "extracted_text", position)
        for chunk in chunks:
            pending += chunk
            while len(pending) >= 100_000:
                emit(pending[:100_000])
                pending = pending[100_000:]
        if pending:
            emit(pending)

    category = probe["category"]
    total_units = probe["pageCount"] if category == "document" else 1 if category == "image" else math.ceil(probe["durationSeconds"] / 30)
    if unit < 0 or unit >= total_units:
        raise Rejected("INVALID_UNIT")
    pages = []
    if category == "document":
        is_text = probe["format"] == "txt"
        pages = [dict(page=unit + 1, status="missing")]
        for page in [unit + 1]:
            position = dict(kind="document", page=page, paragraph=None, table=None)
            text = "" if is_text else command([
                "pdftotext", "-f", str(page), "-l", str(page), "-enc", "UTF-8", str(source), "-"
            ]).decode("utf-8", errors="strict").rstrip("\f")
            status = "processed"
            # Text headers do not prove that an embedded scanned body was read.
            images = "" if is_text else command([
                "pdfimages", "-f", str(page), "-l", str(page), "-list", str(source)
            ]).decode("utf-8", errors="strict")
            has_images = any(re.match(r"^\s*\d+\s+\d+\s+", line) for line in images.splitlines())
            if not is_text and (not text.strip() or has_images):
                image_base = root / "ocr-page"
                command(["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile", "-scale-to", "1800",
                         "-png", str(source), str(image_base)])
                ocr = command(["tesseract", str(image_base) + ".png", "stdout", "-l", "kor+eng"]).decode("utf-8")
                text = text + "\n" + ocr if text.strip() else ocr
                (root / "ocr-page.png").unlink(missing_ok=True)
                # OCR is uncertain; native text absence is never perfect page coverage.
                status = "low_quality"
            if is_text:
                text_artifacts(text_page_chunks(source, unit), position)
            elif text:
                text_artifacts([text], position)
            pages[0] = dict(page=page, status=status)
        coverage = dict(category="document", status="complete" if all(p["status"] == "processed" for p in pages) else "partial",
                        pageCount=probe["pageCount"], pages=pages)
    elif category == "image":
        path = root / "artifact-000000.jpg"
        with Image.open(source) as image:
            # EXIF/ICC are not passed to the JPEG encoder; GIF/TIFF first frame => partial.
            multi = getattr(image, "n_frames", 1) > 1
            # Decode before thumbnail so JPEG draft/downsampling cannot change pixels.
            # An already RGB raster needs no full-size copy from convert("RGB").
            image = normalized_rgb(image)
            image.thumbnail((1600, 1600))
            image.save(path, "JPEG", quality=80)
        artifact(path, "image", dict(kind="image", region=None), multiFrame=multi)
        coverage = dict(category="image", status="partial", observation="missing")
    else:
        duration = probe["durationSeconds"]
        if category == "audio" or probe["hasAudio"]:
            for start in [unit * 30]:
                end = min(start + 30, duration)
                path = root / ("artifact-%06d.wav" % len(artifacts))
                ffmpeg(source, ["-ss", str(start), "-t", str(end - start), "-map", "0:a:0", "-vn",
                                "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", str(path)])
                # AAC edit lists/encoder priming are lost when FFmpeg receives
                # input -ss (including nonzero unit boundaries). Decode audio with
                # output-side sample-accurate trimming, then measure
                # actual PCM instead of labelling the requested interval complete.
                with wave.open(str(path), "rb") as pcm:
                    if pcm.getframerate() != 16000 or pcm.getnchannels() != 1 or pcm.getsampwidth() != 2:
                        raise Rejected("INVALID_MEDIA")
                    samples = pcm.getnframes()
                expected = round((end - start) * 16000)
                if samples < expected - 1 or samples > expected + 1:
                    raise Rejected("AUDIO_COVERAGE_MISMATCH")
                artifact(path, "audio", dict(kind="audio", startSeconds=start,
                                            endSeconds=min(end, start + samples / 16000)))
        audio = dict(durationSeconds=duration, status="partial", intervals=[dict(startSeconds=unit * 30,
                     endSeconds=min((unit+1)*30,duration), status="missing")]) if category == "audio" or probe["hasAudio"] else None
        if category == "audio":
            coverage = dict(category="audio", audio=audio)
        else:
            # Tiny scene detector output: select reduced grayscale frames and log only timestamp metadata.
            scene_meta = root / "scenes.txt"
            scene_start = max(0, unit * 30 - 1)
            ffmpeg(source, ["-t", str(min((unit + 1) * 30, duration) - scene_start), "-an", "-vf", "scale=160:90,select='gt(scene,%s)',metadata=print:file=" % SCENE_SCORE_THRESHOLD + str(scene_meta),
                            "-f", "null", "-"], seek=scene_start)
            timestamps = [float(t) + scene_start for t in re.findall(r"pts_time:([0-9.]+)", (scene_meta.read_text() if scene_meta.exists() else ""))]
            timestamps = [t for t in timestamps if unit * 30 <= t < min((unit + 1) * 30, duration)]
            if len(timestamps) > 16_400 or any(not math.isfinite(t) or t < 0 or t >= duration for t in timestamps):
                raise Rejected("OUTPUT_LIMIT")
            frames = []
            rendered = {}
            for sampling, times in [("one_second", range(unit * 30, min((unit + 1) * 30, math.ceil(duration)))), ("scene_change", timestamps)]:
                for timestamp in times:
                    path = root / ("artifact-%06d.jpg" % len(artifacts))
                    if timestamp in rendered:
                        # Keep both artifacts/coverage entries; only identical decoder work is reused.
                        shutil.copyfile(rendered[timestamp], path)
                    else:
                        ffmpeg(source, ["-an", "-frames:v", "1", "-vf", "scale=640:640:force_original_aspect_ratio=decrease",
                                        "-q:v", "5", str(path)], seek=timestamp)
                        rendered[timestamp] = path
                    # Actual index is resolved from this unit's decoder timestamps below.
                    # The authenticated preceding unit count supplies the absolute offset.
                    position = dict(kind="video", timestampSeconds=timestamp, frameIndex=0, sampling=sampling)
                    artifact(path, "frame", position)
                    frames.append(dict(id="frame-%06d" % (len(artifacts) - 1), **{k: position[k] for k in ["timestampSeconds", "frameIndex", "sampling"]}, status="missing"))
            # Decode only this 30-second interval, never the entire video per unit.
            # A spool avoids capturing pixels or an unbounded subprocess stdout.
            frame_index = root / "frame-index.txt"
            with frame_index.open("wb") as spool:
                result = subprocess.run(["ffprobe", "-v", "error", "-threads", "1", "-protocol_whitelist", "file,pipe", "-select_streams", "v:0",
                                         "-read_intervals", "%s%%%s" % (unit * 30, min((unit + 1) * 30, duration)),
                                         "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", str(source)],
                                        stdout=spool, stderr=subprocess.DEVNULL, timeout=90)
            if result.returncode or frame_index.stat().st_size > 64_000_000:
                raise Rejected("OUTPUT_LIMIT")
            indexed = []
            with frame_index.open() as spool:
                for line in spool:
                    value = line.strip().split(",")[0]
                    if value:
                        t = float(value)
                        if not math.isfinite(t) or (indexed and t < indexed[-1]):
                            raise Rejected("INVALID_MEDIA")
                        if t < unit * 30 or t >= min((unit + 1) * 30, duration):
                            continue
                        indexed.append(t)
                        if len(indexed) > 10_000_000:
                            raise Rejected("OUTPUT_LIMIT")
            if not indexed or frame_offset + len(indexed) > 10_000_000:
                raise Rejected("OUTPUT_LIMIT")
            import bisect
            for record in artifacts:
                if record["kind"] == "frame":
                    record["position"]["frameIndex"] = frame_offset + max(0, min(len(indexed) - 1, bisect.bisect_left(indexed, record["position"]["timestampSeconds"])))
            for frame in frames:
                frame["frameIndex"] = artifacts[int(frame["id"].split("-")[1])]["position"]["frameIndex"]
            all_frames = frames
            coverage = dict(category="video", durationSeconds=duration, status="partial", hasAudio=probe["hasAudio"],
                            audio=audio, frames=all_frames, sceneDetection="complete", sceneFrameCount=len(timestamps))
    return dict(version=1, unit=unit, totalUnits=total_units, frameOffset=frame_offset, decodedFrameCount=len(indexed) if category == "video" else 0, probe=probe, coverage=coverage, artifacts=artifacts, outputBytes=output_bytes)


def sanitize(source, root, probe):
    """A new image-only document: no source PDF objects/attachments/actions copied.

    Page pixels are processed one at a time and the output is capped at 100 MB.
    The supervising native timeout applies even to valid maximum-sized inputs.
    """
    if probe["byteLength"] > 100_000_000:
        raise Rejected("LIMIT")
    target = root / "sanitized.bin"

    def jpeg(image):
        flattened = normalized_rgb(image)
        flattened.thumbnail((1800, 1800))
        flattened.info.clear()
        payload = io.BytesIO()
        # Fresh RGB pixels; no EXIF, ICC, comment or source metadata is passed.
        flattened.save(payload, "JPEG", quality=82, optimize=False)
        return payload.getvalue(), flattened.width, flattened.height

    if probe["category"] == "image":
        with Image.open(source) as image:
            image.seek(0)
            content, _, _ = jpeg(image)
        target.write_bytes(content)
        fmt = "jpeg"
    elif probe["category"] == "document" and probe["format"] == "pdf":
        count = probe["pageCount"]
        offsets = [0] * (3 + count * 3)
        with target.open("wb") as output:
            def write(value):
                if output.tell() + len(value) > 100_000_000:
                    raise Rejected("OUTPUT_LIMIT")
                output.write(value)

            def obj(number, value):
                offsets[number] = output.tell()
                write(("%d 0 obj\n" % number).encode() + value + b"\nendobj\n")

            write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
            obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")
            children = " ".join("%d 0 R" % (3 + page * 3) for page in range(count))
            obj(2, ("<< /Type /Pages /Count %d /Kids [%s] >>" % (count, children)).encode())
            for page in range(count):
                prefix = root / "sanitized-page"
                command(["pdftoppm", "-f", str(page + 1), "-l", str(page + 1),
                         "-scale-to", "1800", "-singlefile", "-png", str(source), str(prefix)])
                raster = prefix.with_suffix(".png")
                if raster.stat().st_size > 32_000_000:
                    raise Rejected("OUTPUT_LIMIT")
                with Image.open(raster) as image:
                    content, width, height = jpeg(image)
                raster.unlink()
                number = 3 + page * 3
                # Dimensions originate only from decoded raster, not source strings.
                obj(number, ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
                             "/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>"
                             % (width, height, number + 1, number + 2)).encode())
                obj(number + 1, ("<< /Type /XObject /Subtype /Image /Width %d /Height %d "
                                  "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n"
                                  % (width, height, len(content))).encode() + content + b"\nendstream")
                drawing = ("q %d 0 0 %d 0 0 cm /Im0 Do Q\n" % (width, height)).encode()
                obj(number + 2, ("<< /Length %d >>\nstream\n" % len(drawing)).encode() + drawing + b"endstream")
            xref = output.tell()
            write(("xref\n0 %d\n0000000000 65535 f \n" % len(offsets)).encode())
            for offset in offsets[1:]:
                write(("%010d 00000 n \n" % offset).encode())
            write(("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(offsets), xref)).encode())
        fmt = "pdf"
    else:
        raise Rejected("UNSUPPORTED_FORMAT")
    size = target.stat().st_size
    if not 1 <= size <= 100_000_000:
        raise Rejected("OUTPUT_LIMIT")
    hasher = hashlib.sha256()
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(MAX_ARTIFACT), b""):
            hasher.update(chunk)
    return dict(version=1, passes=2, probe=probe, format=fmt, byteLength=size,
                contentHash=hasher.hexdigest(), chunkCount=math.ceil(size / MAX_ARTIFACT))


def main():
    root = Path(sys.argv[1]).resolve()
    source = root / "input"
    try:
        probe = inspect(source)
        if sys.argv[2] == "probe":
            result = dict(version=1, probe=probe)
        elif sys.argv[2] == "sanitize":
            result = sanitize(source, root, probe)
        else:
            result = process(source, root, probe, int(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 0)
        (root / "manifest.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    except Exception as error:
        # Never expose native errors, filenames, extracted text, paths, or stack traces.
        code = str(error) if isinstance(error, Rejected) else "PROCESSING_FAILED"
        (root / "error.json").write_text(json.dumps({"code": code}), encoding="utf-8")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
