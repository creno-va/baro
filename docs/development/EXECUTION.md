# 에이전트 실행 기준

- Reviewed: 2026-10-15 KST
- 정비 총괄: hyunhomon / 현재 정비 채팅. 기존 모듈 소유권은 유지한다.
- 결정: [ADR-0015](../adr/0015-maintenance-and-operating-policy.md), 제품: [PRD](../PRD.md), 상세: [v2 실행 계약](../architecture/V2-CONTRACTS.md).

## 현재 범위와 작업 순서

현재 공개 서비스를 유지하고 신규 기능 확장을 멈춘다. 고객/변호사 두 역할, 질문 최대
2차례×3문항, KST AI 하루200회, 프리베타 비용 관측 전용과 기존 결제·자동충전을
유지한다. 정책 초안과 사업자 플레이스홀더는 #20/#70의 초안 인수 범위다. 실제 법률 승인이나
독립 외부 검증 완료를 의미하지 않는다. 정비 종료와 전체 MVP 인수 종료는 별도로 판정한다.
비용의 금액·가격/FX/funding 누락/만료·월할당·수동 refresh·유지비·비용 예약 IO로 기능이나
배포를 막지 않는다. 새 직접 사용자 지시 전 재도입 금지이며, [현행 정책과 적용 상태](../operations/PREBETA-COST-POLICY.md)를 따른다.

2026-10-22 직접 요청으로 RN + Expo 모바일 개발을 별도 범위로 추가했다.
[공통 코드 구조](../architecture/MOBILE-CLIENT.md), [실행 계획](./MOBILE-EXECUTION.md),
[ADR-0017](../adr/0017-expo-mobile-and-shared-client-boundaries.md)을 PR329로 통합한 뒤
M1 앱 기반·공통 계약 공유를 #330에서 인수했다. 후속 사용자 지시로 모바일 네이티브 앱
전체 완성을 #334의 지속 목표로 삼고 M2 공통 client #335부터 진행한다. 웹 UI 전면 개편은
다른 채팅의 기존 소유권을 유지하며 인증·전체 기존 기능·UI·기기·릴리스 인수를 끝까지 추적한다.

1. README·이슈 명세를 읽고 bun run work:next로 GitHub 선행 구현·열린 PR·작업자를 확인한다.
2. 선행 구현 PR의 검토·필수 CI·main 병합 후 제품 코드를 시작한다. 실제 외부 인수로 열린
   이슈의 CLOSED를 개발 선행으로 요구하지 않는다. 독립 계약·fixture는 명시 범위에서 준비한다.
3. 이슈에 담당·브랜치·현재 blocker·다음 행동을 기록하고 status:in-progress를 붙인다.
   기존 작업/PR을 재사용하고 깨끗한 main에서 codex/<issue>-<purpose> 브랜치를 만든다.
4. 공유 계약·schema는 먼저 조율한다. migration 최신 번호를 확인해 한 담당자가 순차 배정한다.
   0010은 보존하며 PR247은0015, PR259는 기술 admission·선택적 비용 관측0016을 추가했다. 실제 원격 schema와 적용 SHA는 #71 배포 receipt를 따른다.
5. 변경별 검증 후 PR로 제출하고 검토·CI가 통과한 정확한 head만 정상 병합한다.

## 담당·blocker·다음 행동

