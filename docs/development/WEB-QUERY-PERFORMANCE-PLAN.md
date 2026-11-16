# 웹 조회 성능 기준과 후속 계획

- 작성·로컬 측정: 2026-11-16 KST.
- 최초 실행 시 checkout HEAD: `3d0f01d37c2a29f52ae7adaf924e7264a3cbf655`.
- 현재 우선순위: [화면 기획과 기본 UI 기반](./WEB-UI-REBUILD-PLAN.md). API·DB·모바일·공유 클라이언트의 제품 동작은 이 단계에서 변경하지 않는다.
- 이 문서의 경량 상태 조회는 **후속 설계 제안**이다. endpoint 구현·제품 연결·운영 성능 개선 완료를 의미하지 않는다.

## 1. 재현 가능한 로컬 기준

저장소 루트에서 `.bun-version`에 지정한 Bun과 설치된 의존성으로 실행한다.

```sh
git rev-parse HEAD
bun scripts/measure-web-query-baseline.ts
```

[측정 CLI](../../scripts/measure-web-query-baseline.ts)는 실제 공유 client factory와
[새 쿼리 factory](../../src/product-ui/queries.ts)를 사용한다. HTTP는 통제된 합성 응답으로 대체한다.
D1 측정은 기존 SQLite·AES·메모리 R2 fixture에서 실제 rework/report 서비스 읽기를 실행한다.
fixture 준비용 쓰기와 합성 legacy 리포트 한 건 생성은 측정 구간 밖의 로컬 메모리에서만 수행한다.
fixture DB와 QueryClient는 `finally`에서 정리한다.

실행 중 `fetch`는 외부 연결을 거부하도록 막는다. 결과에는 계정·사건 ID, 서술·메시지,
파일 내용, 토큰, SQL, 오류 stack을 출력하지 않고 호출 수와 범위만 JSON으로 출력한다.
합성 입력·로컬 adapter 결과를 실제 OAuth·공급자·운영 인수로 표현하지 않는다.

### 최초 실행 결과

| 구간 | 관측 호출 수 | 해석 |
| --- | ---: | --- |
| 같은 작업 공간을 두 소비자가 직접 동시에 읽음 | 합성 HTTP 18 | 두 공유 클라이언트 메서드 호출의 합계 |
| 두 소비자가 같은 소유자·세대·사건·자원 쿼리를 공유함 | 합성 HTTP 9 | 같은 진행 중 쿼리 한 번을 공유 |
| 첫 작업 공간 조회 | 합성 HTTP 9 | 현재 공유 client의 전체 projection 구성 |
| 15초 staleTime 안의 같은 QueryCache 조회 | 합성 HTTP 0 | 이미 검증한 합성 결과의 캐시 재사용 |
| 같은 revision의 공유 client 재검증 | 합성 HTTP 4 | workspace·자료 metadata·최종 workspace·latest job 조회는 남음 |
| 사건 상세 뒤 작업 공간을 순서대로 조회 | 합성 HTTP 3 + 9 = 12 | workspace·intake·summary가 겹치는 조합의 기준 |
| rework 진행 상태 client 메서드 한 번 | domain 1 + session port 2 | 전후 세션 확인의 논리 호출 수. 실제 HTTP 병합 결과와 구분 |
| 리포트가 없는 rework 진행 상태 서비스 | D1 method 37 / SQL statement 37 | HTTP 인증 비용 제외 |
| 저장된 합성 legacy 리포트가 있는 동일 서비스 | D1 method 57 / SQL statement 61 | HTTP 인증 비용 제외 |

`calls`는 `.first/.all/.run/.batch` 등의 로컬 D1 메서드 호출 수다. `batch` 한 번에 여러 SQL
statement가 포함될 수 있다. 실제 D1 `rows_read`, cloud latency, 네트워크 왕복 시간,
복호화 시간, 공급자 지연, 운영 p50/p95를 측정한 값이 아니다.

HTTP 응답은 첫 페이지·빈 대화/행동/타임라인/자료·고정된 요약을 사용한다.
D1 fixture도 특정 합성 상태이므로 37/57을 상한·성능 목표·하드코딩된 검사 예산으로 쓰지 않는다.
실제 자료·메시지·암호화 fragment 수와 검증할 출처가 늘면 비용이 달라진다.

CLI는 두 동시 소비자의 직접 호출이 공유 쿼리 호출의 두 배인지, 응답이 요청한 작업 공간인지
검사한다. 이 기준이 달라지면 원인을 검토하며, 숫자를 맞추기 위해 권한·무결성 검사를 제거하지 않는다.
새 기본 UI에는 아직 API를 연결하지 않았으므로 이 표를 새 화면의 전체 로딩 시간이나 완료된
제품 최적화로 해석하지 않는다.

