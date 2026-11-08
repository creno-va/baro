# 앱 작업공간 개편 검증 자료

설계·소유권·기능 대응·공유 인수표의 정본은
[앱 작업공간·고객 리포트 계약](../../development/APP-WORKSPACE-REWORK.md)이다.
이 디렉터리는 그 계약의 합성 화면 증거만 모은다. 실제 사건·고객·OAuth·외부 AI/법률 조회의
성공 증거로 해석하지 않는다. 실제 외부/독립 법률 인수와 production 배포는 별개다.

## 개편 전

대화 baseline은02의 분리된 Astro 검증에서, 리포트 baseline은03의 기존 React 문서 fixture에서
수집했다. 리포트 fixture는 상단6탭과 이전 문구·본문/사진 구성을 보여주며 전체 AppLayout의
pixel 비교 자료가 아니다. 모바일 대화는390px, 기존 리포트는375px다.

| 화면 | 데스크톱 | 모바일 |
| --- | --- | --- |
| 대화 | [1440px](./conversation-before-desktop.png) | [390px](./conversation-before-mobile.png) |
| 리포트 | [1440px](./report-before-desktop.png) | [375px](./report-before-mobile.png) |

## 대화와 자료

PR762 exact `4b7707611ec09eedb4bb42c8053d1ea08409856b`의 실제 Astro 합성 시나리오다.
입력·선택·미저장 교정·업로드 접수 대기 중 panel 개폐와 화면 폭 변경, 한글 composition 이벤트,
200% 확대에서의 실제 일정 저장을 검증한8개 시나리오의 화면이다.

| 화면 | 데스크톱 | 모바일 |
| --- | --- | --- |
| 중앙 대화 | [1440px](./conversation-after-desktop.png) | [390px](./conversation-after-mobile.png) |
| 자료 panel | [1440px](./materials-after-desktop.png) | [390px](./materials-after-mobile.png) |

최종 검증 대상 SHA/실행 정본은 아래 계약의 인수표와
[#751 실행 기록](https://github.com/creno-va/baro/issues/751)에 연결한다.

최종 탐색 PR766 exact `974c469c65574fbe315d55c0dca3677e3af46c42`(base main
`d5bdcbc4eb77db0e482a0cd84c5a94daf2b7d75a`)의 구성별 합성130 PASS/0 SKIP receipt는
[browser-results.json](./browser-results.json)이다. 실제 메뉴·역할·재접속·CAS·사진/PDF/ZIP·
modal·focus·200% 확대와 공개 화면 pixel 비교를 포함한다. 제품 코드 변경은 없다.

## 리포트 문서

PR761 exact `2e5c65fb9b67888fe50b462d2ffbd7010fc2342b`의 저장본 읽기 fixture다.
상단6탭을 없애고 같은 case frame의 문서 목차·본문·편집/저장으로 옮겼다. 이 fixture의
과거 상담 제목은 저장본 보존 사례이며 새 생성의 고객용 기본 명칭과 구분한다.

| 화면 | 데스크톱 | 모바일 |
| --- | --- | --- |
| 문서 읽기 | [1440px](./report-after-desktop.png) | [375px](./report-after-mobile.png) |

리포트 native42443726453 산출물의47 PNG는00이 시각 검토한 페이지와47/47 byte동일이다.
별도 실제 SQL export-budget의 양입장5쪽씩도 렌더링해 검토했다. 총57쪽에서 긴55행 표,
가로/세로사진, 가림본, 한글·정확 원문·공식 출처를 대조했다. 기존 저장 PDF bytes는 보존한다.

새 생성의 고객용 본문 첫 페이지는 [청구 준비](./customer-prepare_claim-page-1.png)와
[상대 주장 대응](./customer-respond_to_claim-page-1.png)을 따로 남겼다. 이 합성 PDF는 기존
사실 나열에 이름만 바꾸지 않고, 준비 상태·내 사건 한눈에·입장/단계·핵심 쟁점·지금 준비할 일을
먼저 읽게 한다. 검증된 연결이 없는 절차·기한은 채우지 않는다. 이후 페이지에서 직접 준비와
전문가 검토 조건, 상세 사실·상반 자료, 법과 판례의 의미·차이, 정확 원문·공식 출처를 읽는다.

후속 PR763은 목차/본문 번호의 대비2색만 수리했다. 이 디렉터리의 PR761 읽기 화면과 본문·
사진·저장 snapshot은 같다. axe를 약화하지 않고 실제 통합 report3과 최종130을 다시 통과했다.
00의 별도 실제 Astro 조작에서도 저장v2의 사용자 메모·PDF3쪽이 자료 변경 후 유지되고,
명시적 갱신만 새 자료를 반영함을 확인했다. 실제 외부·법률·물리 기기 인수를 대신하지 않는다.
