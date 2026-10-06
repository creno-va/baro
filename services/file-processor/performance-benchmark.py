"""Opt-in, serial, synthetic-only native benchmark. Never invokes models/network.

Run with the same Python/native PATH for both versions. A fresh interpreter runs
each unit, like the service. RSS excludes Node ingress/R2/ASR/vision. No source
content, hashes, command arguments or private paths are emitted in the report.
"""
import argparse
from collections import Counter
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import resource
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageDraw, __version__ as pillow_version

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "tests/fixtures/media"
CASES = {
    "pdf-text": ("text-two-pages.pdf", [0, 1], "process"),
    "text-small": ("utf8-markers.txt", [0], "process"),
    "image-png": ("image-markers.png", [0], "process"),
    "image-jpeg": ("image-markers.jpg", [0], "process"),
    "audio-wav": ("speech-ko.wav", [0], "process"),
    "video-silent": ("scenes-silent.mp4", [0], "process"),
    "video-audio": ("scenes-speech.mp4", [0], "process"),
    "text-bounded": (None, [0, 1, 2, 3], "process"),
    "image-rgb-bounded": (None, [0], "process"),
    "video-coincident": (None, [0], "process"),
    "video-unit-boundary": (None, [0, 1], "process"),
    "audio-unit-boundary": (None, [0, 1], "process"),
    "pdf-sanitize": ("text-two-pages.pdf", [0], "sanitize"),
}


def load_processor(path):
    spec = importlib.util.spec_from_file_location("measured_processor", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def worker(args):
    module = load_processor(args.processor)
    counts = Counter()
    original = subprocess.Popen

    def counted(command, *a, **kw):
        counts[Path(command[0]).name] += 1
        return original(command, *a, **kw)

    subprocess.Popen = counted
    sys.argv = [str(args.processor), str(args.root), args.action, str(args.unit), str(args.offset)]
    started = time.perf_counter()
    code = module.main()
    elapsed = time.perf_counter() - started
    # Darwin reports bytes; Linux reports KiB. These are OS high-water marks,
    # not sampled snapshots. Child RSS is the largest individual native child.
    scale = 1 if sys.platform == "darwin" else 1024
    own = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale
    child = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * scale
    print(json.dumps({"exitCode": code, "processingSeconds": elapsed,
                      "processorPeakRssBytes": own, "largestChildPeakRssBytes": child,
                      "peakRssUpperBoundBytes": own + child, "nativeSubprocesses": dict(counts)}))


def generate(case, target):
    if case == "text-bounded":
        # Four pages, 250,000 Unicode scalars each; CR/LF, Korean and emoji.
        page = ("BARO synthetic\r\n한글 😀\t" * 12_500)[:250_000]
        target.write_bytes(("\ufeff" + "\f".join([page] * 4)).encode("utf-8"))
    elif case == "image-rgb-bounded":
        with Image.new("RGB", (3000, 2000), "white") as image:
            draw = ImageDraw.Draw(image)
            for x in range(0, 3000, 100):
                draw.rectangle((x, 100, x + 49, 1900), fill=(x % 256, 99, 201))
            image.save(target, "PNG")
    else:
        if not shutil.which("ffmpeg"):
            return False
        prefix = ["ffmpeg", "-nostdin", "-y", "-v", "error", "-threads", "1",
                  "-filter_threads", "1", "-filter_complex_threads", "1"]
        if case == "video-coincident":
            arguments = ["-f", "lavfi", "-i", "color=c=blue:s=96x64:r=10:d=2",
                         "-f", "lavfi", "-i", "color=c=red:s=96x64:r=10:d=2",
                         "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]",
                         "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-f", "mp4"]
        elif case == "video-unit-boundary":
            arguments = ["-f", "lavfi", "-i", "color=c=blue:s=96x64:r=2:d=31",
                         "-c:v", "libx264", "-g", "10", "-threads", "1",
                         "-pix_fmt", "yuv420p", "-f", "mp4"]
        elif case == "audio-unit-boundary":
            arguments = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=31",
                         "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav"]
        else:
            raise ValueError("Unknown bounded generator")
        result = subprocess.run(prefix + arguments + [str(target)], stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        if result.returncode:
            return False
    assert 0 < target.stat().st_size <= 4_000_000
    return True


def available_tools():
    result = {}
    for name, flags in {"ffmpeg": ["-version"], "ffprobe": ["-version"],
                        "pdfinfo": ["-v"], "pdftotext": ["-v"], "pdftoppm": ["-v"]}.items():
        if not shutil.which(name):
            result[name] = None
            continue
        output = subprocess.run([name] + flags, capture_output=True, timeout=10)
        result[name] = (output.stdout or output.stderr).decode(errors="replace").splitlines()[0]
    result["tesseractAvailable"] = bool(shutil.which("tesseract"))
    result["dockerAvailable"] = bool(shutil.which("docker"))
    return result


def run_version(processor, source, root, units, action):
    results, manifests, offset = [], [], 0
    for unit in units:
        job = root / str(unit)
        job.mkdir()
        shutil.copyfile(source, job / "input")
        started = time.perf_counter()
        child = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker",
                                "--processor", str(processor), "--root", str(job),
                                "--action", action, "--unit", str(unit), "--offset", str(offset)],
                               capture_output=True, timeout=120)
        wall = time.perf_counter() - started
        if child.returncode:
            raise RuntimeError("Benchmark worker failed")
        metric = json.loads(child.stdout)
        metric["wallSeconds"] = wall
        if metric["exitCode"]:
            code = json.loads((job / "error.json").read_text())["code"]
            raise RuntimeError("Native processing failed: " + code)
        manifest = json.loads((job / "manifest.json").read_text())
        results.append(metric)
        manifests.append(manifest)
        offset += manifest.get("decodedFrameCount", 0)
        for artifact in manifest.get("artifacts", []):
            assert (job / artifact["path"]).stat().st_size == artifact["byteLength"]
        if "outputBytes" in manifest:
            assert manifest["outputBytes"] == sum(a["byteLength"] for a in manifest["artifacts"])
    return results, manifests


