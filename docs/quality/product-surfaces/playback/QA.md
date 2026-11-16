# Playback CUA 819

Actual Chrome extension UI on existing Astro mock fixture http://127.0.0.1:4369/__media-player. No new server/build/install, file chooser, download, auth or external upload. Initial theme was dark and was not changed.

Passed: WAV20s and MP4 8s (640x360) metadata/readyState4; actual play/pause; audio Home+ArrowRight=1s and End=19.999s with 0:20 display; video Home+ArrowRight=1s; audio pointer midpoint=10s; mute and volume Home/ArrowRight control5%; direct Headless1.5x choice with native playbackRate1.5; access lock during play pauses and disables controls, unlock remains paused at same time; closing while playing unmounts audio/group while video stays. Detached element src removal/pause is not directly observable with this CUA API; preserved original cleanup source proof supplies that separate evidence.

Responsive:390px and320px document width equals viewport; player widths358/288 and all playback buttons/sliders44px high.320px seek track250/262px and volume track86/98px.

Found and fixed: new SelectField originally exposed accessible name '재생 속도 1배', breaking the existing exact role locator. Root added narrowly optional native aria-label compatibility. Reloaded after HMR, exact role button name '재생 속도' matches and choosing1.5 sets data-value/native playbackRate1.5. No browser assertions were changed. Default callers were inspected statically (conditional empty spread preserves contextual labelledby when no explicit label); no separate default caller was exercised in this media-only CUA fixture. Root owns focused primitive regression checks.

Fullscreen: button available, but current Chrome CUA request was denied and original graceful message displayed. Native fullscreen entry and fullscreen CSS geometry are not claimed validated.

Console warning/error count after patch:0. DOM CSP meta absent; CUA has no documented response-header inspection, so no strict HTTP CSP acceptance claim. No observed console CSP violation.

Artifacts: metrics.json, console.json, desktop-initial.jpg, access-locked.jpg, mobile-390.jpg, mobile-320.jpg, audio-unmounted-320.jpg, rate-label-fixed-320.jpg, video-fullscreen.jpg (attempt, not entered).
