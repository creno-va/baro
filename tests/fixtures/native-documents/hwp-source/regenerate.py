#!/usr/bin/env python3
"""Build blank HWP/HWPX objects from pinned source and write synthetic fixtures offline."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
SOURCES = json.loads((HERE / "sources.json").read_text())
MARKERS = [
    "합성 자료 첫째 쪽", "BLUEBOX17", "합성 표", "ORANGECIRCLE42",
    "합성 자료 둘째 쪽", "END_NATIVE_DOCUMENT",
]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def library_sources(archive_dir, work):
    files = []
    for library, source in SOURCES.items():
        archive = archive_dir / source["archive"]
        if sha256(archive) != source["sha256"]:
            raise RuntimeError(f"Pinned {library} source archive checksum mismatch")
        prefix = f'{library}-{source["commit"]}/'
        with tarfile.open(archive, "r:gz") as tar:
            for entry in tar.getmembers():
                if not entry.isfile() or not entry.name.startswith(prefix):
                    continue
                relative = Path(entry.name.removeprefix(prefix))
                # No upstream sample HWP/HWPX or other document contents are extracted.
                wanted = (str(relative).startswith("src/main/java/") and relative.suffix == ".java")
                wanted |= library == "hwplib" and str(relative) == "src/test/sample/Inserting_Table.java"
                if not wanted:
                    continue
                if relative.is_absolute() or ".." in relative.parts:
                    raise RuntimeError("Unexpected source path")
                target = work / library / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                stream = tar.extractfile(entry)
                if stream is None:
                    raise RuntimeError("Missing pinned source entry")
                target.write_bytes(stream.read())
                files.append(target)
    return sorted(files)


def normalize_hwpx(path):
    # Only ZIP wrapper timestamps/attributes/compression are normalized. XML is unmodified.
    with zipfile.ZipFile(path) as source:
        members = [(info.filename, source.read(info)) for info in source.infolist()]
    normalized = path.with_suffix(".normalized.hwpx")
    members.sort(key=lambda item: (item[0] != "mimetype", item[0]))
    with zipfile.ZipFile(normalized, "w") as target:
        for name, body in members:
            info = zipfile.ZipInfo(name, (2000, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED if name == "mimetype" else zipfile.ZIP_DEFLATED
            target.writestr(info, body, compresslevel=9)
    normalized.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=HERE.parent)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, "TZ": "UTC", "LC_ALL": "C.UTF-8"}
    with tempfile.TemporaryDirectory(prefix="baro-hwp-synthetic-") as temporary:
        work = Path(temporary)
        sources = library_sources(args.archive_dir.resolve(), work)
        sources += [HERE / "GenerateHwp.java", HERE / "GenerateHwpx.java"]
        arguments = work / "sources.txt"
        arguments.write_text("\n".join(json.dumps(str(path)) for path in sources))
        classes = work / "classes"
        classes.mkdir()
        subprocess.run(["javac", "-encoding", "UTF-8", "--release", "8", "-d", str(classes), f"@{arguments}"], check=True, env=environment)
        fixtures = []
        for extension, generator in [("hwp", "GenerateHwp"), ("hwpx", "GenerateHwpx")]:
            first, second = work / f"first.{extension}", work / f"second.{extension}"
            for path in (first, second):
                subprocess.run(["java", "-cp", str(classes), generator, str(path)], check=True, env=environment)
                if extension == "hwpx":
                    normalize_hwpx(path)
            if first.read_bytes() != second.read_bytes():
                raise RuntimeError(f"Synthetic {extension} output is not byte reproducible")
            target = output / f"synthetic-two-page.{extension}"
            target.write_bytes(first.read_bytes())
            fixtures.append({"file": target.name, "sha256": sha256(target), "bytes": target.stat().st_size})
        manifest = {
            "synthetic": True,
            "expectedPages": 2,
            "expectedTable": {"rows": 2, "columns": 2},
            "expectedMarkers": MARKERS,
            "generationChecks": ["source archive SHA-256", "own document readback", "page-break structure", "all markers", "two independent writes have identical bytes"],
            "renderVerification": "separate converter regression; generation alone does not verify rendered pagination",
            "sources": SOURCES,
            "fixtures": fixtures,
        }
        (output / "hwp-source" / "manifest.json").parent.mkdir(parents=True, exist_ok=True)
        (output / "hwp-source" / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"syntheticFixtures": fixtures}, ensure_ascii=False))


if __name__ == "__main__":
    main()
