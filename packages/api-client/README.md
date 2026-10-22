# @baro/api-client

Shared JSON requests, safe public errors and wire clients for session/consent, cases/intake/workspace/files/reports and the public
lawyer directory. Inject transport, UUID creation and optional body encoding. Web credentials
and multipart bodies belong to the browser adapter; native API origin and session storage
belong to native adapters. No global fetch, React, cookie configuration or environment reads
are allowed here.

Writes use the caller's exact key/body/revision. This layer performs no automatic retry.
Domain clients must preserve their operation key across ambiguous failures. A supplied session
scope fences late success/error/body decode results after identity changes. Feature models also
fence superseded UI loads. Server authorization remains authoritative.

`createSessionClient` shares concurrent reads only and returns fresh permission data on the next
settled read. Session transitions must invalidate its scope and discard owner-bound domain
instances. `createDirectoryClient` validates canonical filters/cursor and response schemas.
Malformed responses and untrusted server messages become safe public errors.

The web retains its existing facade/mock composition; mobile has no implicit mock fallback.
Account, lawyer profiles and precedent research remain #335 extraction units.
Run `bun run clients:check`, `mobile:check`, and
the existing web/domain tests when moving a module.

`createCasesClient` owns its key/revision/schema knowledge per session instance. Inject the
operation requester, SHA-256 fingerprint/UUID, logical operation storage and cancellable
challenge port. Browser composition retains the existing facade, optional sessionStorage and
Turnstile dialog. Native composition must use `persistence: "required"`: a missing/unavailable
durable store cannot start a write. Only opaque keys, owner/revision metadata and input hashes
persist; editor text stays in the in-flight instance. Native storage adapters must encode/hash
logical keys to meet their OS key naming restrictions.

Same-input case creation coalesces before async storage or challenge work. Real case creation
resolves the current owner for every attempt before coalescing within that owner. Other real
writes reach their live owner/workspace checks instead of joining a pending editor input,
including when an account cookie changes before the app receives a session notification. Ambiguous responses
retain the key and exact wire revision; another owner gets a separate key while the original
owner can resume the unresolved operation. Every HTTP boundary and final result checks the
captured session generation. Invalidate the stable app scope on auth/lifecycle transitions to
abort its HTTP/challenge work and recreate private domain instances.
An optional instance signal cancels a feature's work when it closes without granting or changing
session permissions. Use a fresh feature instance after that signal is aborted.

`createWorkspaceClient`는 채팅/행동/타임라인 projection·pagination·revision readback을 공유한다.
HTTP·UUID·metadata-only `listFiles`·비동기 jobStorage를 주입하며, 모든 cache와 쓰기 key는
instance에 묶인다. 같은 쓰기는 진행 중 한 번으로 합치고, 계정/화면 종료는 HTTP와 결과를
취소한다. jobStorage는 owner별 namespace의 opaque job ID 힌트이며, 권한과 최신 상태는
항상 서버가 확인한다. 저장 실패 시에도 최신 job 조회로 복구한다. mutation key는 현재
instance 내 응답 유실을 복구하며, 앱 재시작까지의 durable 쓰기 복구는 native adapter와
M4 고객 흐름에서 별도 인수한다. 상담 원문·메시지는 이 job store에 보관하지 않는다.

`createFilesClient<Source, Download>`는 자료 목록/coverage·처리 재시도·교정·삭제·chunk 업로드
계약을 공유한다. `UploadMetadata` 외의 source와 다운로드 결과는 플랫폼 타입이며,
`openUpload` reader가 전체 SHA-256·bounded part body/hash·close를 담당한다. 공통 코드는
browser File/Blob/stream을 호출하지 않는다. reader는 immutable bytes를 읽고 abort를
준수해야 하며 native adapter는 앱 전용 cache/원본 정리와 재시작 복구를 별도로 구현한다.
같은 source 객체의 병행 업로드는 한 번만 열고 보낸다. hash/part 크기를 검증하고 계정
전환 후 추가 admission/progress/result를 차단한다. close 오류는 성공한 업로드를 다시
접수하게 만들지 않으며 adapter의 cache 정리 경로에서 처리한다.

`createReportsClient<Download>` shares report review/generation and immutable ZIP selection keys.
JSON requests and `ReportArtifact<Download>` are injected. Artifacts verify MIME/size and a bounded
PDF/ZIP header or the existing HTML marker; failed/stale verification calls `discard`. The adapter
owns streaming/private cache, aborts and partial-download cleanup before returning a handle.
Successful values transfer to the platform's open/share/cache lifecycle. No Blob/URI implementation
is embedded in the common client. Ambiguous review/generation retries keep the same basis/key even
after metadata refresh or a temporary selection change. State is session-local; restart persistence
and actual native export IO remain M5 acceptance work.
