# BARO 실행 로드맵

- Updated: 2026-10-06
- Current target: [PRD v2](../PRD.md)
- Full delivery: [마일스톤 5](https://github.com/creno-va/baro/milestone/5)

## 기존 P0.3 먼저 확인

P0.1 보안 기반과 P0.2 분석 경험은 기존 v1의 완료 기록이다.
P0.3 #17~#20/#27은 실제 외부 연동·삭제/복구·운영·공개 정책 게이트다.
다른 세션의 브랜치·PR·CI·배포·기록을 먼저 확인하고 미완료 기술 작업을 이어받는다.
#19의 #27 선행 조건과 기존 승인 근거를 보존한다.

실행 가능한 기술 작업을 먼저 끝낸 뒤 사람의 정책/법률·계정 승인만 남으면 구체적인
blocker를 기록한다. P0.3을 허위 종료하지 않고 독립적인 v2 명세·adapter/fixture·
개발·preview 검증을 계속한다. 실제 선행 구현에 의존하는 코드 작업은 병합 후 시작한다.

## 하나의 v2 전체 개발 마일스톤

v2 마일스톤을 UI scaffold 만으로 닫지 않는다. 전체 기능·실제 UI 시연·외부 연동·배포·
공개 조건이 exit 다. 세부 의존성과 실제 번호는 [작업 그래프](../development/work-items.json)
및 GitHub를 따른다.

1. 문서·ADR·시연 행렬을 고정하고 shared v2 계약과 additive DB를 통합한다.
2. 공통 DS·브랜드, 역할/심사, private/public 저장 및 budget admission을 구축한다.
3. 공개 디렉터리/변호사 portal/운영 심사, 적응형 질문/확인/chat/workspace를 구현한다.
4. Containers extraction·Whisper·공식 자료 확장, 자료 UI·PDF/원본 ZIP을 실제로 연결한다.
5. 모든 원본/파생물/context/report 삭제와 복구·quota·권한·실패 시나리오를 검증한다.
6. 실제 UI/외부 연동/같은 SHA 배포 evidence를 채우고 정책 승인 후 공개를 검토한다.

완성된 기능 단위로 PR·CI·preview·production 배포를 반복한다.
UI 와 backend가 실제로 연결된 시연 가능한 단위를 만들며 fixture 만으로 live 성공을 주장하지 않는다.
합성 데이터/역할은 preview 에만 두고 production 공개 프로필은 실제 자격 확인을 거친다.

## 완료 증거와 비목표

[UI 시연 행렬](./UI-DEMONSTRATION.md)의 각 행을 자동/수동/외부 증거와 연결한다.
기존 personal-loan 평가셋은 회귀용이고 전 KR 유형·media·role 범위 증거를 별도로 확보한다.
공개 정책 승인이 남으면 전체 마일스톤과 Goal은 미완료다. 독립 진행이 불가능해졌을 때
필요한 담당자·필드·행동과 남은 인수 조건을 보고한다.

이번 범위에 팀 공동 workspace, 플랫폼 내부 상담/메시징, 사용자를 대신한 연락/제출/
결제, 유료 노출·소개 수수료·승소 예측·법률 전략·완성 제출 문서 생성은 포함하지 않는다.
초기 무료 서비스의 장기 수익 모델은 미정이며 개발 과정에서 새 과금 기능을 추가하지 않는다.
