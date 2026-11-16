# 작업 공간과 공개·이전 버전 화면 이관

#818 위의 마지막 제품 화면 검토 단위다. 기존 업무 API·DB·계약과 랜딩을 유지하고 다음 실제 화면을 Tailwind/Headless UI로 연결한다.

| 영역 | 새 구성과 보존 경계 |
| --- | --- |
| Workspace·타임라인·행동·원본 | `product-ui/workspace`의 controller와 view. chooser·IME·draft·owner·CAS·ACK·재시도·scroll·부분 처리/원본 접근을 유지 |
| v1 사건 | `product-ui/legacy-case`. schemaVersion1 분기와 native HTTP·질문/모름/건너뛰기·결과/출처·평가·재시도·삭제를 유지. 자동 재분석·v2 변환 없음 |
| 재생기 | `product-ui/playback`. 실제 native decoder·seek/EOF·볼륨/음소거·배속·접근 잠금·해제 시 자동 재생 방지·src/unmount 정리 |
| 로그인·동의 | `product-ui/public`. 기존 provider/복귀/오류/동의 버전·unchecked/pending 계약 유지. 순수 ProviderIcon을 계정 화면과 공유 |
| 도움말·정책·404/410 | 기존 ProductLayout의 head/CSP/cache/focus를 사용하는 ProductPublicLayout. 전체 정책 문구·버전/섹션 ID·상태 코드를 유지 |
| 공통 확인 | ProductExperience. 기존 confirm queue·취소/경로/세션/원본 연결 확인을 유지. 취소 초기 포커스와 반환, 명시적 버리기만 승인 |

기존 컴포넌트 public export는 facade로 유지한다. Workspace는 네 구간과 I/O closure별로 원문을 대조했으며, JSX factory를 분리한 전체 prefix가 연속 byte 동일하다고 주장하지 않는다. 상세 증거는 [검토 기록](../quality/product-surfaces/README.md)에 있다.

CUA와 독립 검토에서 발견한 표시/접근성 문제도 반영했다. 공개 문서 시작 링크와 홈 이름을 복구했고, v1 답변의 번호가 hydration 뒤에도 이름에 남도록 visible label을 맞췄다. Select의 선택적 native `aria-label`을 보존해 배속 이름을 복구했다. 기본 Select의 문맥 label은 유지한다. 자료 추가 영역은 secondary variant로 아이콘·안내 문구 대비를 유지한다.

Workspace dialog는 모바일에서 전체 폭의 하단 sheet로 열리고, 원본/교정의 하단 작업 영역은 불투명한 sticky footer로 남는다. DS의 기존 center dialog 기본값과 동작은 바꾸지 않았다.

정적 production graph에서는 이전 interactive scene/control의 미이관 경로를 찾지 못했다. 공통 legal footer·폰트/테마/포커스·shell geometry·문서/print CSS와 일부 격리 compatibility CSS는 보존한다. 모든 legacy CSS나 미도달 파일을 삭제한 작업은 아니다. 미사용 ToolResults의 새 endpoint/UI 연결은 추가하지 않았다.

성능 변경은 #811(history body batch)·#814(report head covering index)의 독립 검토 단위다. UI 스택의 API·DB는 원래 계약을 유지하며, 이 두 PR의 query plan/호출 계측과 원격 실제 지연은 구분한다. main 병합·원격 migration·배포는 수행하지 않는다.