## 2. 소스에서 확인한 비용 경로

- [workspace client](../../packages/api-client/src/workspace.ts)는 시작/종료 workspace revision을 확인하며 intake·summary·메시지·행동·타임라인·자료 metadata·작업 상태를 조합한다. 화면마다 필요한 자원을 구분하지 않고 이 메서드를 호출하면 자료/리포트만 보는 화면도 전체 이력을 읽게 된다.
- [cases client](../../packages/api-client/src/cases.ts)의 `get`과 workspace `get`은 일부 HTTP 자원을 공유하지만 서로 다른 메서드이므로 상위 QueryCache 키만으로 내부 중복이 모두 합쳐지지는 않는다. 목록은 현재 v1/v2의 모든 페이지를 읽는다.
- [rework client](../../packages/api-client/src/rework.ts)는 요청 전후의 소유자·이용 유형을 확인한다. 이 검증을 장기 캐시로 대체하지 않는다. 관련 조회를 하나의 일관된 응답으로 묶는 방법을 별도 검토한다.
- [rework state service](../../src/server/modules/rework/state.ts)는 상태 조회에서도 분석 입력·컨텍스트·레코드·리포트·대화 intent를 확인한다. 최대 100개 메시지에 대해 별도 암호문 읽기가 추가될 수 있다. 이 N+1 경로는 소스에서 확인한 내용이며 위 빈 메시지 합성 HTTP 기준에 포함되지 않는다.
- [분석 입력](../../src/server/modules/rework/analysis-input.ts)과 [리포트 서비스](../../src/server/modules/reports/service.ts)는 현재성·원문·선택 범위·사진 후보를 검증한다. 이를 타이머마다 반복하는 대신 조회 목적을 나누는 것이 다음 검토 대상이다.
- 기존 [세션 응답](../../src/server/api/me.ts)은 계정 상태를 batch로 읽고, [고객 동의 snapshot](../../src/server/auth/account-type.ts)은 선호와 legacy 역할·동의를 한 SQL에서 확인한다. 이미 존재하는 최적화를 새 변경의 성과로 기록하지 않는다.

## 3. 후속 제안: 변경 감지 전용 상태 projection

별도 버전의 opt-in 경로 `/api/v2/cases/:id/rework/status`를 검토한다. 기존
`conversation`/`conversation-progress` DTO와 설치된 모바일 호출은 유지한다.

예시 응답 계약은 다음 정도로 제한한다. 아직 구현된 계약이 아니다.

```json
{
  "contractVersion": "conversation-status-v1",
  "workspaceRevision": 12,
  "changeToken": "opaque-change-detector"
}
```

`changeToken`은 갱신 필요성을 알리는 값이다. 인증 token, `ready` 판정, 출처의 현재성 증명,
실행·재시도·취소·다운로드 허가로 사용하지 않는다. 저장된 report 행이 존재하는 사실만으로
리포트를 준비 완료로 표시하지 않는다. 가벼운 조회에서 전체 분석을 검증하지 않았다면
`analysis.status=ready` 같은 기존 의미를 재사용하지 않는다.

### 감지할 metadata

- 소유자가 일치하고 살아 있는 workspace의 revision·확정 summary revision.
- 현재 작업의 ID·operation/대상/revision·상태·실패 상태. 이 정보는 감지 입력으로만 쓰며 검증되지 않은 job을 사용자에게 실행 중이라고 노출하지 않는다.
- 관련 published analysis/context/task head와 automatic-preparation/report-continuation checkpoint의 ID·revision.
- canonical report head·revision·저장 상태. 원본 ZIP export 행과 구분한다.
- 자료 membership·state·tombstone 변경이 workspace revision에 항상 반영되는지 증명한다. 보장되지 않는 변경은 감지 입력에 포함한다.

workspace revision이 같아도 job 상태나 후속 report 등록·완료가 바뀔 수 있으므로 revision 하나만
비교해서는 안 된다. 반대로 lease heartbeat·단순 `updated_at` 변경은 토큰에서 제외해
동일 내용의 전체 재조회를 반복하지 않는다. metadata 조회는 기존 소유권·tombstone·published
경계를 적용한 제한된 읽기로 구성하며, native D1 계측 후 실제 호출 예산을 정한다.

### 읽기 일관성과 화면 적용