| 작업 | 담당/이슈 | 현재 상태·blocker | 다음 행동 |
| --- | --- | --- | --- |
| 새 Android compiler 원본 | 모바일/보안 담당 / #379/#339 | source6201112의40063714258 SUCCESS, artifact12548457928·APK57,136,454bytes/full hash·receipt/aapt2 metadata/HBC/font 독립 대조. codex/339-cli-zod-observation에서 Android pin 갱신, local HBC와 실제 APK 불일치 원본 보존 | exact CI/main 뒤 fresh SDK cert·Launcher/Home·실제 software Search/회전 검증. iOS40063716187은 동일 live handle compile 진행 중이며 old pin 보존. local graph→compiler 인수·전체 gate 완료 주장은 하지 않음 |
| CLI Zod3 잔여 관측 | 보안/모바일 담당 / #339 | codex/339-cli-zod-observation에서 actual CLI validator·작은 library 반례/고정 JSON·Node child privacy 검사를 보존. [관측 범위](../quality/CLI-ZOD-OBSERVATION-2026-10-24.md): 출력 issue 수 증가, library max1 반례의3/4 차이, local 두 OS graph의 Zod3 source0·CLI loader1 | 큰 입력/OOM·전체 도달성/안전 증명이 아님. 원본 compiler와 HBC byte 대조 전 localExportOnly 유지. raw audit high2·전체 #339/#71 인수 보존. 제품/패키지/pin 미변경으로 source6201112 후속 검증의 parity 유지 |
| 10/24 공유 의존성 보안 수정 | 보안/모바일 담당 / #339 | PR454/main cfaed19 CI40063084067 SUCCESS. Zod4.6.6·fast-uri3.1.9·undici7.30.1/8.12.2 업데이트. 실제 Bun1.4.0의 version-scoped override·각 consumer major resolve 확인. [원본 audit와 범위](../quality/DEPENDENCY-SECURITY-2026-10-24.md): raw node-forge/Expo CLI Zod3 high 잔여 보존 | frozen/quick·unit/build·두 OS Metro·실제 consumer 회귀 뒤 exact PR/main CI 통합. native PR453에 producer merge 통합·quick119/build/두 OS Metro 통과. raw audit/전체 #339/#71·기기/계정/store 완료로 표시하지 않음 |
| iOS native 입력 비교 보완 | 모바일 담당 / #379 | PR452/main ddd7fe5 CI40061119740 SUCCESS. UIKit40061251226 SUCCESS: 고정 input의 native/AX signature 일치·change26·원본/provenance/source hash 대조. codex/379-ios-native-input-backport에서 미병합 RN59197의 native3파일 후보·version/SRI/LICENSE/전체 tree·정확 release hunk·source build/양 architecture compile 관측 준비 | frozen/quick/두 OS Metro/build·native patch 역적용 회귀 후 exact CI/main. 새 compiler/pin 뒤 literal/소프트 Search·회전 actual 확인. UIKit/설치 byte만으로 원인·수정 성공 확정 없음. 기존 실패·전체 gate 보존 |
| iOS 별도 UIKit 입력 진단 | 모바일 담당 / #379 | PR451/main64829ed CI40060285018 SUCCESS. codex/379-ios-input-reference에서 소유 Simulator의 별도 UIKit UITextField+native/AX signature 비교 도구 준비. 기존 고정 input/typeText1·wait10초·설정/속도/paste 변경 없음. 제품 원본/공개 탐색 변경 없음 | 로컬 schema/privacy·Swift syntax·Ruby project wiring/quick 확인 뒤 exact CI/main 통합, reference 모드만 한 번 실행. observation 성공을 제품 입력/근본 원인 확정으로 표시하지 않으며 기존 iOS actual 실패·전체 gate 유지 |
| 두 OS native 검색 새 원본 결과 | 모바일 담당 / #379 | PR450/main19c104c CI40058970087 SUCCESS. product4ba1d39의 Android40059250272 SUCCESS: Launcher baseline3·Home2·actual software Search·literal 입력/회전/복귀. iOS40059252212 FAILURE: typed-check/other·짧은 subsequence·날짜 suffix 유지, 소프트 Search 미도달. 원본 binary/receipt·Home PNG·metadata/provenance 독립 대조 | codex/379-native-directory-results에서 성공/실패를 분리 보존. native draft만으로 iOS 누락을 해결하지 못함. 다음은 별도 UIKit reference 입력으로 앱/RN과 XCTest/Simulator 경로를 분리 관측하며 실제 원인 확정·같은 조건 재시도 없음. 한국어/reader·계정/API·physical/store·전체 인수 유지 |
| Android native 명령 실패 분리 | 모바일 담당 / #379 | PR448/main139fd49 actual40055905132의 cold-launch-1/Pixel Launcher ANR 원본 보존. codex/379-android-launcher-baseline에서 default HOME·전후 foreground/root 연속3·오류 dialog 부재 관측과 새4ba1d39 두 OS 성공 compiler 원본 pin 준비. 최대10 sample·첫 Home120초 wait 공유, 합성21개/도구 타입 통과 | exact PR/main CI 뒤 새 원본의 SDK/Launcher/실제 입력 관측. Dialog dismiss·Launcher 전환/종료·HOME/Wait 탭 없음. 이후 Home에서도 aerr dialog는 명시 실패. 원인/전체 Android 인수는 미확정. iOS도 새 원본의 actual 입력/소프트 Search·회전 별도 확인 |
| iOS native 입력 누락 후속 | 모바일 담당 / #379 | PR449/main4ba1d39 CI40056748012 SUCCESS. native draft 구현·RN/두 OS export/build/quick 통과. compiler Android40056943689·iOS40056945553 모두 SUCCESS, 원본 full bytes·실제 metadata/font/HBC·iOS strict signature/XML/DER 대조 | 새 원본 pin/exact main CI 뒤 동일 literal actual 검증. b3eea74 actual40054497761 실패·목록 렌더 분리 불충분·근본 원인 미확정 보존. native 값/조합은 RN props 검사로 인수하지 않음. Android40055905132 환경 실패와 전체 gate 유지 |
| 새 검색 앱 원본 인수 | 모바일 담당 / #379 | sourceb3eea74의 Android40051994117·iOS Simulator40051996500·unsigned iPhone SDK40052099884 모두 SUCCESS. 원본 byte/HBC/font·SDK·Simulator signature/XML/DER 대조. PR446/mainae6aecc CI40053476538 SUCCESS. Android actual40053634921 FAILURE: SDK/signature·Home 확인 후 directory-input-ready/COMMAND_FAILED, 입력/소프트 Search 미도달 | codex/379-ios-directory-compiled-input에서 iOS 성공 원본 pin 통합·정상 PR/main CI 후 실제 입력/소프트 Search·회전 검증. Android 원본 실패/SDK metadata/Home 대조를 보존하고 native 명령의 고정 category/exit/timeout 진단을 보강한 뒤 변경 조건을 검증. 정확 원인 추정/같은 조건 반복 없음·전체 gate 유지 |
| Apple signature CI 환경 | 모바일 담당 / #379 | c401986 CI40047097734 실패/exit143·45초 기록 보존. #443/main45bc32f CI40048165288 SUCCESS. actual iOS40048447226의 [required Apple Foundation step](../quality/mobile-internal-ios-2026-10-24/apple-signature-step-45bc32f.json) 01:09:38→01:09:52 SUCCESS | Linux quick95pass1skip와 실제 macOS required 성공을 구분해 좁게 인수. native 입력/전체 workflow와 별도이며 이전 입력 불일치/전체 gate 유지 |
| Android 공개 탐색 입력/회전 | 모바일 담당 / #379 | PR443/main45bc32f의40048447253 SUCCESS 원본은171989e/hardware Enter 범위로 보존. PR444/mainb3eea74 CI40051831098 뒤 새 compiler40051994117·iOS40051996500·device SDK40052099884 진행 | codex/379-android-software-search에서 current IME·default display의 유일 input window·Search node/bounds/가시 영역을 결합한 직접 탭 준비. hardware fallback 없이 별도 kind로 인수하며 새 compiler/pin/actual 확인 필요. 한국어·전체 화면/역할·reader·HTTP transport·physical/store·전체 #334/#379 유지 |
| iOS 공개 탐색 입력/회전 | 모바일 담당 / #379 | main45bc32f의40048447226 SUCCESS 원본 보존. 동일 조건 추가 확인40049505301 FAILURE: [입력 누락 형태 signature](../quality/mobile-internal-ios-2026-10-24/directory-consistency-failure-45bc32f.json), typed-check/other·짧은 subsequence·날짜 suffix 유지/정규화 불일치. 원본171989e ZIP/receipt·Home/metadata hash 대조 | codex/379-directory-device-results에서 입력 draft를 목록/filter 렌더에서 분리하고 native submit text 사용. 원인 확정/수정 성공 주장이 아니며 새 두 OS compiler·pin 갱신 뒤 실제 검증 필요. 소프트 Search 직접 탭 관측도 준비하며 기존 newline 성공과 구분. 같은 조건 실패 반복 금지·전체 #334/#379 gate 유지 |
| Android 실제 인증 취소 | 모바일 담당 / #346 | actual40038397811 attempt2/source318df0c SUCCESS. [원본 proof](../quality/mobile-internal-android-2026-10-23/auth-cancel-ui-318df0c.json)·Home/metadata/원본 APK hash 대조. Google/Naver/Kakao Custom Tab·BACK1·익명 복귀/cold·Chrome124/userdebug 단일 switch readback/삭제 확인. SDK ZIP 실패 attempt1 보존 | 자동화 fixture/브라우저 취소 범위만 인수. 실제 계정/동의·callback·SecureStore pending 직접 계측·물리 기기·현재 consumer browser/store는 별도. Android 구현/설정 불변이면 같은 source 원본을 보존하며 불필요한 반복을 하지 않음 |
| iOS 실기기 SDK 사전 검사 | 모바일 담당 / #334 | PR434/main87dec15·CI40032179484 뒤 actual40032490751 SUCCESS. [원본 receipt](../quality/mobile-ios-device-sdk-2026-10-24/receipt-87dec15.json)·13,808,079bytes ZIP·실제 plist/Mach-O iOS·SDK26.5/min16.4/arm64/서명없음·HBC/font·키/profile/map 부재 독립 대조 | 실기기 SDK compile의 좁은 인수. unprovisioned ZIP이며 설치/실기기/스토어 성공이 아님. 기기·계정 확인 대기와 전체 gate 유지 |
| iOS 닫기 범위 실제 재검증 | 모바일 담당 / #346 | PR439/main97c2144·CI40040850507 뒤 actual40041077753 SUCCESS. [원본 proof](../quality/mobile-internal-ios-2026-10-23/auth-cancel-ui-97c2144.json)·Home/metadata·원본 ZIP/receipt·runner hash 독립 대조. Google/Naver/Kakao WebView 각각3/2/2개 전부 query·descendant Cancel0/keyboard0·유일 새 Cancel tap·WebView 소멸/익명 복귀·최종 cold 익명 확인 | 자동화 Simulator 브라우저 취소 범위만 인수. frame 제외는 false로 보존하며 논리 descendant 제외와 구분. 이전5회 실패 보존. 실제 계정/동의·callback·SecureStore pending 직접 계측·물리 기기/store 및 전체 #334/#346/#339/#71은 별도 |
| 모바일 Apple 로그인 결정 | 모바일/인증 담당 / #346 | 현행 Apple4.8과 현재3사·이전 strict client·freshness·token 폐기/삭제/revoke를 [결정안](./MOBILE-APPLE-LOGIN-DECISION.md)에 대조. 공급자 구현/키·계정 설정 없음, 상태 제안/미승인 | 사용자의 공급자 추가 방향 결정 뒤 계약/서버 선행→모바일·실제 Apple 검증. token 장기 보관·공개 출시 승인이 아님. 기존3사·취소 실패40025525181/40029347550·전체 #334/#346/#339/#71 유지 |
| iOS 실제 인증 취소 | 모바일 담당 / #346 | PR431/main8480fa6·CI40025168869 뒤 actual40025525181 FAILURE. [원본](../quality/mobile-internal-ios-2026-10-23/auth-cancel-failure-8480fa6.json)은 Google/provider-tapped·SYSTEM_CANCEL_MISSING, exit65/timeout=false. 성공 proof 없음. codex/346-ios-system-dismiss-control에서 전역 Cancel 가정을 native bar의 고정3종/unique·hittable·web 제외로 수정 | 실제 label/scope 원인을 확정하지 않으며 exact CI/main 뒤 바뀐 선택 조건을 검증. 앱/웹/서버/계약 불변. 계정 입력/동의/callback 없음. 실제 OAuth/두 OS/실기기·전체 #334/#346/#339/#71 유지 |
| iOS OS 접근성 검사 | 모바일 담당 / #379 | PR429/main90a2f58·CI40020277557 뒤 actual40020635912 SUCCESS. 원본171989e 앱·iPhone16/iOS26.5·최대 category 전후 readback, Home4/Guide6 scroll/tap·복귀. [OS audit](../quality/mobile-internal-ios-2026-10-23/accessibility-90a2f58.json)는 네 viewport/일곱 검사 요청·보고 issue0이며 원본 ZIP/receipt·runner/device·PNG byte/hash/실물 독립 대조 | 홈/안내의 해당 viewport만 인수. 실제 VoiceOver/TalkBack·전체 화면/역할·키보드/회전·기기·OAuth/private API/store와 #334/#379/#339/#71 OPEN. 웹 UI·권한/계약·서버/제품 코드·배포 불변 |
| 모바일 실제 OAuth 진입 준비 | 모바일 담당 / #346 | main5b895b2·CI40016427571 뒤 2026-10-23T20:15:04.942Z 실제 preview API f912441 확인. 로컬 HTTP에서 기존 세 제공자별 익명 PKCE 시작200·canonical authorization·proxy302/동일 목적지/browser state 설정. [관측과 범위](../quality/MOBILE-NATIVE-AUTH-2026-10-24.md) 보존 | 실제 제공자 계정 로그인/추가 인증과 두 OS 시스템 브라우저·cold/warm 복귀·역할/동의/challenge 검증. HTTP 진입을 실제 OAuth/기기 성공으로 표시하지 않으며 #346/#334/#339/#71 OPEN |
| Android 새 앱/Guide 실제 인수 | 모바일 담당 / #424 | PR426/main346c920·CI40013909663 뒤 actual40014252649 SUCCESS. 원본171989e APK/receipt·SDK37 재검증, Home/font2·Home/Guide 각1회 scroll/tap·교정 문구·복귀·캡처 차단/Metro0. [완전한 proof](../quality/mobile-internal-android-2026-10-23/guide-ui-346c920.json) 독립 대조 | 독립 successful compiler/새 Home·Guide 범위 인수. 이전 dd3e84e receipt 누락 실패는 보존. 전체 #379/#334·키보드/회전·TalkBack/VoiceOver·실제 API/OAuth/physical/store/#339/#71 OPEN |
| Android 성공 compiler 인수 | 모바일 담당 / #424 | PR422/main171989e·CI40005978910 뒤 actual40006344034 SUCCESS. 원본 receipt/57,133,550bytes APK 전체 hash 확인. codex/424-compiled-android-reverification에서 successful provenance/원본 pin·SDK manifest/signature/HBC/font·원본 receipt 유지/별도 관측 준비 | exact CI/main 뒤 새 workflow로 fresh Emulator Home/font2/Guide 왕복 확인. legacy inspection/실패 보존·앱/웹 변경 없음. 실제 API/OAuth·전체 UI/physical/store와 #334/#379/#339/#71 OPEN |
| 두 OS 확대 안내 조작 | 모바일 담당 / #379 | 새 앱 source171989e 두 OS compile/SDK·실제 Home/글자 확대·Guide 왕복/교정 문구 인수. iOS40009294558/toolingb0da132과 Android40014252649/tooling346c920은 source별 원본 보존 | [전달/검증 표](./MOBILE-INTERNAL-PREVIEW.md)와 원본 hash/시각을 유지. 전체 역할/화면·키보드/회전·VoiceOver/TalkBack·실제 사용자 여정·physical/store는 별도 실제 인수 |
| 모바일 기능 안내 교정 | 모바일 담당 / #379 | codex/379-guide-feature-copy에서 Guide의 자료/리포트 준비 중 문구를 현재 사건 화면의 업로드·처리 확인·검토/저장/공유 안내로 교정 | 기존 ff5c208 앱의 실제 관측과 구분. 정확한 새 source PR/main CI 뒤 두 OS bundled compile·원본 compiler pin 갱신·실제 smoke가 필요하며 전체 #379/#334는 OPEN |
| iOS 확대 실제 조작 | 모바일 담당 / #379 | PR423/mainb0da132·CI40008989427 뒤 actual40009294558 SUCCESS. 새 앱171989e의 최대 category 전후 readback·Home5/Guide6 scroll·hittable button tap·교정 문구·Home 복귀. Metro0 | [UI proof](../quality/mobile-internal-ios-2026-10-23/home-ui-b0da132.json)·원본 Home/확대/metadata·별도 PNG 관측을 source별로 보존. 전체 역할/화면·키보드/회전·VoiceOver/TalkBack·physical/store/#334는 OPEN |
| iOS 큰 글자 관측 | 모바일 담당 / #379 | PR419/mainf1ac60d·CI39999943507 뒤 실제40000381723 SUCCESS. 원본 ff5c208 앱의 baseline 두 cold launch와 최대 접근성 category 설정/readback·재시작/재readback·PID3표본/25초·Metro0 인수 | [자동 receipt](../quality/mobile-internal-ios-2026-10-23/large-font-f1ac60d.json)·[실제 시각 대조](../quality/mobile-internal-ios-2026-10-23/visual-large-font-f1ac60d.json) 보존. 제목이 초기 viewport 대부분을 차지해 카드/행동은 화면 아래이며 확대 사용성/스크롤 도달은 아직 인수하지 않음. 전체 역할/화면·VoiceOver/TalkBack·physical/store OPEN |
| 두 OS local native runtime | 모바일 담당 / #385 | PR417/main9a369bc·CI39995718447 뒤 실제39996169996 SUCCESS. iPhone16/iOS26.5 local dev 앱의 계측 Home·100MB upload/1GB download 전체 byte/hash·SDK/SecureStore·취소/owner/401/Origin·파일0개 정리. RSS239표본 최대764,526,592bytes | [원본 receipt](../quality/mobile-runtime-2026-10-23/receipt-ios-9a369bc.json)·원본 unaccepted inspection/ZIP·후속 signing/PNG 실물 대조를 Android c2fa3f2와 source별로 보존. 독립 #385 인수 문서화. 실제 picker/원격 API/OAuth·전체 UI/physical/store와 #339/#71/#334는 OPEN |
| iOS bundled preview | 모바일 담당 / #397 | PR414/mainfd86914·CI39987437927 뒤 실제39987887841 SUCCESS. 원본 ff5c208 Release ZIP/HBC·고정 compiler/receipt·bundled 입력 동일성과 실제 양 ABI metadata/font 재검증. iPhone16/iOS26.5 두 cold launch/PID각3표본·25/54초·Metro 요청0·Home PNG 직접 대조 | [cold launch](../quality/mobile-internal-ios-2026-10-23/home-fd86914.json)·[시각 관측](../quality/mobile-internal-ios-2026-10-23/visual-home-fd86914.json) 보존. 두 OS 내부 전달물·설치/앱·API 관측 표의 독립 #397 인수. 별도 #385의 local native IO·전체 UI/API/OAuth·physical/store/#339/#71은 OPEN |
| 내부 bundled preview | 모바일 담당 / #397 | PR404/main478a904·CI39956914163 뒤 실제39957216861 SUCCESS. 원본 dedcd0e APK57,133,498bytes의 SDK37 signature/metadata/strict identity/HBC/font 재인수·Android15 fresh owned Emulator 두 cold launch/Home hierarchy/PNG 실물 대조. Metro 시작·요청0, adb reverse 없음 | [Home receipt](../quality/mobile-internal-android-2026-10-23/home-478a904.json)와 별도 binary/tooling source를 보존. Home만의 실제 성공이며 전체 화면/IO·실제 API/OAuth·physical/store·접근성·iOS bundled 인수는 OPEN. [내부 전달 절차](./MOBILE-INTERNAL-PREVIEW.md) |
| 공통 account 브라우저 fixture | 모바일 검증 / #392 | main31597a8 전체 Bun3690/Gitleaks0 뒤 browser에서 합성 fixture의 strict mock metadata3건 실패. 제품 guard를 유지하고 tests/helpers/reports-ui-api.ts만 synthetic opt-in/real-account opt-out 명시 | 기존 실패 포함 reports8·signed HTTP/SQL guard와 남은9파일151개 통과. 초기300pass/3fail을 보존. PR393/mainf912441·CI39925887225 뒤 full39926453700에서 browser454 단일 실행 통과·unit3690/DB/build/CSP 통과, 원본 audit2건으로 전체FAILURE |
| 모바일 toolchain 보안 보완 | 모바일 담당 / #334·#339 | PR390 headbf5734c/CI39917339321 SUCCESS→main1a6c54d/main CI39917819068 SUCCESS. 원본 version/SRI/LICENSE 보존·braces 깊이/forge CJS nested ASN.1 보완과 설치 tree/실제 consumer resolution·원본/수정본 회귀 인수. 원본 audit high2건 유지 | 실제 Expo 인증서 라이브러리 합성 서명/Node 독립 검증·현재 module graph/RN sources·양 OS 실제 HTTP 번들 호환 인수. browser dist 미패치·이 패치의 실제 native/SDK와 full 보안/릴리스는 별도 #339/#71 OPEN |
| 모바일 M8 내부 전달물 | 모바일 담당 / #334·#385 | PR389 head176ef3f의 CI39915601296/SDK host39915601362 SUCCESS→mainc2fa3f2/main CI39915841507 SUCCESS. preview39916208240 Android job SUCCESS·APK162,497,066bytes/실제 SDK37 apksig·전체 hash/ABI/font 실물 대조. iOS/workflow도 SUCCESS·Simulator ZIP 전체 hash/Info.plist/ABI/font 실물 대조 | Android artifact12485482082는 Metro 필요 개발 앱이며 앱 부팅/원격/OAuth·physical/store 성공 아님. API 관측57121d2·보안 패치 이전 source와 #339/#71 분리 |
| 모바일 M8 실제 앱 runtime | 모바일 담당 / #334·#385 | 기존 runtime39907857505/ecfcbdd 두 OS terminal FAILURE(Android AVD_INVALID/iOS home layout)를 보존. PR389에서 소유 AVD discovery·실제 SDK 정상/손상 signature fixture·개발 URL 비대화형 flag/adb literal/유효 layout latch를 검증 | mainc2fa3f2 runtime39916204937 Android SUCCESS·실물 receipt와 합성 화면 대조, iOS compile 뒤 Home 대기 terminal FAILURE. raw openurl과 Expo CLI schemeapproval 준비 차이를 확인해 소유 Simulator 경로/readback·안전한 bundle/RSS 분류를 보강. 실제 실행 전 수정 성공으로 표현하지 않음. Android15의 계측 Home/native IPC·100MB/1GB IO 인수 범위를 보존하며 원격/API·OAuth·physical/전체 화면·스토어/#339/#71은 별도 |
| 모바일 전체 구현·M5 native network IO | 모바일 담당 / #334·#361 | PR375 head `4d20c33`·CI39881005183/native39881007251 두 OS SUCCESS/receipt 확인 뒤 main `adc9a119` 통합. native lease→owned cache·SDK SHA readback, 원본/PDF/HTML/ZIP·취소/정리 회귀 통과 | 실제 두 OS 앱 IPC/기기 메모리·API/공급자와 M7/M8·#339·#71 인수 유지. 코어/compile·합성 composition 증거를 실제 기기 성공으로 확대하지 않음 |
| 모바일 M6 공개 탐색·판례 | 모바일 담당 / #334·#369 | PR371 main `a7e4bad`·CI39873595704, PR372 main `045b0bc`·head `54d8e59`·CI39874823751 성공 통합. 공개 주제1~2·context/search/signed read·공식 링크와 범위/실패 상태, Hono/SQL·owner/취소 회귀·quick275/RN53/server56·build/두 OS Metro 통과 | M5 producer와 독립 통합. 본인 프로필/자산·실제 기기/M7/M8 잔여 |
| 모바일 M6 계정·설정 소비 | 모바일 담당 / #334·#369 | PR376 head `7db2aff`·CI39883584580 SUCCESS 뒤 main `ca028ccb` 통합. RN usage/정책·reauth·literal 삭제/별도 미확정 확인, native credential/proof/파일 정리와 peer·작업 key 보존 검증 | frozen/quick319·RN69/server56·build/두 OS Metro 통과. 실제 OAuth/기기·본인 프로필/M7/M8 잔여 |
| 모바일 M6 본인 프로필 자산 IO | 모바일 담당 / #334·#369 | PR378 head `d56c28f`·CI39886391264/native39886391325 두 OS SUCCESS·receipt 확인 뒤 main `8107cbde` 통합. native100MB PUT·snapshot/hash·bounded JSON·기존100MB/1GB download 통과. Apple23개/JVM9개·128MiB heap proof | source lease/credential·private read·프로필 편집/공개/철회 소비를 연결. 실제 앱 IPC/기기 메모리/API·M7/M8·#339/#71 유지 |
| 모바일 M6 본인 프로필 소비 | 모바일 담당 / #334·#369 | PR381 head `bf2a0ef`·CI39892678831 SUCCESS 뒤 main `07e6ee0c` 통합. RN 편집/공개/철회·자산 source lease/native PUT·private read·참조 해제/삭제 연결. 웹 소유 파일 readonly·schema 변경 없음 | frozen/quick(design3·shared350·RN77/server56)·build/local workerd·두 OS Metro 통과. 실제 두 OS 앱 IPC/API·OAuth·M7/M8·#339/#71 유지 |
| 모바일 M7 공통 시각 토큰 | 모바일 담당 / #334·#379 | PR380 head `ddb6be1`·CI39888406927 SUCCESS 뒤 main `e94b20a6` 통합. 웹 실제 CSS 정본에서 순수 @baro/design-tokens 생성·drift/모호한 토큰/필수 대비 검증. 웹 파일 readonly | frozen/quick(design3·shared328·RN69/server56)·build/두 OS Metro 통과. exact CI/main 뒤 native theme/primitive 소비. PR378 exact native terminal/main8107cbde 뒤 rebase·통합 검증 완료. 실제 화면·기기 접근성·M6/M8 잔여 |
| 모바일 M7 native 표현 소비 | 모바일 담당 / #334·#379 | PR382 head `7fa18ce`·CI39894269795 SUCCESS 뒤 main `bf9c38b7`·main CI39894531533 SUCCESS 통합. 정본 token→theme/ui 연결. primary/secondary/danger·48dp target·큰 글자/줄바꿈·선택/focus/readonly·반응형 safe area/scroll 회귀. 웹/모델/서버/schema 불변 | frozen/quick(design3·shared352·RN81/server56)·production build/local workerd·두 OS Metro 통과. font/브랜드·전체 화면 및 실제 키보드/VoiceOver/TalkBack·M8/#339/#71 유지 |
| 모바일 M7 폰트·브랜드 | 모바일 담당 / #334·#379 | PR383 head `c249a6a`·CI39896857238 SUCCESS 뒤 main `0823b8b`·main CI39897078224 SUCCESS 통합. 기존 WOFF2/OFL·SVG readonly→native TTF/PNG·icon 생성. cmap/굵기/라이선스·hash drift와 Expo embed/prebuild 연결, compiled resource receipt 검증 추가 | Python pinned 재생성/byte check·양 OS prebuild·frozen/quick(design3·shared356·RN81/server56)·build/workerd·두 OS Metro 통과. native39897286715/target0823b8b 두 OS app/font receipt SUCCESS·실물 대조. runtime/storeSigned/deployed=false이며 이 source compile/포함만 검증. 실제 기기 폰트/키보드/VoiceOver/TalkBack·전체 화면/M8/#339/#71 유지 |
| 모바일 M7 읽기·선택적 관리 | 모바일 담당 / #334·#379 | 선행 PR383 exact CI/main 뒤 `codex/379-native-screen-hierarchy`에서 Disclosure와 리포트 읽기/편집·설정 계정 관리 분리. dirty/conflict·미확정/reauth·삭제 접수/파일 준비 결과는 유지. feature model·web·서버/schema 불변 | RN 행동/상태·기존39개 제어 handler/guard AST 비교와 frozen/quick(design3·shared356·RN85/server56)·build/workerd·두 OS Metro 통과. exact CI/main 뒤 통합. 선행0823b8b compile을 새 UI 증거로 확대하지 않으며 실제 기기/전체 화면/M8/#339/#71 유지 |
| 모바일 M7 실제 글자 확대 | 모바일 담당 / #379 | PR406/mainbf88d0d·CI39960471564 뒤 실제39960797413 SUCCESS. 같은 bundled APK의 Android15 font_scale readback2·원래 Home 재시작/한글 확대/줄바꿈 PNG 실물 대조. [관측](../quality/mobile-internal-android-2026-10-23/large-font-bf88d0d.json) 보존 | 모든 text 정확히2배의 pixel 측정·전체 화면·회전·키보드·TalkBack/VoiceOver·두 OS/physical 인수는 OPEN. 제품/웹 UI·권한·계약·native 입력 불변 |
| iOS 글자 확대 SDK 준비 | 모바일 담당 / #379 | iOS bundled Home의 실제39987887841 SUCCESS 뒤 codex/379-ios-ui-capabilities에서 현재 SDK help ui의 공개 명령/category를 읽기 전용으로 관측하는 경로 추가 | app/native/웹·기기 상태를 바꾸지 않으며 실제 SDK 문서 관측 전 지원을 주장하지 않음. 문서 확인 뒤 category 설정/readback·실제 앱/PNG 대조로 진행. 현재 local IO39996169996은 별도 실행 유지 |
| 모바일 실제 공개 목록 | 모바일 검증 / #407 | PR408/main5b41fc2·CI39963435347 뒤 실제39963766414 SUCCESS. 같은 원본 dedcd0e APK의 공개 목록 ready-empty·loading/error=false 관측. 사전 screenshot reader 차단·이름/ID/raw hierarchy/목록 PNG 미출력. [receipt](../quality/mobile-internal-android-2026-10-23/public-directory-5b41fc2.json) 보존 | 독립 공개 UI 범위의 인수이며 실제 프로필 card/HTTP 별도 계측·OAuth/private/physical/store·iOS는 포함하지 않음. #334/#346/#379/#397/#339/#71 유지 |
| DB·HTTP 왕복 축소 | 성능 조율 / #317 | 선행 UI·법률·모델·첨부·리포트 PR을 main c2258b88에 통합, 필수 PR/main CI 성공. 별도 codex/317-db-roundtrips에서 합성 호출 수 재측정 | commit revision 기반 행동·타임라인 선택 재조회, 중복 domain 읽기와 단일 공개 목록 lead sample 제거. fresh auth/삭제/CAS/멱등성 및 관측 전용 비용 정책 보존. 회귀·quick/build/DB 검증 후 PR, 실제 원격 성능·배포는 #71 별도 |
| 사진 근거·PDF 리포트 | AI/자료, #312 | 2026-10-21 직접 요청, codex/312-photo-evidence-pdf. #307 첨부 UI·#304 법률 범위 분리, migration 없음 | 상해/진단서 관찰·확인 지침, 선택 사진·출처와 HTML→PDF, PDF만 저장. quick/build·브라우저·native 조판 CI 후 별도 PR 병합; 외부 모델/배포 인수 별도 |
| Gemini 모델·질문 하네스 | AI / #305 | 2026-10-21 사용자 승인, 별도 codex/305-gemini-flash-pipeline worktree. #304 법률 API와 PR303 UI 범위 분리 | ADR-0016·고정 평가·quick/build·CI 검증 후 별도 PR 병합. 실제 모델·배포 인수는 별도 receipt |
| 사건 관련 판례 탐색 | 법률/UI / #308·PR311 | 2026-10-21 직접 기능 구현 요청. 선행 PR306 직접 승인 후 main bab5c76 통합. 별도 페이지/API·주제 추천·서명 원문 조회 구현, 로컬 workerd/D1 실제 공식 판례6건 검색/읽기 성공 | quick/build·관련 회귀·브라우저/접근성 및 정확한 PR head CI 증거를 #308에 기록. PR311 병합·preview/production 반영은 각각의 승인/검증 조건 유지 |
| UI 브라우저 회귀 | UI / #314 | full39605770123 실패 중 프로필 파일선택 인증11건·자료 검토2건 담당. e46a7616에서 재현 후 진행 중 세션 HTTP 공유와 변경 전 pagination 문구를 기대한 테스트로 분류. 제품 코드는 보존 | 일반 focus 검증 참여/진행 중 공유·settled 뒤 새 조회와 peer 계정/역할/동의/장애의 새 응답 우선·지연 이전 응답 차단을 검사. dirty 교정/revision/부분 저장 회귀·quick·정확한 PR CI 뒤 정상 통합, 최종 full은 조율 담당이 통합 SHA에서 수행 |
| 업로드·물리 용량 | 자료 모듈 + 총괄, #58 | PR230→229→235와0014가04f25f8에 포함돼 배포됨. production storage 초기화 성공; 실제 업로드/ZIP/cleanup은 이번 receipt에 없음 | 물리 inventory/writer 경계를 유지하며 남은 자료 경로의 구현·실제 증거를 구분 |
| 비용 관측 분리 | 비용 모듈 + 총괄, #57 | PR247/259 병합; preview71892c5·schema0016에서 기술 admission과 선택적 관측 분리, 기존 원장 보존 확인. 가격/funding 없는 물리 bootstrap도 구현·로컬 검증 | 기존 관측·hold·원장/보안/기술 상한 보존. 비용 차단 재도입 금지. 실제 preview 핵심 흐름은 아래 단일 추적표에서 별도 인수 |
| 릴리스 증거 | 총괄, #19/#71 | 04f25f8 동일 SHA CI·preview·production 성공, 실제 일반 채팅·리포트/PDF/HTML 확인 | 이번 관측 분리의 새 PR/배포 증거를 별도 기록. 기존 성공을 새 변경 또는 전체 MVP 완료로 확대하지 않음 |
| 디렉터리 | 변호사 모듈 + 총괄, #231/M5 | PR234 병합; 기존 공개 목록의 원격 projection 연결 미완료 | serving SHA 확인 후 bounded reindex, 철회·cursor·필터 smoke |
| 문서·작업 체계 | 총괄, #19/#64/#71 | 현행 기준과 과거 기록 분리 중 | 문서 PR과 이슈/마일스톤의 담당·증거·다음 행동 대조 |
| 채팅 실패·재시도 | 고객/AI, #64 / PR238 | production04f25f8에서 21:32:46 KST 새 일반 채팅 요청,21:33 실제 assistant 본문 확인 | 이전7a617b5 비용 실패와 원인 미확정 provider 실패를 역사로 보존. 비용 관측 만료 후 실패 방지는 이번 변경의 별도 범위 |
| 리포트·다운로드 | 자료 모듈, #66 | production04f25f8에서21:34:37 KST 리포트v3 생성, PDF3페이지/3,144,078bytes 실제 수신·한글 렌더, HTML14,572bytes 실제 수신 | 선택 원본 ZIP/업로드/삭제와 다른 media 경로는 별도 잔여로 유지 |
| 법률·인증·정책 점검 | 법률/인증 모듈, #27/#63/#71 | [10/14 검증](../quality/LEGAL-AUTH-VERIFICATION-2026-10-14.md): 등록 도메인 Referer 누락 확인·로컬 인터넷 JSON 거부 해결. 법령 본문 검증과 실제 판례 형식 수정. Google 사용자 수동 확인·정책 점검표 완료 | 수정 PR 병합 후 GitHub 저장 credential 및 같은 SHA Worker 검증. 기관 안내 update_pending·판례 limited·Naver/Kakao 실제 증거는 보존 |
| 전체 실제 인수 | 각 모듈, #27/#59/#63/#64/#66/#67/#71 | 단일 추적표에 버전별 실제 Kakao 두 역할·질문/요약/채팅/공식 법률 질의·자료 처리·HTML/PDF/ZIP·프로필 공개/철회 결과 기록. 8ebfbaf DOCX 본문/표/두쪽 및 원본 일치 확인. 수동 Turnstile은 사용자 보류, 지연과 간헐 native 원인 미확정. 큰 자료의 사건 화면 오류 수정 PR288 병합 후 preview 재확인 대기 | [단일 실제 인수 추적](../quality/PREBETA-MVP-LIVE-ACCEPTANCE.md)을 현재 결과 정본으로 사용. 이전 오류와 성공을 다른 버전에 그대로 적용하지 않음. preview 전체 핵심 흐름 완료 전 production 배포 금지 |