def compare_outputs(before_root, after_root, units, before, after, action):
    # Compare the entire private manifest, including hashes, IDs, positions,
    # decoded counts, coverage and byte inventory, and each actual output byte.
    assert before == after, "Manifest/coverage equivalence failed"
    for unit, manifest in zip(units, before):
        names = [a["path"] for a in manifest.get("artifacts", [])]
        if action == "sanitize":
            names.append("sanitized.bin")
        for name in names:
            assert (before_root / str(unit) / name).read_bytes() == (after_root / str(unit) / name).read_bytes(), "Artifact equivalence failed"


def validate_coverage(case, manifests):
    if case == "pdf-sanitize":
        assert manifests[0]["probe"]["pageCount"] == 2
        return {"pageCount": 2, "operation": "sanitize"}
    category = manifests[0]["probe"]["category"]
    if category == "document":
        count = manifests[0]["probe"]["pageCount"]
        assert [m["coverage"]["pages"][0]["page"] for m in manifests] == list(range(1, count + 1))
        assert all(m["coverage"]["status"] == "complete" for m in manifests)
        return {"pageCount": count, "pagesPresent": count, "status": "complete"}
    if category == "image":
        assert manifests[0]["coverage"] == {"category": "image", "status": "partial", "observation": "missing"}
        return {"status": "partial", "observation": "missing"}
    duration = manifests[0]["probe"]["durationSeconds"]
    audio = [m["coverage"]["audio"] for m in manifests if m["coverage"]["audio"]]
    if audio:
        intervals = [a["intervals"][0] for a in audio]
        assert intervals[0]["startSeconds"] == 0 and intervals[-1]["endSeconds"] == duration
        assert all(a["endSeconds"] == b["startSeconds"] for a, b in zip(intervals, intervals[1:]))
    coverage = {"durationSeconds": duration, "status": "partial", "audioIntervals": len(audio)}
    if category == "video":
        frames = [f for m in manifests for f in m["coverage"]["frames"]]
        samples = [f for f in frames if f["sampling"] == "one_second"]
        scenes = [f for f in frames if f["sampling"] == "scene_change"]
        assert [f["timestampSeconds"] for f in samples] == list(range(math.ceil(duration)))
        if case in ("video-silent", "video-audio"):
            assert len(scenes) == 2
            assert all(abs(f["timestampSeconds"] - t) < .11 for f, t in zip(scenes, [1.4, 3.2]))
        if case == "video-coincident":
            assert [f["timestampSeconds"] for f in scenes] == [2.0]
        if case == "video-unit-boundary":
            assert [m["decodedFrameCount"] for m in manifests] == [60, 2]
            assert [f["frameIndex"] for f in samples] == list(range(0, 62, 2))
        coverage.update(oneSecondFrames=len(samples), sceneFrames=len(scenes),
                        decodedFrameCount=sum(m["decodedFrameCount"] for m in manifests))
    return coverage


def summarize(runs):
    rows = []
    for metrics in runs:
        counts = Counter()
        for metric in metrics:
            counts.update(metric["nativeSubprocesses"])
        rows.append({"wallSeconds": sum(m["wallSeconds"] for m in metrics),
                     "processingSeconds": sum(m["processingSeconds"] for m in metrics),
                     "processorPeakRssBytes": max(m["processorPeakRssBytes"] for m in metrics),
                     "largestChildPeakRssBytes": max(m["largestChildPeakRssBytes"] for m in metrics),
                     "peakRssUpperBoundBytes": max(m["peakRssUpperBoundBytes"] for m in metrics),
                     "nativeSubprocesses": dict(counts)})
    counts = rows[0]["nativeSubprocesses"]
    assert all(row["nativeSubprocesses"] == counts for row in rows)
    values = {key: {"median": statistics.median(row[key] for row in rows),
                    "min": min(row[key] for row in rows), "max": max(row[key] for row in rows)}
              for key in rows[0] if key != "nativeSubprocesses"}
    return {**values, "nativeSubprocesses": counts, "runs": rows}