1. 진입 시 상태 token A를 읽고 기존의 authoritative 전체 진행 상태를 읽는다.
2. 상태 token B를 다시 읽는다. A/B와 workspace revision이 일치할 때만 전체 결과를 채택한다.
3. 진행 중인 작업이나 미해결 logical continuation이 이전의 검증된 상태에 있을 때만 가벼운 상태 조회를 반복한다. 변경이 없으면 전체 본문을 읽지 않는다.
4. token이 바뀌면 전체 상태를 한 번 읽고, 완료 후 token을 다시 확인한다. 읽는 중 또 바뀌면 제한된 passive 재조회로 처리하며 혼합 revision을 성공으로 표시하지 않는다.
5. 화면 숨김·계정 변경·해당 pane 종료 시 관측을 중단한다. 화면 포커스 복귀·중요 조작 전에는 기존의 신선한 권한/전체 상태 확인을 유지한다.

전체 상태를 먼저 읽고 token을 나중에 최초 저장하는 구현은 피한다. 그 사이 작업이 완료되면
새 token에 오래된 본문을 붙여 이후 변경을 놓칠 수 있다. 필요하면 후속 단계에서 새로운
conditional 응답 경로가 이 전후 일관성 검사를 서버에서 수행하게 할 수 있다.

### 보존할 경계

- 신선한 `caseAccess`, 실제 session ID와 expected-owner 확인, 이용 유형·동의·삭제 검사를 유지한다. 소유권이 없는 요청은 metadata 읽기를 시작하지 않는다.
- 읽기 시작 anchor와 최종 owner/revision/관련 head 상태가 달라지면 제한된 읽기만 재시도한다. GET에서 모델·작업·리포트 생성이나 continuation 등록을 실행하지 않는다.
- 기존 mutation은 원래 logical requestId·idempotency key·expectedRevision·CAS를 유지한다. 상태 조회의 최신 revision으로 불확실한 이전 요청을 자동 재작성하거나 재전송하지 않는다.
- PDF 저장·다운로드는 기존의 검토한 report ID/revision, 세션 소유권, source·stale 검사를 계속 사용한다. status token으로 대신하지 않는다.
- 공식 출처 철회·만료 등 workspace 외부의 변경을 가벼운 token이 모두 증명한다고 가정하지 않는다. 최종 표시·중요 조작의 기존 전체 검증을 유지한다.

## 4. 후속 구현 인수 기준

기본 UI와 화면 설계를 검토한 뒤 별도 PR에서 다음을 충족한다.

| 검증 | 요구 결과 |
| --- | --- |
| 호출·SQL 계측 | 같은 fixture·SHA·측정 범위에서 이전/이후 호출 수를 JSON으로 비교. HTTP 인증·native D1 rows/timing과 로컬 method 수를 구분 |
| metadata 전용 읽기 | idle 상태 조회에서 summary/report body, 분석 input, 대화 암호문, snapshot parts, 원본 bytes를 읽지 않음 |
| 변화 누락 방지 | workspace revision이 그대로인 queued→running→완료, report continuation 등록/완료/실패, report head·자료 삭제를 감지 |
| 불필요한 재조회 방지 | 동일 의미 상태의 heartbeat는 전체 읽기를 유발하지 않음. 동일 query key의 진행 중 요청은 공유 |
| 권한·경합 | 계정 전환, 동의 철회, 세션 만료, workspace/report/file 삭제, 조회 중 publication에서 혼합 결과를 폐기 |
| 읽기 부작용 | GET 전후 작업·operation·report 생성 수와 provider 호출 수가 증가하지 않음 |
| 범위·기술 한도 | record/파일/fragment 경계와 입력·출력 한도 유지. 많은 데이터에서 무제한 metadata scan을 하지 않음 |
| 기존 계약 | 기존 full DTO·모바일 동작·멱등 재시도·CAS·검토한 PDF 보호 회귀 통과 |

기존 [작업 공간 metadata 계측](../../tests/workspace-metadata-list.test.ts),
[고객 동의 snapshot](../../tests/customer-consent-snapshot.test.ts),
[rework 상태 경합](../../tests/rework-state-concurrency.test.ts),
[실제 작업 projection 보호](../../tests/rework-public-jobs.test.ts),
[report snapshot 읽기](../../tests/reports-snapshot-reads.test.ts),
[검토한 PDF 다운로드](../../tests/report-reviewed-download.test.ts)를 함께 유지한다.
실제 preview/production 성능과 지연 p50/p95는 같은 SHA의 별도 승인된 환경에서 측정하며,
이 CLI 성공만으로 완료 처리하지 않는다.
