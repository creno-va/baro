# Pinned file processor build inputs

These unmodified upstream release/source archives are retained so GitHub release
download outages cannot stop an otherwise unchanged container deployment. They
are build inputs only; the final image copies the existing compiled outputs and
upstream licenses/source. The Workers and browser bundles do not include them.

The Dockerfile verifies the original SHA256 before extraction or compilation.
Do not substitute regenerated archives or change hashes to accept a mismatch.

| File | Upstream | SHA256 |
| --- | --- | --- |
| `libde265-1.1.3.tar.gz` | [Official asset](https://api.github.com/repos/strukturag/libde265/releases/assets/563559957) | `554228bd17788c99a7e63b37ab5634722190e6e2bf60c1dcb01cef328e133905` |
| `libheif-1.23.6.tar.gz` | [Official asset](https://api.github.com/repos/strukturag/libheif/releases/assets/613059376) | `4484346dc5995319dbc11e3a1c35d0a2ec46511ce370900869337fd2c7033125` |
| `H2Orestart-0.7.14.oxt` | [Official asset](https://api.github.com/repos/ebandal/H2Orestart/releases/assets/546609920) | `cbea23bc37861361bbc534bc0675e5bc67b36f712072490f82a9bf410d7c04d8` |
| `H2Orestart-0.7.14-source.tar.gz` | [Official tagged source](https://codeload.github.com/ebandal/H2Orestart/tar.gz/refs/tags/v0.7.14) | `a73246fdfd00e7f7f69915e577b8d3e602113087cbed1c1e1ebba3087fde6a15` |

Upstream license texts remain inside the unmodified archives. Existing Docker
steps copy libde265/libheif `COPYING` and the H2Orestart source into the runtime.
Updates must include upstream provenance, byte verification and native tests.