def main(args):
    tools = available_tools()
    report = {"schemaVersion": 1, "syntheticOnly": True, "serial": True,
              "baselineRef": args.baseline_ref, "repetitions": args.repetitions,
              "environment": {"platform": platform.platform(), "python": platform.python_version(),
                              "pillow": pillow_version, "logicalCpuCount": os.cpu_count(), "tools": tools},
              "bounds": {"maxCaseInputBytes": 4_000_000, "maxGeneratedPixels": 6_000_000,
                         "maxMediaSeconds": 31, "maxTextPages": 4, "maxConcurrentJobs": 1,
                         "maxRepetitions": 3},
              "memoryMethod": "OS ru_maxrss: processor and largest native child separately; their sum is a conservative upper bound, not sampled process-tree peak",
              "scope": "fresh Python interpreter per unit; inspect+process, output writes/hash/manifest; excludes source staging, Node ingress, R2, model/Whisper/remote Containers",
              "results": [], "skipped": []}
    baseline, candidate = Path(args.baseline).resolve(), Path(args.candidate).resolve()
    cases = args.cases or list(CASES)
    with tempfile.TemporaryDirectory(prefix="baro-perf-") as temporary:
        root = Path(temporary)
        for case in cases:
            fixture, units, action = CASES[case]
            required = ["pdfinfo", "pdftotext"] if case == "pdf-text" else ["pdfinfo", "pdftoppm"] if case == "pdf-sanitize" else ["ffmpeg", "ffprobe"] if case.startswith(("audio-", "video-")) else []
            missing = [name for name in required if not tools[name]]
            if missing:
                report["skipped"].append({"case": case, "missingTools": missing})
                continue
            source = FIXTURES / fixture if fixture else root / (case + ".input")
            if not fixture and not generate(case, source):
                report["skipped"].append({"case": case, "reason": "bounded generator unavailable"})
                continue
            assert source.stat().st_size <= 4_000_000
            before_runs, after_runs = [], []
            for repeat in range(args.repetitions):
                paths = {label: root / (case + "-" + label + "-" + str(repeat)) for label in ["before", "after"]}
                for path in paths.values():
                    path.mkdir()
                order = [("before", baseline), ("after", candidate)]
                if repeat % 2:
                    order.reverse()
                data = {}
                for label, processor in order:
                    data[label] = run_version(processor, source, paths[label], units, action)
                before_runs.append(data["before"][0])
                after_runs.append(data["after"][0])
                before, after = data["before"][1], data["after"][1]
                compare_outputs(paths["before"], paths["after"], units, before, after, action)
                coverage = validate_coverage(case, after)
                for path in paths.values():
                    shutil.rmtree(path)
            report["results"].append({"case": case, "inputBytes": source.stat().st_size,
                                      "units": len(units), "action": action,
                                      "outputBytes": sum(m.get("outputBytes", m.get("byteLength", 0)) for m in after),
                                      "artifactCount": sum(len(m.get("artifacts", [])) for m in after),
                                      "coverage": coverage, "fullManifestAndBytesEqual": True,
                                      "before": summarize(before_runs), "after": summarize(after_runs)})
            print(case + ": measured, byte/manifest/coverage equivalence PASS", flush=True)
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--processor", help=argparse.SUPPRESS)
    parser.add_argument("--root", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--action", choices=["process", "sanitize"], default="process", help=argparse.SUPPRESS)
    parser.add_argument("--unit", type=int, default=0, help=argparse.SUPPRESS)
    parser.add_argument("--offset", type=int, default=0, help=argparse.SUPPRESS)
    parser.add_argument("--baseline")
    parser.add_argument("--baseline-ref", default="unspecified")
    parser.add_argument("--candidate", default=str(Path(__file__).with_name("processor.py")))
    parser.add_argument("--repetitions", type=int, choices=[1, 3], default=3)
    parser.add_argument("--cases", nargs="+", choices=list(CASES))
    parser.add_argument("--output", default="performance-results.json")
    args = parser.parse_args()
    if args.worker:
        worker(args)
    elif not args.baseline:
        parser.error("--baseline is required; use a source copy from the base revision")
    elif args.cases and len(set(args.cases)) != len(args.cases):
        parser.error("each bounded case may be selected only once")
    else:
        main(args)
