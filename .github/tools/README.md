# Pinned CI tool

`gitleaks_8.30.1_linux_x64.tar.gz` is the unmodified
[official gitleaks v8.30.1 asset](https://api.github.com/repos/gitleaks/gitleaks/releases/assets/378332058).
It retains its upstream license and is only used by the manual full-validation
workflow. It is excluded from the Docker, Workers and browser build inputs.

SHA256: `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`.

The workflow verifies this existing pin before extraction/execution and continues
to scan the complete Git history with fully redacted findings. The archive avoids
runtime downloads during GitHub release outages; it does not bypass scanning.
