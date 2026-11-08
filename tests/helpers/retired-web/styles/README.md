# Retired web regression style snapshot

Exact source: main `7236c14f88f21a64c5fe916a90779d7c238fff6d`, `src/styles/` with the same filenames.

The three test-only retired lawyer pages import `index.css` under the existing UI fixture flag.
This preserves the original layout constraints alongside ownership/asset recovery regressions after
production routes retire. These files are immutable historical input, not the product design system.
Product routes must not import this directory. The current design is global.css/product.css.
