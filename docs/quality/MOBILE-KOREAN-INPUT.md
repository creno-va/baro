# 모바일 한국어 입력 인수

2026-10-24 / #379·#334. 현재 상태는 **도구 준비, 실제 실행 미검증**이다.
기존 source6201112의 두 OS ASCII 입력/실제 software Search·회전 성공과
source9436e77의3사 인증 취소 성공을 한국어 IME 인수로 확대하지 않는다.

## iOS 독립 실행

현재 pin의 원본 Simulator 앱을 재컴파일/재서명하지 않는다. 성공한 main CI의 정확한 tooling
SHA에서 기존 `mobile-internal-ios-reverify.yml`을 `smoke=true`, `korean_directory=true`로
수동 실행한다. 나머지 관측 모드는 모두 false여야 하며 혼합/중복 flag는 거절한다.
앱 source9436e77과 tooling SHA, 컴파일러 receipt·원본 ZIP hash·실제 Simulator OS/모델을
각각 기록한다. 기기 SDK 무서명 컴파일은 이 런타임 검증을 대체하지 않는다.

1. 기존대로 fresh owned CI Simulator에 원본 앱을 설치해 anonymous Home cold2회·Metro0을
   확인하고 인증/공개 탐색 전 PNG만 남긴다.
2. public capture boundary를 먼저 적용해 이후 raw command 로그·UI hierarchy·xcresult·
   screenshot을 export하지 않는다. 실패도 고정 assertion/단계·boolean만 보존한다.
3. [Apple이 안내하는 Settings 경로](https://support.apple.com/guide/iphone/iph73b71eb/ios)로
   General→Keyboard→Keyboards→Add New Keyboard→Korean→2-Set을 선택하고 목록을 확인한다.
   변경 대상은 이번 실행이 만든 Simulator뿐이다. host/사용자 기기 설정·preferences DB·
   입력 속도·third-party keyboard·계정 설정은 바꾸지 않는다.
4. BARO 공개 탐색 검색창에 초점을 두고 keyboard가 보이며 입력창이 keyboard 위에 있는지
   확인한다. 최대3번의 언어 순환 안에 실제 자모 키가 나타나야 한다. 불명 layout을 영어
   문자열 주입으로 우회하지 않는다.
5. 실제 software 자모 키 `ㅂ/ㅏ/ㄹ/ㅗ`를 각각 탭하고 `ㅂ/바/발/바로` 네 checkpoint를
   정확 비교한다. 공백 key로 조합을 확정한 뒤 delete로 그 공백을 지우고 `ㅂ/ㅏ`를
   추가해 `바로바`를 확인한다. paste/typeText/정규화로 성공을 만들지 않는다.
6. keyboard 안의 유일한 Search 제어를 실제 탭하고 keyboard 닫힘·오류 없는 검색 상태를
   확인한다. 합성 query에 장래 공개 프로필이 매치될 수 있으므로 결과 0개를 요구하지 않으며
   프로필 이름/ID/값은 읽거나 내보내지 않는다. HTTP transport 독립 증명은 false다.
7. 가로→세로 회전 후 입력값과 입력창의 조작 가능성, Home 복귀를 확인한다. 조합 중 회전·
   커서 중간 편집·긴 문장/붙여넣기·다른 키보드/OS·VoiceOver·실제 기기는 별도 인수다.

[XCTest의 tap](https://developer.apple.com/documentation/xcuiautomation/xcuielement/tap())을
실제 keyboard key에 사용한다. test runner만 컴파일하며 제품 앱 소스/번들에는 진단을
주입하지 않는다. 성공 proof는 별도 `ios-public-directory-korean-software-composition` kind다.
이전 ASCII proof와 서로 바꿔 인수할 수 없고 capture/source/device identity도 일치해야 한다.

## 남은 범위

Android의 실제 한글 software IME 조합은 아직 준비/검증하지 않았다. 두 OS의 고객/변호사
private 화면 전체·첨부 bar·긴 문장·초점/키보드·reader·물리 기기를 이 검사로 완료 처리하지
않는다. 실패 시 고정 단계/원인을 먼저 확인하고 조건 변경 전 같은 실행을 반복하지 않는다.
Apple 로그인 설정/계정·전체 #346/#339/#71/#334의 미완료 gate도 유지한다.