## 2026-10-14 실제 배포·제품 receipt

배포 SHA `04f25f804f02e0f221f4b34be0f03edc3d0afd00`의
[main CI38563034585](https://github.com/creno-va/baro/actions/runs/38563034585),
[preview38563613354](https://github.com/creno-va/baro/actions/runs/38563613354),
[production38563979183](https://github.com/creno-va/baro/actions/runs/38563979183)가 성공했다.
production [저장 초기화38564333321](https://github.com/creno-va/baro/actions/runs/38564333321)는
21:30:58 KST, [같은 할당 refresh38564475420](https://github.com/creno-va/baro/actions/runs/38564475420)는
21:31:57 KST에 완료됐다. 이 refresh는 당시 실행한 절차이며 앞으로의 기능 사용 선행 조건이 아니다.
일반 채팅과 리포트/PDF/HTML의 실제 확인 범위는 위 표와
[#71 종합 receipt](https://github.com/creno-va/baro/issues/71#issuecomment-6168531808)를 따른다.
법률 query의 `POLICY_REJECTED`는 별도 정책 결과이며 이번 실제 업로드/ZIP 인수는 미확인이다.

22시경 KST 인증 콘솔에서 Workers Paid, 양 Gateway Spend Limits OFF/Rate Limit Requests OFF,
production Dynamic Routes 없음, Unified Billing credit$39.21와 기존 자동충전ON/$10/$30을 확인했다.
GitHub 공개 저장소의 모든 workflow는 표준ubuntu-latest runner다. 조직 budget 조회는 권한/404로
전체 상태를 확인하지 못했으며 “조직 예산 없음”으로 단정하지 않는다. 자세한 범위는
[비용 정책의 외부 설정 관측](../operations/PREBETA-COST-POLICY.md#외부-설정-관측-범위)을 따른다.

## 이전 비용 차단 관측과 후속 구현

**이전 실패 기록:** 2026-10-14 채팅 수정 preview receipt: main `7a617b5acf08c7168482caa3e08ff07208416270`,
[main CI38556751515](https://github.com/creno-va/baro/actions/runs/38556751515) 성공.
[preview38556937083](https://github.com/creno-va/baro/actions/runs/38556937083)는 Worker 반영과
schema/endpoint 검사는 통과했지만 AI 재원 검사 실패로 전체 실패다. 검증된 배포 성공이나
실제 채팅 성공으로 기록하지 않는다. 미정산21,895원·정산283원·유지비 예약31,118원을
보존했다. 그 run에서는 production 배포 및 유료 모델 호출을 수행하지 않았다.

2026-10-14 후속 직접 지시로 금액 차단 정책을 변경한다. #57의
[PR241](https://github.com/creno-va/baro/pull/241)은 `APPLICATION_COST_LIMITS_ENABLED=false`로
월·누적 재원·요청 금액의 admission/dispatch/refresh/preflight 차단을 해제한다.
위 7a617b5 실패는 당시 정책의 실제 기록으로 보존한다. PR241 단계에 남았던 가격/재원
만료·월할당·수동 refresh·비용 예약 IO의 차단도 후속 직접 지시로 제거한다. 비용 원장·
관측 사실·기술용량·AI200/일·권한·실제 공급자 오류는 유지한다.
0014 예약 금액 표현 변경은 #55에 단일 작성자를 기록했으며 과거 migration은 보존한다.
새 직접 사용자 지시 없이 금액 상한·비용 관측 만료·예산 대기·비용 초과 동결을 다시 적용하지 않는다.
PR247의 코드·0015·배포 도구·문서 변경은 병합됐다. PR248은 별도로 확인된60초 모델 timeout을
120초로 조정한다. 새 배포·실제 기능 결과는 #71 동일 SHA receipt로 연결하고04f25f8의 증거와 구분한다.
배포 진행 상태는 GitHub run의 실제 SHA·결과로 확인하며 다른 세션의 진행 중 배포를 중복 실행하지 않는다.

## 검증과 배포

### 2026-10-21 법률 API 신뢰성 정비 (#304)

현재 정비 채팅 / `codex/304-legal-retrieval-reliability`. 공식 법원 corpus 필터와 검색 범위/
원문 검증 분리로 정상 판결문을 사용할 수 있게 한다. 형법·근로기준법의100행 초과 시행
이력은 최대5페이지로 완전히 확인하며 요청30회/workspace12회·권한·취소·인용 검증을
유지한다. 일반 상담 문서를 바로잡되 실제 update_pending은 정상으로 위장하지 않는다.
[실제 공식 응답과 잔여 조건](../quality/LEGAL-API-RELIABILITY-2026-10-21.md)을 따르며
local-workerd 성공을 remote Worker/제품 E2E로 확대하지 않는다. 운영1059887에는 기존
redirect 수정도 미배포 상태다. 같은 SHA 검증과 #71 배포 gate를 보존한다. UI PR303과
랜딩·모델·공급자·공유 DB schema는 이 브랜치에서 변경하지 않는다.

### 2026-10-21 UI·동의 흐름 정비 (#302)

담당은 현재 UI 정비 채팅, 브랜치는 `codex/302-responsive-ux`다. 랜딩 페이지의 코드·자산·
스타일은 변경하지 않는다. 로그인 448px 고정 폭·과도한 세로 여백을 반응형 2열/1열 구조로
교체하고 역할 선택·SSO·보조 안내를 구분한다. 동의가 현재 버전이면 동의 폼을 표시하지 않고,
신규/재동의도 저장 확인 뒤 역할과 허용된 returnTo에 따라 자동 복귀한다. 정책 원문은 새 창으로
열어 선택을 유지한다. 동의 버전·연령·인증·권한 검증은 보존한다.

합성 브라우저 탐색에서 타임라인/자료 모달의 좌상단 배치, 고객 화면의 불필요한 하단 여백,
모바일 도움말 앵커 제목의 고정 헤더 가림을 재현하여 수정했다. 변호사 편집 화면의 제목·
디렉터리 링크를 같은 헤더에 정렬했다. 320/390/768/900/1366/1440/1920px의 해당 화면,
로그인·동의·새 사건·질문·요약·대화·자료·타임라인·행동·리포트·설정·검색·프로필·도움말을
점검했다. 합성 OAuth/SQL·로컬 API 예시 결과는 실제 외부 로그인/배포 인수와 구분하며
검증 명령·결과와 PR/CI는 [#302](https://github.com/creno-va/baro/issues/302)에 기록한다.

2차 점검에서는 검색한 변호사의 상세/새로고침/목록 복귀 시 적용한 이름·지역·분야가
사라지는 흐름을 수정했다. 공개 검색 필드만 상세 경로에 유지하고 목록 링크는 SSR에서
같은 조건으로 구성한다. 낮은 가로 화면에서 메뉴를 스크롤해도 닫기 버튼을 유지하고,
설정의 다시 확인·리포트 확인·사건 삭제 조작 영역을 최소44px로 맞췄다. 긴 사건 제목·
파일명·대화·일정·행동·리포트와320/901/1024px 경계도 별도 합성 fixture로 점검했다.
320px 리포트에서 새 버전 버튼이 메타정보에 밀려 여러 줄로 잘리는 정렬도 행을 나누어
수정했다. 랜딩은 2차 점검에서도 변경하지 않는다.

휴먼테스트 12쪽 리뷰 후속으로 정상 포커스 복귀의 편집 화면 보존, 인증 동시 조회 병합과
사건 목록 병렬 조회, 활성 사건 요약 편집/자료 탭 복귀, 저장 후 정확한 revision 확인,
추가 자료 표시·교정 뒤 기존 대화로 반영, 사건별 삭제 진입, 자료 검토 밀도·추가 페이지
안내·시간 표기, 사실 상태/모순 선택, 리포트 출처/삭제 도움말과 선택 지표 상태를 정비한다.
허용된 원음/영상 재생은 명시적 원본 조회 뒤 제공하며 세션 변경 시 제거한다. 모델·공급자와
원문·출처·CAS·삭제 절차는 보존한다. 항목별 기준과 합성 검증/실제 ASR·지연 검증의 경계는
[휴먼테스트 후속 기록](../quality/HUMAN-REVIEW-2026-10-21.md)에 정리한다.

bun ci 후 validate:quick과 해당 기능의 인증·소유권·CAS·멱등 재시도·실패·삭제 회귀를
실행한다. build 영향은 validate:build, DB 변경은 validate:db의 drift·fresh/upgrade와
실패 rollback을 확인한다. 필요한 browser/native/security 검사를 선택하고 통과한 검사는
새 변경이나 미해결 원인 없이 반복하지 않는다. Bun은 도구용이며 제품 런타임은 Workers다.

모든 구현·문서가 병합된 최종 main SHA를 명시해 GitHub 수동 validate:full을 한 차례
수행한다. 실제 checkout SHA를 증거에 기록하고 CI에서는 유료 호출을 하지 않는다.
같은 SHA를 preview에 배포해 합성 계정·자료로 업로드, 리포트·다운로드·삭제,
디렉터리를 제한 검증한다. production은 같은 SHA와 #71의 유효한 운영자 승인 기록이
필수다. 승인자는 hyunhomon 또는 hwangeunchan, 정확한 SHA와 최대24시간 유효기간을 검사한다.
현재 Environment에 필수 reviewer가 있다는 가정은 하지 않는다. 비공개 합성 고객 흐름을
검증하며 production 디렉터리에 가짜 변호사를 게시하지 않는다.

기존 정식 공개 checker의 미완료 정책·외부 조건은 보존한다. 공개 운영 허가와 독립 외부
검증, 정책 초안 수용과 법률 승인은 별도 상태다. 다른 SHA/환경의 증거는 대상 소스·의존성·
관련 설정 동일성을 입증한 경우에만 재사용하며 현재 resolver는 보수적으로 다른 SHA를 거부한다.
실패한 외부 검증은 원인이나 조건을 바꾸기 전 반복하지 않는다.

## 데이터·비용·권한 경계

미정산 비용·실행 작업·v1 암호문·공개/자격 표시·삭제 journal을 보존한다. 비용 관측의
누락·만료·월 전환·refresh 미완료는 실행·배포를 막지 않는다. 관측 도구는 사실대로
unknown/stale를 기록하고 날짜/재원 금액을 늘리지 않는다. 당시 호출은 당시 근거로 정산한다.
물리 용량·서명/권한·revision/CAS·writer/lease 검사는 비용 관측과 분리한다.

새 모델/공급자·새 결제수단/자동충전 변경·법률 승인·실제 사업자 사실을 임의 결정하지 않는다.
기존 사용자 승인 결제 경로와 자동충전은 유지한다. OAuth 키·실제 사건·토큰·원문·stack/SQL을
공개 이슈/로그/artifact로 보내지 않는다. 다른 작업자의 checkout·합성 자료·secret을 보존한다.
에이전트·새 채팅·Goal·스케줄을 자동 생성하지 않는다.

## 완료 판정과 이력

실제 외부 인수가 남으면 PR은 Refs를 사용하고 이슈를 열어 둔다. 정비 종료에는 문서·설정·
이슈 정합성, 미정산 보존 재개, 증거 결합, bounded 검색, 최종 회귀·같은 SHA 배포·제한 검증·
자료 정리가 필요하다. #71은 전체 MVP 필수 조건의 담당과 실제 증거가 모두 충족될 때만 닫는다.
M2/M3/M6의 완료 이력은 유지하고 새 정비 마일스톤은 만들지 않는다.

2026-10-11 인계와 이전 A/B/C 경계·실패·배포 receipt는 [실행 이력](./EXECUTION-HISTORY.md)에
보존한다. 이전 수치·담당·승인 대기는 현재 실행 기준이 아니다.


### 2026-10-21 채팅 첨부 UX (#307)

현재 첨부 UX 채팅 / `codex/307-chat-attachments`. 사용자 명시 승인으로 선행 UI PR303
검증 head854df33을 정상 병합한 main57a91de에서 시작했다. 별도 worktree에서 사진·파일
선택/붙여넣기/끌어놓기, 처리 후 전송과 실제 참조의 자료 탭 연결을 구현한다. 자료 기본
조회는 metadata 경계를 유지하며 명시적인 근거 보기에서만 요약·최근100개 메시지를 추가로
읽는다. DB schema/공급자/비용 정책은 이 작업에서 변경하지 않는다. 성능 조율 채팅과
법률/판례 채팅에 공유 경로를 전달했다. [검증 기록](../quality/CHAT-ATTACHMENTS-2026-10-21.md)을
따르며 실제 provider/OAuth/배포 인수는 #71과 구분한다. [PR310](https://github.com/creno-va/baro/pull/310)으로 제출했고 최신 main76643b7을 통합한
제품 head8c7919f의 quick·관련 단위·빌드를 통과했다. main 병합·배포는 조율 채팅과 현재
사용자 승인 범위를 따른다.


PR306·311·313이 main1b10fc6에 통합된 뒤 첨부 담당이 같은 main을 PR310에 충돌 없이
병합했다. 제품 head24c2a47의 quick·관련 단위78개·빌드와 첨부7/판례4/리포트3/CSP1
합성 브라우저를 통과했다. 첨부·기본 자료 projection과 판례/사진/PDF 경계를 보존하며
새 head CI 확인 후 현재 사용자 AGENTS의 검증 PR 병합 범위로 정상 통합한다. 별도
full·배포·실제 외부 성공을 이 검사로 대신하지 않는다. 최종 head/CI/main receipt는 #307과
PR310을 따른다.
