# Synthetic native document corpus

All files were authored for this test. They contain no external sample document,
real person, case, account, recording or source material from a user.

| Format | Source | Required native result |
| --- | --- | --- |
| DOCX / DOC | `office-two-pages.*` | 2 pages, Korean text and actual 2×2 table |
| XLSX / XLS | `office-two-sheets.*` | 2 printed pages, one per sheet, Korean cells |
| PPTX / PPT | `office-two-slides.*` | 2 pages/slides, Korean text and actual 2×2 table |
| HWP / HWPX | `synthetic-two-page.*` | 2 pages, explicit page break, Korean text and actual 2×2 table |
| TXT | `utf8-two-pages.txt` | UTF-8 BOM + form-feed, both exact text pages |
| Encrypted DOCX | `encrypted.docx` | Explicit rejection, no output manifest |
| Protected XLS | `protected.xls` | Explicit rejection, no output manifest |
| HEIC | `../media/image-markers.heic` | One primary RGB image, metadata removed; multi-frame coverage stays partial |

The first page contains `합성 자료 첫째 쪽` and `BLUEBOX17`; the table contains
`합성 표` and `ORANGECIRCLE42`. The second page contains `합성 자료 둘째 쪽` and
`END_NATIVE_DOCUMENT`. Every positive document is tested through the actual
Container Python entrypoint once for probe and once for each page, with a fresh
private request directory. The original bytes and each artifact length/hash are
checked without printing them. Additional runtime mutations cover external
relationships, macros, DTD/entities, protected settings, corrupt ZIPs and actual
500/501-page conversion bounds.

[Office regeneration](office-source/README.md) uses locally installed document
writers and the pinned LibreOffice image. [HWP/HWPX regeneration](hwp-source/README.md)
uses pinned primary-source Java writers, including their license and source
archive digests. Neither process reads upstream sample documents.

These local tests prove codec/conversion behavior only. They do not prove actual
preview upload, R2 persistence, ASR/vision/model output, download or browser UX.
The final native amd64 CI build is also separate from local amd64 emulation.
