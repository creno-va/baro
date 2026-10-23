# Android SDK signature fixtures

Apache-2.0 라이선스의 AOSP apksig 테스트 APK와 LICENSE를 보존한다. 원본 source commit,
각 전체 byte/hash와 RSA2048 공개 인증서 DER의 SHA256은 manifest.json에 고정한다.
private key는 가져오지 않는다. APK를 설치하거나 실행하지 않고 SDK verifier의 입력으로만 쓴다.

원본 [테스트 디렉터리](https://android.googlesource.com/platform/tools/apksig/+/184702d9d18877edf9e5296c4e191cf0aa2b5fbb/src/test/resources/com/android/apksig/)의
정상/서명이 맞지 않는 v2-only RSA2048 fixture다. 원본 테스트처럼 API24 이상을 명시한
`apk-fixture-verified-api24` mode로 검사한다. 이 결과는 실제 BARO APK를 검사하는
`apk-verified` report로 받을 수 없으며 실제 앱 검사는 manifest의 기본 지원 범위를 사용한다.

`Mobile Android host preflight`는 실제 설치 SDK의 apksig API로 정상 fixture의 공개 인증서
hash 일치와 잘못된 서명 거부, 소유 AVD 생성/탐색을 확인한다. emulator boot·BARO UI/native
IPC·원격 API·물리 기기·스토어 인수를 뜻하지 않는다. 전체 앱 실행은 별도 manual workflow다.
