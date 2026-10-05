# v2 R2·Containers 자료 처리 운영

- Status: Implementation target — 자원 생성·실제 처리·복구 성공 증거 아님
- 기준: 2026-10-06, 명세 #53; 저장 #58, 처리 #59, 삭제 #67, 실제 검증 #71
- 참조: [시스템](../architecture/SYSTEM.md), [암호화 키](./CASE-DATA-KEYS.md), [삭제/복구](./DELETION-RESTORE.md), [비용](./COST-CONTROLS.md)

## 현재 구현과 새 자원 구분

v1은 텍스트 사건용 D1·Workflow이며 제품 R2·파일 처리 Containers는 아직 구현/등록되었다고
볼 수 없다. 아래 이름·binding은 구현 목표다. Cloudflare 목록·binding·image digest·실제 smoke를
확인한 환경만 readiness에 `configured`로 기록한다. 임시 AI probe Worker는 제품 파일 처리 자원이 아니다.

| 환경 | private bucket 목표 | public bucket 목표 | 처리 격리 |
| --- | --- | --- | --- |
| preview | baro-preview-private | baro-preview-public | preview 전용 Worker/DO/Container |
| production | baro-production-private | baro-production-public | production 전용 Worker/DO/Container |
| isolated-test | 운영자가 명시 지정한 baro-drill-* | 운영자가 명시 지정한 baro-drill-* | 합성 전용 D1/R2/Worker/DO/Container |

local은 합성 파일과 개발 키만 사용한다. production 키/자료를 preview·local에 복제하지 않는다.
private에는 사건 원본·파생 자료·리포트·ZIP와 비공개 프로필 초안이 들어간다. 자격 확인 자료는
별도 권한 scope로 분리해 담당 심사자만 읽고, 그 권한으로 사건 자료를 읽을 수 없게 한다.
public에는 심사를 통과한 공개 revision의 정제된 프로필 사진·포트폴리오만 복사한다.
draft/pending/rejected 객체를 public에 먼저 올리지 않는다.

## Provisioning 순서

1. 계정·환경·기존 결제 계획과 [월 예산](./COST-CONTROLS.md)을 확인한다. 합의한 예산 내
   리소스 생성은 허용되며 새 결제수단·자동 충전·예산 확대는 별도 승인이다. Containers에 필요한
   계정 기능/계획이 현재 활성인지 확인하고 새 결제 계약이 필요한 경우 생성했다고 가정하지 않는다.
2. 환경별 private/public bucket을 별도로 만들고 소유 계정·실제 bucket ID/이름·관리자·생성 시각을
   비민감 자원 등록부에 기록한다. private는 r2.dev/custom-domain 공개를 끄고 공유 S3 credential을 만들지 않는다.
