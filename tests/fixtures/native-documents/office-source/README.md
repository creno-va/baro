# Authored Office fixtures

`generate.py` authors two-page Korean/English documents, two printed sheets and
two slides with a real 2×2 table. It reads no external document. The inputs contain
only synthetic markers: `BLUEBOX17`, `ORANGECIRCLE42`, `END_NATIVE_DOCUMENT`.

Generation used bundled Python with python-docx 1.2.0, python-pptx 1.0.2 and
openpyxl 3.1.5. ZIP entry metadata is fixed. Noto Sans CJK KR is requested by name;
no font file is copied into these source packages. The Container provides the
Debian Noto CJK package for actual rendering.

The TXT fixture is UTF-8 with a BOM and one form-feed page boundary. It preserves
both pages through the existing text extractor.

`make-legacy.py` uses the pinned image's LibreOffice 25.2.3 package to save these
same authored inputs as DOC, XLS and PPT. It also creates a password-encrypted
DOCX and a protected XLS sheet for rejection controls. The password is a fixed
synthetic test string, never an account secret. Generated binary metadata need
not be byte-identical across LibreOffice versions; the checked-in inputs are
the exact test corpus and the actual page/text/table assertions are required.

These are source fixtures, not real people, cases, recordings or provider
responses. Local native conversion assertions are distinct from preview upload,
AI interpretation, storage and UI acceptance.
