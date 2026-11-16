# Retired web fixtures

This directory contains historical presentation code retained for existing unit and synthetic
fixture coverage. Production pages must not import it. New web UI checks target
`src/components/web/` and `src/client/query/`.

`components/`, `layouts/`, `baseline-client/` and `baseline-styles/` preserve the web baseline
from main `b54566f3` before the 2026-11-16 rebuild. The older `Legacy*` wrappers and `styles/`
remain available to their existing isolated fixtures. Report generation, masking, download and
server failure-document utilities keep their existing nonvisual source paths under
`src/components/` because production services also use them.

Passing these historical fixtures is regression evidence for their retained behavior. It does
not establish that the new UI, real external services or a deployed version have been verified.
