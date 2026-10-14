# Native document and image processing

This standalone Linux amd64 Container implements the existing file contracts;
it makes no model or legal-provider calls. The Worker disables Container
internet access and injects no environment credentials. Each request runs as
`node` in its own temporary directory; the existing server deadline kills the
whole process group and removes that directory on success, failure or abort.

Office/HWP files retain their original bytes/hash. A private PDF is made for
each invocation and the existing PDF page extractor handles the requested
unit. It checks the **actual resulting page count**, capped at 500. No page is
silently omitted. No conversion is reused across requests or authorization
boundaries. Thus an N-page Office input currently converts once for probe and
again for each of its N extraction units; local measurements must not be called
cloud timings or hidden by a cross-request cache.

The preflight checks actual ZIP/OLE contents, input ≤100 MB, package entries
≤20,000, total expanded bytes ≤512 MiB, XML per entry ≤8 MiB/aggregate ≤32 MiB,
and HWP's real bounded deflate streams. Encrypted/protected files, macros, OLE
embeddings, external relationships, active fields, DTD/entities and path
traversal are rejected. An entirely empty XLSX `workbookProtection` element is
an unprotected placeholder; lock/password/algorithm fields are rejected.
Legacy spreadsheet protection is also checked through the loaded document.
LibreOffice loads read-only with `MacroExecutionMode=NEVER_EXECUTE` and
`UpdateDocMode=NO_UPDATE`. Only a PDF is exported. Native child output is private
and discarded; fixed codes distinguish known input rejection from converter
unavailability. There are no automatic retries or increased server deadlines.

HEIC uses the primary image only. Multiple images or sequence tracks are
marked as multiple-frame content, never complete multi-frame coverage. The
pinned decoder checks dimensions before allocation, limits input to 100 MB and
pixels to 40 million, and produces new RGB pixels with alpha flattened on white.
EXIF/ICC/XMP are not carried to JPEG output. The existing image interpretation
and partial-coverage contract remains unchanged.

## Pinned dependencies and source

- Official Node 24 `trixie-slim` image digest:
  `sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66`.
- Debian LibreOffice/UNO `4:25.2.3-2+deb13u8`, python3-olefile `0.47-1`,
  Noto CJK `1:20240730+repack1-1`, JRE `2:1.21-76`. The Debian
  [LibreOffice security tracker](https://security-tracker.debian.org/tracker/source-package/libreoffice)
  identifies fixed trixie packages for the current PICT/WMF/CFF and external-link
  fixes; the old bookworm package was not retained for this new converter.
- [H2Orestart v0.7.14](https://github.com/ebandal/H2Orestart/releases/tag/v0.7.14)
  GPL-3.0 extension and corresponding tag source are downloaded and SHA-256
  verified in the Dockerfile. `build-hwp.py` applies two explicit source changes:
  disable/remove Java logging handlers, and prohibit DTD/external entities,
  XInclude and external schema access in the HWPX parser. Patched source and
  upstream COPYING are included in `/usr/share/doc/baro-h2orestart-source`.
- [libheif 1.23.6](https://github.com/strukturag/libheif/releases/tag/v1.23.6)
  and [libde265 1.1.3](https://github.com/strukturag/libde265/releases/tag/v1.1.3)
  are built from official release tarballs with exact SHA-256 pins. Only the
  HEVC decoder is enabled; plugin loading, parallel tiles and encoders are off.
  Their upstream COPYING files are included in `/opt/baro-heif/licenses`.
  Old distro codec versions with unresolved entries in the Debian security
  trackers are not used. Single-thread libheif compilation limits build load;
  local qemu/GCC emulation still showed an internal compiler crash. It does not
  change decoder behavior or replace the required native amd64 CI build.

The security references describe the package selection, not a claim that any
native parser is free of vulnerabilities. Container isolation, limits and input
checks remain mandatory.

## Verification

`bun run validate:native` (or `bun scripts/validate.ts native`) builds the actual
image and runs the synthetic PDF/OCR/image/audio/video corpus, bounded media
performance regressions, HEIC decoder tests and Office package/conversion
tests with networking disabled. No source text, native error, original image,
audio, hash, or stack is printed by product logging. Test output contains only
fixed case/stage names, counts, bounded durations and pass/fail information.

Fixtures in `tests/fixtures/native-documents` are authored Korean/English
two-page/two-sheet/two-slide inputs with real tables. HWP/HWPX provenance and
regeneration are in `hwp-source`; Office authorship is in `office-source`.
Linux conversion success is distinct from real preview upload, provider
interpretation, storage, download and UI verification.
