# 자료 첨부와 판례·조회 UI

기준은 #817 `f82400cf9966c7daecbef5b1275f4b3642be7506`이다. 기존 자료·판례 컴포넌트 10개는 public props를 유지하는 facade로 두고, Tailwind 화면과 controller를 `src/product-ui/evidence`, `src/product-ui/research`로 분리한다. API·DB·공유 클라이언트·업로드 구현·법률 계약은 변경하지 않는다.

| 화면 | 보존한 동작 |
| --- | --- |
| 자료 추가·선택·대화 첨부 | native file input/ref/accept/multiple/capture, dirty·동의·처리 상태·파일 제거, preview URL 수명, chooser 오류·재시도 |
| 자료 요구·사건 자료 | coverage와 부분 처리 안내, 대화에 사용할 자료 선택, 실제 FileReview 조립과 원본 확인 |
| 판례 검색·읽기 | 최대 2주제, 공식 출처·signed read·유효기간·owner/revision, 검색/원문 오류와 포커스 복귀 |
| 판례 비교 | 8기준·yes/no/unknown·양쪽 근거·불리한 내용·부분 사실, 작업 상태·기준 변경·재확인 잠금 |
| 외부 조회 | 설정된 서비스만 표시, 직접 입력·수신처·동의 초기화, 같은 요청/ACK·owner guard |

원본 controller 구간 byte 비교와 기능 속성 AST 비교는 [검토 증거](../quality/product-materials/README.md)에 기록한다. `useEvidenceUpload.ts`와 처리·업로드 transport는 그대로 유지한다. `.precedent-body`는 문서 의미 구조를 검사하는 기존 hook으로 남긴다.

판례 CSS는 기존 파일을 legacy layer로 가져오며 새 화면은 product DS를 사용한다. 브라우저 consumer 3개의 선택자와 실제 API owner를 가리키는 테스트 resolver 경로만 바꾼다. 기존 권한·원문·geometry·Axe·호출 수 단언을 축소하지 않는다. 전용 보존 검사가 이 경계를 검사한다.

기본 mock의 판례 search/read는 합성 응답이다. 비교 API와 외부 조회 catalog는 이 mock에서 연결되지 않으며 오류·불가 UI로 표시한다. 완성된 비교 결과의 상태별 표시는 계약 fixture와 기존 회귀 검사로 확인한다. 원격 공급자·운영 데이터·배포의 성공으로 해석하지 않는다.

남은 후속 범위는 standalone Workspace의 타임라인·행동·모달 조립, v1 상세와 공개/인증 화면이다. 이후 통합 검사에서 active import와 미이관 화면을 다시 확인한다.
