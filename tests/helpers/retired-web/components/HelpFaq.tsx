import { Disclosure, DisclosureSummary } from "./ui/disclosure";
export function HelpFaq() {
  return (
    <section className="policy-card" id="reports">
      <h2>리포트와 다운로드</h2>
      <Disclosure>
        <DisclosureSummary>PDF를 받기 전에 무엇을 확인하나요?</DisclosureSummary>
        <p>
          사실·주장·미확인·상반되는 내용과 날짜·금액·출처·자료 처리 범위를 확인하세요. 내용과
          식별정보 가리기, 선택 사진을 확인한 뒤 PDF로 저장할 수 있어요. 이름·주소는 직접
          수정하세요.
        </p>
      </Disclosure>
      <Disclosure>
        <DisclosureSummary>PDF에서 가리면 원본도 가려지나요?</DisclosureSummary>
        <p>
          원본 파일 자체는 바뀌지 않아요. 자동 가림을 켜면 근거 사진은 PDF에서 통째로 제외돼요.
          사진을 포함하려면 자동 가림을 끄고 사진 안의 개인정보를 직접 확인하세요. 자료 제외를
          저장하면 본문을 다시 구성하며, 기존 편집 내용은 이전 버전에 보관돼요. 화면에서 미리 확인한
          리포트는 PDF로 저장할 수 있어요.
        </p>
      </Disclosure>
      {import.meta.env.PUBLIC_API_MODE === "mock" && (
        <Disclosure>
          <DisclosureSummary>API 예시 응답의 다운로드는 무엇인가요?</DisclosureSummary>
          <p>
            예시 모드에서는 실제로 열리는 합성 PDF와 ZIP을 만들어요. 실제 자료 처리 결과와 구분해서
            확인하세요. ZIP에는 직접 선택하고 보존한 원본만 넣어요. 원본을 찾을 수 없으면 오류를
            확인하고 파일을 다시 선택하세요. 실제 OAuth·AI·R2 처리 결과가 아니에요.
          </p>
        </Disclosure>
      )}
      <Disclosure>
        <DisclosureSummary>새 버전과 이전 수정 내용</DisclosureSummary>
        <p>
          사건 내용이 바뀌면 리포트를 다시 만들 수 있어요. 먼저 현재 편집 내용을 저장하세요. 이전
          버전의 다운로드는 그 버전의 저장 내용을 사용하며 새 초안을 다시 확인해야 해요.
        </p>
      </Disclosure>
    </section>
  );
}
