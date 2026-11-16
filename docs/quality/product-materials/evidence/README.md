# Evidence CUA — bounded 818 result

Local Astro mock server: `http://localhost:4368`. Dedicated Chrome tab `1988751958`; no real OAuth, legal agreement acceptance, external provider, private source or production account was used. All navigation/changes used visible UI; no direct API/storage injection. No runtime/config edits were made.

Confirmed before interruption:

- Visible `/__product-shell` → “자료가 있는 합성 계정 준비” → “합성 사건 열기” opened the actual `shell-app-case` workspace and one seeded synthetic text material.
- At 1440×900, material panel opened and the existing partial review showed the explicit processed/unreadable coverage, uncertain observation and original file revision.
- Editing a synthetic observation then closing opened the real dirty confirmation. “계속 작성하기” kept the draft; it remained visible after 390×844 and 320×700 viewport changes. The original text was restored via the actual textbox; no correction save or evidence reflection was submitted.
- Closing the review restored visible AX focus to “자료 확인”; closing the mobile materials panel restored focus to “자료 열기”.
- The seed fixture deliberately contains metadata/review without original binary bytes. “원본 확인 · 다운로드” correctly exposed NOT_FOUND while retaining the review; no downloaded-path or download-event API was called and no successful original download is claimed.
- The composer attachment menu opened at 390×844 and showed “자료 추가”, the existing material mention checkbox and “외부 조회”.

Incomplete / tool limitation:

The first and only native file-chooser attempt used the documented `waitForEvent('filechooser')` → visible “자료 추가” click → chooser `setFiles` for the repository synthetic `image-markers.jpg`. That tool call did not return and was interrupted after approximately 1,121.6 seconds. It emitted no chooser/result snapshot, so the exact internal pending stage is unknown. Selection, preview, upload, removal, capture cancellation, ACK/ready state and 44px removal geometry are **not verified by this CUA run**. No chooser/download retry was made. No final file upload or deletion button was submitted.

Console logs were not read before interruption; there is **no console-clean claim**. 390/320 geometry queries were held only in interrupted runtime memory and were lost; their scrollWidth/touch-target values are not available. The saved screenshots provide visual evidence only. The one persisted tool response measured 1440×900 document scrollWidth1440, panel x1094.40625/y56/width345.59375/height844.

Cleanup:

On resume, documentation was refreshed. The former owned tab was already absent. Browser viewport reset succeeded, tab inventory showed no owned tab and no localhost4368 tab, and the required CUA completion summary was sent. Server usage is released to root; no further CUA is pending.

Saved screenshots:

- `1440-materials.jpg`
- `1440-dirty-close.jpg`
- `390-partial-review.jpg`
- `320-partial-review.jpg`
- `320-missing-original.jpg`
