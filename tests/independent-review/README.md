# 독립 통합 검증 (2026-10-06)

이 폴더는 제품 구현과 분리된 검증/재현 기록이다. 제품 UI를 복제하거나 API facade를 별도 구현하지 않는다. 실제 제품 페이지와 합성 mock 응답을 사용하며 외부 OAuth/AI/R2 성공을 증명하지 않는다.

## 실행

저장소의 Bun 1.3.14와 Node runtime을 PATH에 둔다. Astro dev의 Node 실행에는 실제 Node를 사용한다.

```sh
bun ci
bun x playwright test --config tests/independent-review/integration.config.ts
bun test ./tests/independent-review/account-metadata.repro.ts
bun test ./tests/independent-review/intake-real-retry.repro.ts
```

브라우저 config는 검증 전용4350 서버를 시작/종료한다. A~E 포트를 재사용하지 않는다. 생성 증거/trace는 root `test-results/`에만 보관한다. 모든 입력/원본/프로필은 합성이다. API mock browser에서 실제 `/api/` 요청은 차단한다.

- `integration.e2e.ts`: 고객/변호사 전체 흐름, reload, owner·revision 경계, 전송/처리 실패 retry, 다운로드/삭제, 응답 유실 retry.
- `account-metadata.repro.ts`: 합성 SQLite에서 실제 계정 삭제 후 역할 metadata cleanup과 미등록 real route를 확인한다.
- `intake-real-retry.repro.ts`: 합성 real HTTP 대역에서 commit 후 응답 유실 시 요약 저장/확인 재시도를 확인한다.

## 알려진 실패

기준 `dc22c26`, 검토 영역의 제품 소스 동일성을 `539a3cc`에서 확인했다. 브라우저12개 중8개 통과,4개 assertion 실패는 계정 전환 제품 결함3건을 재현한다. metadata1개 및 real intake retry2개도 아직 실패한다. 후자는 일반 `bun test`에 자동 편입되지 않는 explicit `.repro.ts` 파일이다. 기본 Playwright testDir 밖에 두어 실패 재현 검사가 제품 gate를 무의식적으로 바꾸지 않게 했다.

검증 자체의 locator/초기 hydration 대기 오류는 수정하고 해당 검사만 재실행했다. 전체 사례 corpus·AI 품질·native 회귀를 반복하지 않았다. 새로 발견한 제품 결함은 실패 assertion을 유지해 담당 수정 후 동일 검사로 확인할 수 있게 한다.

최종 결과: [독립 검토 보고서](../../docs/quality/independent-review-2026-10-06/REPORT.md).
