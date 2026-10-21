# 사진 근거와 HTML 기반 PDF 리포트

- 결정 근거: 2026-10-21 직접 사용자 요청, #312. 기존 #66 리포트 계약의 저장 UI를 변경한다.
- 범위: 상해·진단서 사진의 자료 관찰, 사건 정리 활용, 사용자 선택 사진 포함, 서비스 UI 톤의 HTML 구성과 PDF 저장. 새 모델/공급자·결제 경로·migration을 추가하지 않는다.

## 관찰과 확인

Vision은 보이는 상태, 문서 기재, 확인 필요를 한국어로 구분한다. 문서상 진단명은 문서 기재로 인용하며 독립적인 진단·중증도·원인·상처의 시기·진정성으로 단정하지 않는다. 읽기 어려운 항목은 보완하지 않고 해당 칸 전체/확대 사진을 요청한다. 촬영일·사진 부위·사건과의 관계가 없으면 구체적으로 확인한다. 개인식별 번호·주소·전화번호는 관찰에 옮기지 않는다.

관찰은 기존 sourcePosition·자료 revision·included/userEdited/uncertainty와 함께 사건 채팅에 전달되고 리포트의 자료 처리 범위에 반영된다. 사용자 교정은 검증 사실로 바뀌지 않는다. 질문 2×3·AI200/일과 기존 출처 검증을 유지한다.

## 선택과 개인정보

`client_review_v1` snapshot에 선택적 `includedPhotoIds`(중복 불가, 최대12)를 추가한다. 없으면 빈 목록이다. canonical selectedFiles의 현재 소유 자료·revision·원본 hash에 묶이며 excludedFileIds와 겹칠 수 없다. 자동 선정하지 않는다. 현행 JPEG/PNG/WebP만 포함하며 한 장5MB·합계8MB로 Workers 메모리를 제한한다. 다른 포맷은 JPG/PNG 사본을 등록한다. 기존 모든 업로드 포맷의 분석·원본 보관은 유지한다.

이미지 픽셀에 식별정보를 자동으로 지웠다고 표시하지 않는다. 식별정보 가림을 켜면 선택값을 보존하되 HTML과 PDF에서 사진을 통째로 제외하고 원본도 읽지 않는다. 사진 포함은 가림을 끄고 사진 안의 개인정보를 직접 확인해야 한다. 이름·자료 버전·한계 설명을 각 사진에 붙인다. 제외/삭제·소유권·세션 변경과 원본 stream/hash 실패는 export를 중단한다.

## 조판과 저장

동일한 `createReportHtml`을 미리보기와 PDF 입력으로 사용한다. 사용자의 문자열은 모두 escape하며 사진은 해시가 확인된 private 원본의 data URL만 사용한다. PDF 입력에는 기존 배포 TTF를 내장한다. 기존 비공개 Container에 고정 WeasyPrint62.3-1을 추가하고 JS 없이 A4로 조판한다. URL fetcher는 허용 data 이미지/TTF와 고정 브랜드 SVG만 받는다. 외부 HTTP·로컬 파일·임의 SVG를 차단한다. 사진을 미리 검증하여 잘못된 사진을 조용히 빠뜨리지 않는다. EXIF 회전 후 재인코딩으로 PDF 사진의 메타데이터를 없앤다. 문서100페이지·입력20MB·출력24MB·240초 처리와 기존 stop/revoke를 유지한다.

신규 report job은 회수 가능한 `native-v1-report-UUID-1` runtime 이름을 사용한다. 기존 draft의 report-local 이름은 동일 lease 아래 CAS로 등록 전환한다. 삭제는 native를 먼저 revoke하고 Workflow가 없는 보고서 작업을 구분한다. native 실행은 기존 기술 admission과 비용 관측을 거친다. 가격/재원 관측 누락은 관측 전용 모드의 실행을 막지 않으며 usage는 unknown을 보존한다. PDF는 기존 암호화/물리 용량/lease/fence 경로로 저장한다. 실제 runtime에 텍스트 PDF fallback은 없다. 기존 writer는 명시적 preview 테스트 대역에만 남긴다.

사용자 다운로드 UI는 PDF만 노출한다. HTML endpoint는 첨부 저장이 아닌 내부 미리보기용 inline/private/no-store다. 기존 원본 ZIP API·암호화 보관·삭제·이력은 호환을 위해 보존하며 새 리포트 저장 UI에는 노출하지 않는다. 기존 저장 PDF의 바이트를 바꾸거나 재조판하지 않는다.

## 검증

- `tests/reports-photos.test.ts`: 실제 SQL/암호화에서 관찰→본문, 선택→HTML/PDF 입력, 마스킹 무IO, 다른 소유자/중복/제외/버전 변경 거절, native 실행 관측.
- `services/file-processor/report-test.py`: 실제 앱 HTML과 한글 TTF로 오프라인 Linux 조판, 한글 추출·사진·가림·외부 리소스 차단, 모든 PDF 페이지 PNG 생성.
- `Report rendering` CI는 합성 입력만 사용해 pinned native layer를 검증하며 PDF/PNG를 검토용 artifact로 남긴다. `validate:native/full`에도 같은 fixture가 포함된다.
- 브라우저는 PDF 단일 저장·사진 선택 저장/미리보기·접근 변경·진행 시간·삭제 흐름을 확인한다. 실제 Gemini 사진 품질과 preview/production 배포는 별도 외부 인수이며 로컬 대역으로 대체하지 않는다.
