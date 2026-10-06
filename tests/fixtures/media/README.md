# Synthetic media fixture corpus (#59 preparation only)

These 11 deliberately synthetic source assets total **644,318 bytes**. They prepare
independent fixtures while #57/#58 are open; they do not start #59 product implementation
or satisfy its live processing acceptance criteria. Every fixture's repository-relative
path, bytes, format, expected content, provenance and local verification are in
[manifest.json](./manifest.json).
The local `.gitattributes` preserves exact asset bytes across platform checkouts, including
PDF cross-reference offsets and the UTF-8 fixture's original line endings.

| Inputs | Purpose and locally verified properties |
| --- | --- |
| text-two-pages.pdf | 2 pages; Korean/English expected text recovered by pypdf; all pages rendered with Poppler and visually inspected |
| scan-image-only.pdf | 1 image-only page; native text extraction intentionally empty; labels visually inspected |
| utf8-markers.txt | Exact UTF-8 Korean/English round trip |
| image-markers.png / image-markers.jpg | 1000 x 700; Pillow decode; synthetic labels and a green triangle; no supplied EXIF |
| speech-ko.wav / speech-en.wav | 7.15 / 6.515 s; 16 kHz mono signed 16-bit PCM; non-silent samples |
| scenes-silent.mp4 / scenes-speech.mp4 | Each 8 s, 10 fps, 80 frames, 640 x 360 H.264; no audio / Korean synthetic speech in AAC |
| not-a-pdf.pdf | 57-byte text with a PDF extension; expected product format-mismatch rejection remains unexecuted |
| truncated-video.mp4 | 128-byte local MP4 truncation; FFmpeg rejects incomplete stream; product rejection remains unexecuted |

All text and shapes were locally authored. WAV files were made solely for fixture creation
using already-installed Windows System.Speech Heami Desktop/Zira Desktop voices. They are
**synthetic speech, not actual human recordings**. Expected spoken text is the TTS input;
ASR and intelligibility have not been evaluated. Silence cannot prove speech recognition.

Scene A (blue box) occupies [0,1.4), scene B (orange circle) [1.4,3.2), and scene C
(green triangle) [3.2,8) seconds. These intentional off-second boundaries exercise the
future one-second-plus-scene-change requirement. Expected extra samples are 1.4 and 3.2 s;
the manifest is ground truth, not evidence that a scene detector ran. The speech video
includes the complete 7.15-second Korean TTS source, padded with silence to 8 seconds.

## Local integrity check

```sh
bun scripts/media-fixtures-check.ts
```

The dependency-free tool checks corpus count, repository path bounds, exact sizes, PDF
headers/page markers, UTF-8 content, image dimensions, WAV duration/non-silent PCM, MP4
track timing/sample counts and the intended invalid-container controls. These checks are
specific to the small fixtures; they are not a general-purpose upload admission parser.
Original local proof also includes full FFmpeg decoding, decoded frame color checks,
independent MP4 metadata parsing, decoded AAC and visual inspection of all PDF pages and
the three scene labels. That preparation did not call a network/model provider.

Private hashes are excluded from this tracked manifest. The original receipt remains in
the preparer's git-ignored `.wrangler/media-fixtures/manifest.json`. Where available:

```sh
bun scripts/media-fixtures-check.ts --private-receipt .wrangler/media-fixtures/manifest.json
```

This additionally compares hashes without printing them. Do not upload receipt hashes or
raw inputs/audio/frames to public CI/run evidence. Use synthetic fixture IDs, byte/coverage
counts, candidate/environment references and pass/fail results instead.

## Limits

No actual OCR, ASR, vision, Container, R2, preview upload or product processing success is
claimed. No real people, cases, credentials or recordings are included. Malgun Gothic is
installed locally and subset-embedded in PDFs; no standalone font file is distributed.

These small fixtures do not prove maximum size/pages/duration, resource limits, timeout,
retry, cancellation, deletion, quota/budget behavior or zip-bomb defenses. Office/HWP/HWPX,
HEIC and other media formats/codecs remain distinct fixture and processing coverage gaps.
Do not reduce supported product scope to this corpus. #59 product work still requires
#57/#58 CLOSED with their prerequisite PRs merged; actual media smoke remains #71.
