# Retired web regression style snapshot

Exact source: main `7236c14f88f21a64c5fe916a90779d7c238fff6d`, `src/styles/` with the same filenames.

These files remain immutable historical input after production routes retire. Product routes must
not import this directory. The interactive retired-page regressions now use the current AppLayout,
Headless UI and semantic tokens so the current controls are not tested against a frozen native-widget
stylesheet. Their explicit fixture flag, API/owner/asset checks and production 410 assertions remain.
The current web design system is `src/styles/design-system.css`.
