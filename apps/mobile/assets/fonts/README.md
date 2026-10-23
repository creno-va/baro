# Native font

`BaroMobile.ttf` is generated from the existing [Pretendard web source](../../../../public/fonts/README.md).
Its format/family names change for native packaging and the OFL Reserved Font Name; its complete
14,336-codepoint cmap, 11,172 Hangul syllables, wght45–930 axis and nine named instances are retained.
The original copyright stays in the font; the complete original OFL is copied in `OFL.txt` and embedded
in the font's machine-readable name13 license field. The family and PostScript prefix are BaroMobile.

Regenerate with Python>=3.10, fonttools==4.66.1, brotli==1.2.0 installed in an isolated tool environment:

```sh
python scripts/build-mobile-font.py
python scripts/build-mobile-font.py --check
bun run mobile:assets:check
```

Run from the repository root. The generator never writes `public/fonts`. The manifest records source,
license and TTF hashes without introducing a build timestamp. Normal quick verification needs no
Python/fonttools installation: it checks those hashes and bounded TTF names/axis/instances/cmap/OFL.
The optional Python `--check` independently regenerates and compares the entire font file.

Expo-font58 embeds this local file. Android defines 400/600/700 normal faces with wght coordinates;
iOS uses the retained named instances and internal BaroMobile family. No CDN or async font-start gate.
A fresh development build is required after changing these native assets/configuration. Native build
receipts compare compiled APK/app font bytes, declarations and embedded license; actual RN/device
font selection, line wrapping and accessibility remain a separate acceptance step.
