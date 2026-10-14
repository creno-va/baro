# Synthetic HWP and HWPX source fixtures

These fixtures are constructed from blank document objects. They contain only the synthetic Korean text and marker strings listed in `manifest.json`. No customer document, upstream example document, personal information, credential, or legal advice is used.

Both documents contain two top-level paragraphs separated by an explicit page break and a real 2 × 2 table in the first paragraph. The intended rendered result is exactly two pages:

| Page | Required content |
| --- | --- |
| 1 | `합성 자료 첫째 쪽`, `BLUEBOX17`; table cells `합성 표`, `ORANGECIRCLE42`, `합성 항목`, `합성 값 42` |
| 2 | `합성 자료 둘째 쪽`, `END_NATIVE_DOCUMENT` |

## Source provenance

`sources.json` pins the full commit, archive URL, version, and SHA-256 of [neolord0/hwplib](https://github.com/neolord0/hwplib) and [neolord0/hwpxlib](https://github.com/neolord0/hwpxlib). Both libraries are by Park Sung Kyon / neolord0 and are licensed under Apache-2.0; a copy is included as `APACHE-2.0.txt`.

`GenerateHwp.java` starts with `BlankFileMaker.make()` and invokes only the table-construction method in the pinned `src/test/sample/Inserting_Table.java`. It never invokes that example's entry point or reads its input file. All four temporary example cell strings are replaced with the synthetic strings before the fixture is written. The generated HWP has no default script payload. `GenerateHwpx.java` starts with its library's `BlankFileMaker.make()` and builds the table directly through the object API.

The Python driver extracts only library Java source and the single HWP table-construction Java source from the verified archives. It does not extract or use upstream sample HWP/HWPX files. No third-party document is a fixture input.

## Regenerate

Use Python 3.9 or newer and JDK 21. Place the exact archives from `sources.json` in one directory named `hwplib.tar.gz` and `hwpxlib.tar.gz`. The driver rejects any archive whose SHA-256 differs from the pin. Generation itself requires no network, Maven, or external service:

```sh
JAVA_TOOL_OPTIONS=-Xmx512m python3 tests/fixtures/native-documents/hwp-source/regenerate.py \
  --archive-dir /path/to/pinned-archives
```

The checked-in originals were generated in the repository's `services/file-processor/Dockerfile` `hwp-build` stage: Node 24 Debian trixie slim base digest `sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66`, with `default-jdk-headless=2:1.21-76` (OpenJDK 21). The generation container ran as Linux amd64 with networking disabled, no host directory mounts, one CPU, a 768 MiB memory limit, and a 512 MiB JVM heap limit. The stage can be built with:

```sh
docker build --platform linux/amd64 --target hwp-build \
  -t baro-native-documents-hwp-build -f services/file-processor/Dockerfile .
```

The default output directory is `tests/fixtures/native-documents`. Use `--output-dir /path/to/output` to generate elsewhere. The driver compiles the pinned libraries and these two generators with `javac --release 8`, writes each format twice, and fails unless both writes have identical bytes. Each Java generator reads its own output back and checks the expected paragraph/page-break structure and all six required markers. The manifest records output sizes and SHA-256 hashes.

HWPX metadata dates are the fixed synthetic value `2000-01-01T00:00:00Z`. The driver normalizes only the ZIP wrapper timestamps, member ordering, permissions, and compression; it leaves the generated XML unchanged. The `mimetype` member remains first and uncompressed. These fixed fixture dates are unrelated to production observations or operational evidence.

Generation and readback checks establish reproducible source artifacts. They do **not** prove rendered pagination, visual layout, conversion success, upload processing, or external integration. Those results belong to the separate native document converter regression and actual preview acceptance checks.
