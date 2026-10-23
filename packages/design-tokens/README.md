# BARO design tokens

Portable semantic data from the accepted [web handoff](../../docs/design/PRODUCT-UI.md).
The existing `src/styles/product.css` and `src/styles/global.css` remain the authored source.
This package does not import CSS, React, DOM, Expo, server bindings or filesystem APIs.

Run from the repository root:

- `bun run design:generate` reads web source and writes only `src/index.ts` in this package.
- `bun run design:check` compares the generated module, checks portable types and runs source/
  ambiguity/contrast regressions. It is included in `mobile:check` and normal quick CI.

Product blue/ink/subtle/line/card radius and the minimum control size come from product CSS.
Surface/background/muted/action text, borders and status colors come from the global tokens.
Short hex colors are normalized without changing their value. Responsive layout-only blocks
are independent; missing/duplicate/viewport-specific token declarations and unsupported value
formats require an explicit mapping instead of a silent fallback.

The check covers normal body/muted/status text and primary action contrast, and the handed
44px minimum. Decorative lines are not sole interactive boundaries. Native consumers keep
their 48dp targets, platform font scaling, keyboard/safe-area behavior and distinct controls.
CSS/DOM components, font files and screen layouts are not copied into this data package.

This is the M7 producer. Exact CI/main integration precedes native theme/primitive adoption.
It is not evidence of actual device layout, VoiceOver/TalkBack, keyboard or app/API acceptance.
