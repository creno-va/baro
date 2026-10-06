# BARO 파일 처리 성능 연구 — #59

- Date: 2026-10-06 KST
- 연구 시간 상한: 60분, 21:45:53 KST 착수
- Baseline: `b6cfdfe3676506bf2b4880af0911138a9b3f107e`의 `processor.py`
- Worktree/branch: `file-processing-performance` / `codex/59-file-processing-performance`
- 범위: 기존 PDF/TXT, raster image, audio/video의 offline native 처리

## 결론과 후보

4페이지 합성 텍스트의 native 처리 중앙값은 0.1412→0.0670초(약53% 감소),
Python peak RSS는 47.3→37.0MiB(약22% 감소)였다. 600만 픽셀 RGB PNG의 peak RSS는
97.9→75.2MiB(약23% 감소)였다. 1초/scene 샘플이 같은 시각에 겹치는 4초 영상의
native subprocess는 8→7개, 처리 중앙값은 0.2460→0.2193초였다.
13개 주 실험 구성에서 전후 **전체 manifest와 모든 산출물 bytes가 동일**했다.
일반 영상 전체의 속도 향상을 주장하지 않는다. 기존 off-second 영상과 31초 경계 영상은
subprocess 수가 그대로이며 작은 시간 차이는 측정 변동 범위다.

선택한 제품 변경은 세 가지다.

1. UTF-8/control 검증을 65,536 scalar 단위로 읽고, 선택 페이지를 100,000 scalar 산출물로
   스트리밍한다. 전체 파일의 UTF-8·control·page 수 검증은 유지한다. BOM은 앞에서만 제거하고
   CR/LF·emoji·빈 페이지·form-feed 경계·artifact 분할과 모든 문자를 보존한다.
2. 이미 RGB인 raster의 전체 `convert("RGB")` 복사를 제거한다. decode를 먼저 수행하고
   기존 thumbnail·resampler·JPEG quality를 유지한다. 다른 mode는 기존 RGB 변환을 수행한다.
3. 같은 unit의 **정확히 같은 timestamp**에 요청한 JPEG만 재사용한다. 별도 artifact 파일,
   ID/index/position/sampling/frameIndex, output bytes와 모든 coverage 항목은 유지한다.
   비슷한 장면·인접 시각·다른 unit 사이의 캐시는 도입하지 않는다.

새 형식, codec, 모델/공급자, 한도 완화, shared 계약, schema, Workers orchestration은 변경하지 않았다.
선택한 변경 때문에 페이지·샘플·시간 구간을 생략하지 않는다.

## 지침·이슈 확인

