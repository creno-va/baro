# Native brand assets

Generated from the existing shared [SVG logo](../../../../public/brand/logo.svg), which remains readonly.
`logo.png`, `logo@2x.png`, `logo@3x.png` supply native Image density variants. `icon.png` centers the same
symbol on an opaque white1024px square for Expo app icons. No duplicated SVG paths or new logo design.

```sh
bun run mobile:assets:brand
bun run mobile:assets:check
```

The manifest records the source/output hashes, dimensions and pinned existing sharp version.
`mobile:assets:check` detects source/output drift, missing density files, invalid dimensions or a
transparent app icon. Inspect regenerated raster output and rebuild the development app. Compiled
resources/Metro verification is separate from actual two-OS home-screen and screen-reader review.
