# CLI Zod3 제한 입력 관측 (#339)

main6201112의 원본 compiler Android40063714258·iOS40063716187이 진행되는 동안,
제품·의존성·공통 wire/원본 pin을 바꾸지 않고 CLI 잔여를 관측했다. 이는 보완/전체 보안
인수나 raw audit 성공이 아니다. 기존 [의존성 수정과 잔여](./DEPENDENCY-SECURITY-2026-10-24.md)를 따른다.

## 실제 validator와 작은 반례

[원본 관측](./cli-zod-2026-10-24/schema-observation.json)은 실제 CLI58.1.14의
PluginSchema·DevToolsPluginOutputSchema·MCP command schema를 Node child에서 호출했다.
정상 합성 plugin/output/command는 수용하고 미등록 command와 추가 field는 거절했다.
실제 output schema에 잘못된128/256/512개 항목을 주면 top-level issue도 각각128/256/512개였다.

별도의 같은 `array(preprocess(number)).max(1)` 반례에서 CLI의 Zod3.25.76은 초과512개를
끝까지 방문해513개 issue를 만들었고, 제품 Zod4.6.6은 원소 방문0/issue1로 거절했다.
이 **별도 반례 schema가 실제 CLI에 구성돼 있다는 주장은 아니다.** 실제 CLI schema와
라이브러리 반례의 결과를 분리한다. 큰 입력/OOM·전체 CLI 도달성·실제 악용 가능성은 검증하지
않았고 이 결과로 advisory를 false positive로 분류하지 않는다.

재현은 `tests/fixtures/toolchain-security/zod-cli-probe.cjs`의 고정 합성 입력만 사용한다.
검사는 Node old-space 상한128MiB·7.5초 deadline을 사용한다. 이것은 process RSS/전체
peak 한도 증명이 아니다. 원문/stack을 내보내지 않고 stderr는 버린다. dev server/network/
provider를 실행하지 않으며 root/private config나 실제 plugin 명령을 실행하지 않는다.

2026-10-24 registry 조회에서 최신 CLI58.1.15도 Zod `^3.25.76`을 요구하며 안정 Zod3의
최신은3.25.76, node-forge 최신은1.4.0이었다. 호환 가능한 새 upstream을 확인하거나
검증된 보완이 필요하며 raw node-forge/CLI Zod3 high를 유지한다. CLI를4로 강제하지 않는다.

## local export graph 범위

[두 OS local export 관측](./cli-zod-2026-10-24/local-export-graph.json)은 같은 source6201112와
실제 Metro/Hermes export의 source map을 읽었다. Android1456/iOS1465 source 각각에
Zod4 source93개·Zod3 source0개가 관측됐다. CLI source는 각각1개이며
`@expo/cli/build/metro-require/require.js`다. CLI 코드 전체가 없다고 표현하지 않는다.
raw source map은 로컬에만 생성했고 공개 artifact/문서에는 source code·map을 담지 않는다.

이 graph는 local export이며 실제 compiler APK/app과의 full HBC byte 대조 전에는
compiledArtifactMatched=false다. HBC byte/hash와 map hash만 보존해 이후 원본과 비교할 수
있게 한다. 이 결과를 native SDK 실행/공급자·계정/API·실기기/스토어·#339/#71 인수로
확대하지 않는다. 반례와 graph 관측은 보안 잔여의 구체적 경계를 좁히며, 해결을 대신하지 않는다.

frozen `bun ci`·quick121개/24파일·모바일/공통419개·RN88개와 관련9개/3파일이 통과했다.
제품/의존성/공유 계약을 변경하지 않아 product build·DB migration은 반복하지 않는다.
생성된 두 OS local export 관측과 실제 compiler/실행 증거를 위와 같이 구분한다.