3. 공개 자산도 초기에는 Worker의 approved-revision 검사 뒤 제공한다. 공개 전환 때만 허용된
   공개 경로/cache 정책을 활성화한다. bucket public access는 bucket 전체 인터넷 접근을 만들 수
   있으므로 공개 자료와 private 자료를 한 bucket에 섞지 않는다. [R2 공개 bucket](https://developers.cloudflare.com/r2/buckets/public-buckets/)
4. Workers의 환경별 `PRIVATE_FILES`/`PUBLIC_PROFILE_ASSETS` 목표 binding과 최소 권한을 연결한다.
   이름은 최종 계약 #54/#58에서 확정한다. root 계정 credential을 제품 Container에 전달하지 않는다.
5. image를 고정 digest로 빌드/검사하고 처리 Worker/DO·Container binding을 환경별로 등록한다.
   instance type·최대 동시 실행·CPU/메모리/disk·실행 제한·idle 종료를 명시한다. 정확한 값은 실제
   최대 크기 fixture로 측정하여 #59에 기록하고 미설정 값은 fail-closed로 처리한다.
6. public URL 없음/환경 분리/소유권/본문 무로그/비용 제한/취소·삭제를 합성 실제 파일로 검증한다.
   Container 프로세스 재시작·Worker rollback에서 진행 중 job이 중복 과금이나 결과 부활을 만들지 않아야 한다.

## Upload와 저장

파일 크기는 decimal byte 기준이다. 문서·이미지 100,000,000 bytes, audio/video 1,000,000,000 bytes와
60분, PDF 500 pages를 허용한다. 사건당 원본 100개/원본 합계 5,000,000,000 bytes이며
pending 원본 예약도 포함한다. 계정 저장 10,000,000,000 bytes에는 원본·파생·리포트·ZIP·
프로필 자산과 pending reservation이 포함된다. 파생물·리포트는 사건 원본 5GB를 차감하지 않는다.
실제 암호화 overhead와 중복 보관 비용은 별도 비용 ledger에도 반영한다.
파일 MIME/확장자만 신뢰하지 않고 실측 byte·format·duration/pages를 검사한다.

Workers 요청 body 제한 때문에 1GB 파일을 단일 HTTP 요청이나 메모리에 담지 않는다.
인증·소유권·Origin·동의·quota 예약 후 8MiB 이하 원본 part를 streaming으로 받아 별도 nonce와
chunk AEAD로 암호화하는 upload gateway를 사용한다. 형식별 처리 방식과 AAD는 architecture
계약을 따르고 R2에 평문 임시 원본을 쓰지 않는다. 완료 전 part는 `pending`이며 다른 소유자나
처리 job이 읽지 못한다. immutable file revision·part 순서/길이/무결성 manifest가 모두 일치해야
ready로 전환한다. 누락·중복·변조·truncation은 실패한다. [Workers 제한](https://developers.cloudflare.com/workers/platform/limits/)

반복 요청은 upload idempotency/part 번호로 동일 예약을 재사용한다. 만료·중단 upload의 part와
multipart 상태를 journal로 정리하고 예약을 해제한다. logical quota를 해제한 시각과 원격 객체가
정말 삭제된 시각을 구분한다. R2 multipart API의 upload/complete/abort 순서를 준수한다.
[R2 multipart](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)

download는 현재 owner/role/revision과 삭제 상태를 다시 확인하는 Worker 경유다. 사건 원본과
리포트에 CDN/public URL을 만들지 않고 `Cache-Control: private, no-store`를 적용한다. opaque
객체 키에도 사람 이름·원래 파일명·사건 종류를 넣지 않는다. 파일명·metadata와 원본 hash는
owner에게만 제공하며 로그·경보·공개 artifact에 쓰지 않는다.

## 처리 job

사용자가 파일별 자동 처리와 외부 AI/음성 처리를 확인한 후에만 job을 생성한다. 동의 버전,
file revision, 분석 범위, quota·비용 reservation, 실행 attempt, lease·취소 상태를 durable하게 저장한다.
업로드 직후 quota/예산이 부족하면 `waiting-for-quota`로 표시하고 비용을 사용하지 않는다.
삭제·동의 철회·revision 변경 후 오래된 job은 시작/결과 commit을 거부한다.

Container는 한 job의 복호화 stream과 제한된 output capability만 받는다. 전체 사건 snapshot,
다른 owner의 객체, production secret, 암호화 master key를 받지 않는다. capability는 job/revision/
목적/짧은 만료에 묶고 재시작·취소 시 재검사한다. 내부 HTTP와 로컬 파일 처리가 필요해도
외부 임의 URL·shell 입력·모델·법률 API를 직접 호출하지 않는다. AI는 `llm-gateway`, 법률 자료는
`legal-retrieval`에서 Workers가 호출한다. 처리 sandbox의 network allowlist와 DNS/redirect 우회
거부를 검증하며 parser child process의 stderr에 원문/경로를 출력하지 않는다.

문서 text/OCR·이미지·audio/video의 실제 추출 범위를 기록한다. 음성은 합의한 Cloudflare
Whisper-large-v3-turbo 경로의 전 구간 전사를 사용한다. video는 전 audio와 매 1초 + 장면 변경
frame을 처리하며 모든 frame을 확인했다고 표현하지 않는다. timestamp·처리 구간·누락/저품질
구간·오류·출처 파일 revision을 남긴다. vision/ASR의 계정별 실제 지원은 #71 smoke로 증명한다.
미지원 format은 조용히 건너뛰거나 완전 처리로 표기하지 않는다.
모델의 공개 식별자는 `@cf/openai/whisper-large-v3-turbo`이며 모델/요청 가격·전사 응답은
[공식 모델 문서](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)를
대조한다. 문서상 제공과 계정별 실제 처리 성공은 구분한다.

## 종료·실패·삭제

완료 결과는 형식·coverage·무결성·owner·삭제 가드를 검증한 뒤 private encrypted R2와 D1
revision에 commit한다. 결과를 리포트에 사용할 때 파일 원본과 파생물의 출처를 보존한다.
중간 실패는 제한된 retry를 사용하고 사용자 일일 quota는 중복 차감하지 않지만 실제 재실행
비용은 ledger에 남긴다. parser hang/OOM/zip bomb/악성 PDF/깨진 media는 worker 상태를
안전하게 실패시키며 자동 무한 재시작하지 않는다.

ephemeral plaintext·temporary disk·process buffer는 성공·오류·취소 때 모두 정리한다. sleep이
임시 disk 삭제를 보장한다고 가정하지 않으며 재사용 instance는 이전 job 흔적을 읽을 수 없어야 한다.
삭제 job은 Container 종료와 모든 원본/part/파생물/PDF/ZIP·공개 copy·cache purge를 확인하고
늦은 result의 재등록을 막는다. 세부 재삭제·restore 기준은 [삭제 runbook](./DELETION-RESTORE.md)을 따른다.

## 실제 증거와 장애 대응

#71에서 같은 candidate SHA/image digest/환경의 upload→실제 처리→재열람→PDF/ZIP→삭제를
시연하고 무단 owner 읽기·틀린 part·중단·용량/시간/page 제한·Container crash·동의 철회·late
result를 검증한다. 증거에는 파일 내용이나 hash 대신 합성 fixture ID·크기/coverage 건수·통과
여부·run URL만 남긴다. 입력/원본/음성/frame은 CI artifact에 포함하지 않는다.

비용 초과·parser 취약점·환경 혼합·평문 보관 의심은 새 job을 닫고 정상 조회/삭제를 유지한다.
임의 재처리 전에 기존 attempt·billing·원격 객체 상태를 조사한다. 모델 장애 때 다른 공급자로
자동 전환하지 않는다. public 자산 문제는 공개 pointer 철회→cache purge→object 삭제를 수행한다.
