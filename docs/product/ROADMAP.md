# BARO 실행 로드맵

- Updated: 2026-10-06
- Current target: [PRD v2](../PRD.md)
- UI sprint: [마일스톤 6](https://github.com/creno-va/baro/milestone/6), 실제 기능: [마일스톤 5](https://github.com/creno-va/baro/milestone/5), 외부/공개: [#71](https://github.com/creno-va/baro/issues/71)

## 기존 구현과 외부 gate 보존

P0.1 보안 기반과 P0.2 분석 경험은 기존 v1의 완료 기록이다.
P0.3 #17~#20/#27은 실제 외부 연동·삭제/복구·운영·공개 정책 게이트다.
다른 세션의 브랜치·PR·CI·배포·기록을 먼저 확인하고 미완료 기술 작업을 이어받는다.
#19의 #27 선행 조건과 기존 승인 근거를 보존한다.

P0.3을 허위 종료하지 않고 외부 blocker를 구체적인 담당자·필드·행동으로 남긴다.
이 대기는 동일 client UI+API mock 및 독립 기능 연결을 차단하지 않는다. 완료된 코드·이슈·증거를 재사용한다.

## M6 API mock UX → M5 기능 연결 → #71 외부/공개

2026-10-06 사용자 지시로 MVP는 고객/변호사 두 역할이다. 통합 로그인에서 역할을 선택하고
변호사는 자기 프로필을 관리한다. 승인 어드민·자격 신청/심사·반려·승인대기는 제외한다.
[5세션 계획](../development/PARALLEL-UI-SPRINT.md)과 [client 계약](../development/CLIENT-API-CONTRACT.md)이 정본이다.

1. M6/#101~#106: 실제 client UI 동일 구현체의 API mock을 5세션 실제 착수부터 2시간 내 완성한다. 별도 `/mock` UI는 만들지 않는다.
2. A 공통 facade/로그인/shell, B 사건/질문/요약, C workspace/자료/행동, D report/설정/삭제, E 변호사 portal/directory를 병렬 만든다.
3. M5: 각 영역 mock UX가 사용 가능해지면 같은 client의 real adapter를 기존 구현/PR에 연결한다. 저장·재접속·자료·다운로드·삭제·권한을 확인한다.
4. 모든 UX 연결 뒤 AI 답변 정교화·광범위 법률군 품질 개선을 진행한다. 새 DB/비용 기반 작업을 UI 선행으로 추가하지 않는다.
5. #70/#71: 실제 외부 연동·복구/운영·같은 SHA 배포·법률/정책/production/최초 공개 승인 증거를 별도로 채운다.

완성된 기능 단위로 PR·CI·preview·production 배포를 반복한다.
UI 와 backend가 실제로 연결된 시연 가능한 단위를 만들며 fixture 만으로 live 성공을 주장하지 않는다.
합성 API 응답은 local/격리 preview에만 두며 production 인증을 우회하지 않는다.
자기 선택 변호사 역할/프로필을 자격 확인·법률 승인 증거로 표시하지 않는다.

## 완료 증거와 비목표

[UI 시연 행렬](./UI-DEMONSTRATION.md)의 각 행을 자동/수동/외부 증거와 연결한다.
기존 personal-loan 평가셋은 회귀용이고 전 KR 유형·media·role 범위 증거를 별도로 확보한다.
mock 완료는 실제 기능/외부 공개 완료가 아니다. 공개 정책 승인이 남으면 #70/#71을 OPEN으로 보존한다.
기존 Goal은 재생성하지 않는다. 독립 진행이 불가능해졌을 때 구체적인 blocker를 보고한다.

이번 범위에 팀 공동 workspace, 플랫폼 내부 상담/메시징, 사용자를 대신한 연락/제출/
결제, 유료 노출·소개 수수료·승소 예측·법률 전략·완성 제출 문서 생성은 포함하지 않는다.
초기 무료 서비스의 장기 수익 모델은 미정이며 개발 과정에서 새 과금 기능을 추가하지 않는다.