[AGENTS](../../AGENTS.md), [EXECUTION](../development/EXECUTION.md), README, work graph,
[ADR-0010](../adr/0010-multimodal-ai-and-transcription.md),
[AI pipeline](../architecture/AI-PIPELINE.md), processor/server/Dockerfile/fixture-test와
[기존 media manifest](../../tests/fixtures/media/manifest.json)를 읽었다.
`bun run work:next`는 #57/#58/#59를 `IMPLEMENTATION_MERGED`로 확인했다.
[#59](https://github.com/creno-va/baro/issues/59)는 OPEN이며
[PR #89](https://github.com/creno-va/baro/pull/89)는 2026-10-06 main 병합 및 native/Quality gate SUCCESS다.
실제 Containers/Whisper/R2/model, 외부·공개 acceptance와 #71 gate는 남아 있다.
이번 연구는 이슈 종료나 배포를 수행하지 않는다.

## 실험 환경과 측정 경계

macOS 26.5 arm64, Python 3.12.14, Pillow 12.3.0, FFmpeg/ffprobe 9.0.1,
Poppler 26.05.0. 기본 PATH 밖의 **이미 설치된** 번들 native 도구를 사용했다.
로컬 Docker와 Tesseract는 없으며 설치하지 않았다.
Docker 이미지의 Linux 도구 버전/자원·청구 성능으로 수치를 일반화할 수 없다.

주 실험은 구성별 전후 각3회, 순서는 before/after→after/before→before/after다.
unit마다 새 Python interpreter에서 `inspect+process` 또는 `inspect+sanitize`와
산출물 파일/hash/manifest까지 측정한다. table은 unit 시간의 합과 파일별 peak의 중앙값이다.
JSON에는 모든 run, min/max, Python 시작을 포함한 wall time도 있다.
입력 staging, Node 시작, R2/Workflow/모델/Whisper/원격 Containers는 주 시간에 포함하지 않는다.

RSS는 OS `ru_maxrss` high-water mark다. Python worker와 가장 큰 native child를 **별도로**
기록한다. 두 peak의 합은 동시 합산 process-tree peak의 보수적 상한이며 실제 동시 peak가 아니다.
benchmark worker의 공통 import overhead도 Python RSS에 포함된다. native subprocess 수는
실제 pdfinfo/pdftotext/ffprobe/ffmpeg 호출이며 별도 Python unit 수를 표에 표시한다.
초기 독립 `/probe` 요청, Node 서비스 시작, fixture 생성 subprocess는 표의 job 수에서 제외한다.

한 번에 heavy job 하나만 실행했다. 주 실험 입력은 합계2,790,425 bytes/13개 구성/19개 unit이며
파일≤4MB, 생성 raster≤6MP, media≤31초, text≤4페이지, 반복≤3회로 제한했다.
기존 UI 개발 서버와 전체 native corpus를 로컬에서 추가 실행하지 않았다.
Node 검사는 localhost 임시 포트에서 짧은 합성 입력을 순차 처리하고 종료했다.
실제 Whisper·모델·원격 Containers 호출은 없었다.

## 주 실험 전후 측정

[원본 측정 JSON](./file-processing-performance-results.json).
RSS 단위는 MiB, 시간은 native 처리 초, 산출물 bytes는 전후 동일하다.

| 구성 | 처리 초 before→after | Python peak RSS | largest native child peak RSS | native subprocess (+Python unit) | 산출물 bytes |
| --- | --- | --- | --- | --- | --- |
| `pdf-text` | 0.0507 → 0.0506 | 32.0 → 32.8 | 12.1 → 12.0 | 4 → 4 (+2 Python) | 311 |
| `text-small` | 0.0120 → 0.0118 | 35.4 → 35.6 | 0.0 → 0.0 | 0 → 0 (+1 Python) | 317 |
| `image-png` | 0.0053 → 0.0052 | 38.6 → 36.1 | 0.0 → 0.0 | 0 → 0 (+1 Python) | 35,914 |
| `image-jpeg` | 0.0050 → 0.0045 | 38.7 → 36.2 | 0.0 → 0.0 | 0 → 0 (+1 Python) | 35,626 |
| `audio-wav` | 0.0667 → 0.0678 | 35.3 → 35.5 | 9.9 → 9.9 | 2 → 2 (+1 Python) | 228,878 |
| `video-silent` | 0.4625 → 0.4483 | 35.6 → 35.5 | 16.5 → 16.6 | 13 → 13 (+1 Python) | 124,128 |
| `video-audio` | 0.4642 → 0.4638 | 35.4 → 35.5 | 17.2 → 17.3 | 14 → 14 (+1 Python) | 378,158 |
| `text-bounded` | 0.1412 → 0.0670 | 47.3 → 37.0 | 0.0 → 0.0 | 0 → 0 (+4 Python) | 1,333,312 |
| `image-rgb-bounded` | 0.0395 → 0.0376 | 97.9 → 75.2 | 0.0 → 0.0 | 0 → 0 (+1 Python) | 147,496 |
| `video-coincident` | 0.2460 → 0.2193 | 35.3 → 35.6 | 14.0 → 14.1 | 8 → 7 (+1 Python) | 9,215 |
| `video-unit-boundary` | 1.0818 → 1.0815 | 35.4 → 35.6 | 14.6 → 14.4 | 37 → 37 (+2 Python) | 57,133 |
| `audio-unit-boundary` | 0.1397 → 0.1374 | 36.7 → 35.6 | 10.0 → 10.0 | 4 → 4 (+2 Python) | 992,156 |
| `pdf-sanitize` | 0.1730 → 0.1728 | 59.6 → 60.0 | 21.8 → 21.8 | 3 → 3 (+1 Python) | 136,621 |

## Coverage와 결과 동등성

| 구성 | 실제 검증한 범위 | 최종 native coverage |
| --- | --- | --- |
| text PDF | 2페이지 모두, manifest의 한/영 기대 문자열8개 모두 존재; OCR0회 | 각 페이지 processed/complete |
| TXT | fixture1페이지 및 생성4페이지, 모든 scalar·CRLF·분할 bytes·빈 페이지 | processed/complete |
| 이미지 | JPEG bytes, dimension, mode별 기존 변환 결과; PNG/JPEG/BMP/WEBP/TIFF 및 multi-frame GIF/TIFF 경계 | partial / observation missing 유지 |
| WAV | 7.15초; 생성31초의 [0,30)/[30,31) interval과 **모든 PCM sample** 보존 | partial / intervals missing 유지 |
| 8초 영상 | 1초 샘플8개, scene1.4/3.2초2개, decoder frame80개, audio 유무 | partial / observations·transcription missing 유지 |
| 31초 영상 | 샘플31개, unit별 decoder count60/2, 절대 frameIndex0..60(step2) | partial 유지 |
| 같은 시각 영상 | 샘플0/1/2/3초4개 + scene2초1개; 겹치는 두 artifact를 모두 유지 | partial 유지 |
| PDF sanitize | 텍스트 PDF2페이지를 모두 새 image-only PDF로 재구성; 전체 bytes 동등 | 처리 artifact 검증, OCR/vision 증거 아님 |

모든 주 구성의 전체 manifest를 비교했다. probe, totalUnits, unit, frameOffset,
decodedFrameCount, artifact 순서/index/kind/position/sampling/hash/size, coverage와 outputBytes가 같다.
각 파일의 실제 bytes도 독립적으로 비교했다. content/hash/raw frame/audio는 결과 JSON에 게시하지 않는다.
동등성은 동일 native 도구 버전의 전후 비교이며 실제 ASR/vision 정확도 평가가 아니다.

실제 [Node HTTP 검사](../../services/file-processor/performance-http-test.mjs)는 processor 위치,
native PATH와 loopback listen 설정만 임시 사본에서 바꿨다. 실제 ingress/hash/encoder/cleanup 코드는
그대로 실행했다. PDF2 unit, TXT, PNG, WAV, video, PDF sanitize의 총7 unit에서
전체 NDJSON bytes 동등·hash/order/complete·sanitize 두 pass·응답 전 job 디렉터리 삭제를 확인했다.
[HTTP 기록](./file-processing-http-equivalence.json)은 단1회씩의 확인이며 throughput 추정에 사용하지 않는다.

## 추가 기존 형식 경계 — 각1회, 2초 이하 합성 입력

[형식별 실제 native 실행 기록](./file-processing-format-boundaries.json)은 MP3/M4A/OGG/FLAC/AAC와
MOV/WEBM/AVI/MKV의 고정 입력을 사용한다. 생성 입력≤250KB이며 모든 실행은 직렬이다.
M4A/OGG/FLAC/AAC 및 네 video container에서 전후 manifest/bytes가 같았다.
네 video 입력은 0/1초 + scene1초를 보존하면서 native subprocess6→5였다.
표시 형식의 기존 decoder-family alias도 그대로다(MOV→mp4, MKV→webm).
MP3는 encoder start offset으로 전후 모두 `UNSUPPORTED_TIMELINE`이고 coverage를 게시하지 않았다.
이 단일 run의 시간 차이를 일반 codec 성능이나 새 지원 증거로 사용하지 않는다.

**기존 M4A 시간 경계 문제:** 2초 M4A가 interval[0,2]를 선언하지만 PCM은1.936초/30,976 samples다.
동일 입력을 `-ss 0` 없이 decode하면 clip 유무 모두2초/32,000 samples였다.
기존 input-seek-zero 경로의64ms 부족이 전후 동일하게 재현됐다.
이번 성능 후보는 audio 명령을 바꾸지 않으며 이 입력의 완전한 시간 coverage를 주장하지 않는다.
이 문제는 #59 실제 전체 구간 acceptance 전에 별도 품질 수정과 codec/segment 검증이 필요하다.

## 후보 검토와 제외 이유

| 검토 대상 | 관찰·결정 |
| --- | --- |
| 텍스트 PDF 불필요한 OCR | 이미 native text가 비었을 때만 OCR. 텍스트 PDF2페이지에서 pdfinfo2+pdftotext2, pdftoppm/Tesseract0. gate 변경 없음 |
| scan OCR | 실제 pdfinfo/pdftotext/pdftoppm까지 실행 후 Tesseract 부재. 전후 PROCESSING_FAILED, 완료 manifest 없음. OCR 시간/정확도/peak는 미측정 |
| 텍스트 반복 decode | 매 unit 전체 decode/split과 Python scalar별 control 검사를 chunk+regex로 대체. 전체 검증은 매 unit 계속 수행; 원본 재전송/검증 guard 우회 없음 |
| 일반 영상 단일 decode/fps=1 | 기존8초 fixture에서 출력8개는 유지하지만 픽셀이 다른 시각0/1/3초가 나왔다. scene-change 보존도 별도 필요하므로 후보 제외 |
| 임의 시각/유사 frame dedup | 요구 timestamp/frameIndex/coverage를 잃을 수 있어 제외. 정확히 같은 시각만 선택 |
| resize 후 RGB 변환 | 합성 RGBA에서 기존 변환 순서와 픽셀이 달라 후보 제외. RGB source만 복사 제거 |
| image metadata 일괄 삭제 | Pillow12의 기존 JPEG comment 유지 동작까지 바꾸면 bytes 동등성 실패. 별도 변경으로 남기고 현재 동작 보존; EXIF/ICC 전송 옵션 추가 없음 |
| PDF sanitize render 생략/재사용 | 새 image-only 문서가 원본 objects/action/attachments를 복사하지 않는 경로 유지. 전체2페이지 render 비용을 피하려고 페이지 생략하지 않음 |
| 임시파일 I/O | artifact hash reread≤1MiB, 서버 wire hash reread, scene/frame-index spool, 입력 staging을 확인. streaming text와 RGB 복사에서 먼저 확실한 이득 확보. hash/ephemeral directory/검증을 제거하는 zero-copy·교차 job cache는 선택하지 않음 |
| frame-index 전체 list | bounded30초 index decode/count는 absolute offset과 모든 frameIndex에 사용됨. index를 생략하거나 명목 FPS로 대체하지 않음. 고FPS streaming-index 대안은 추가 동등성 검증 전 미채택 |

한도는 input1GB, document/image100MB, PDF500pages, TXT100,000pages, image40MP,
media3600초, unit30초, artifact1MiB/20,000개, output512MiB, parent240초와 native timeout을 유지했다.
동일 timestamp cache는 현재 unit의 bounded artifact paths만 가진다. 저장/동의/삭제/retry/late-result guard는 변경하지 않았다.

## 검증과 재현

로컬 검증: Python syntax; focused native regression6개; 관련 Bun 계약/취소/hash/CI 테스트33개;
docs/work graph/boundaries/lint; Astro/TypeScript; build; `cf:dry-run --containers-rollout=none` 통과.
기존 lint 경고10개와 Astro hint10개는 유지했다. typecheck의 Wrangler 기본 log 경로는 sandbox에서
쓰기 경고를 냈지만 검사 종료코드는0이며 이후 build/dry-run log는 worktree 안으로 지정했다.
전체 case corpus·native fixture-test.py·E2E 서버를 로컬에서 반복하지 않았다.

기존 Linux native CI job에는 네트워크 없이512MiB/1CPU/pids128의 focused regression step을 추가했다.
로컬 Docker 실행으로 표현하지 않는다. PR의 Linux CI 결과는 아래 제출 기록에서 따로 확인한다.
실제 #59/#71 공급자·외부·공개 acceptance를 완료하지 않는다.

Pillow가 있는 기존 Python과 설치된 native PATH를 지정한다. 필요한 도구가 없으면 설치 없이
주 benchmark의 `skipped`에 표시하고 `--require-video` focused 검사의 미실행을 보고한다.

```sh
mkdir -p .wrangler/performance
git show b6cfdfe3676506bf2b4880af0911138a9b3f107e:services/file-processor/processor.py > .wrangler/performance/baseline.py
python3 services/file-processor/performance-benchmark.py --baseline .wrangler/performance/baseline.py --baseline-ref b6cfdfe3676506bf2b4880af0911138a9b3f107e --repetitions 3 --output .wrangler/performance/results.json
python3 services/file-processor/performance-test.py --require-video
python3 services/file-processor/performance-format-test.py --baseline .wrangler/performance/baseline.py --output .wrangler/performance/formats.json
node services/file-processor/performance-http-test.mjs .wrangler/performance/baseline.py "$(command -v python3)" "$PATH"
```

HTTP 검사는 localhost bind 권한이 필요하다. native PATH만 포함한 child 환경에서 실행하고 모든 fixture는
repository의 고정 합성 입력이다. benchmark/format 도구는 실제 모델/원격 Containers를 호출하지 않는다.
rollback은 processor 변경을 되돌리는 것으로 끝나며 migration/binding/secret 변경은 없다.

## 제출 기록

제출 형태는 `Refs #59`/`Refs #71`의 draft PR이다. 위 표와 JSON은 로컬 합성 실행 기록이며,
제출 source의 실제 Linux/Quality gate 상태는 해당 PR의 Checks에서 확인한다.
main 병합·배포·#59 종료는 수행하지 않는다.
