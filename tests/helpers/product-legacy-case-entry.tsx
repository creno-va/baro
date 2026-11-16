import { useState } from "react";
import { createRoot } from "react-dom/client";
import { setTheme } from "../../src/client/theme";
import { CaseDetail } from "../../src/components/analysis/CaseDetail";
import { Button } from "../../src/product-ui/Button";
import { GlobalProductTheme } from "../../src/product-ui/GlobalTheme";
import { caseId } from "../fixtures/contracts";

const labels = [
  "합성 결과",
  "합성 질문",
  "합성 실패",
  "합성 지원 범위",
  "합성 긴급 안내",
  "합성 진행 중",
];
function Fixture() {
  const [selected, select] = useState(0);
  const identity = caseId.slice(0, -1) + selected;
  return (
    <GlobalProductTheme className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8">
      <header className="space-y-4 border-b border-[var(--pui-border)] pb-5">
        <h1 className="text-xl font-semibold">v1 사건 화면 · 로컬 합성 검증</h1>
        <p className="text-sm leading-7 text-[var(--pui-muted)]">
          독립된 로컬 HTTP harness입니다. 실제 CaseDetail과 native 요청을 합성 응답으로 확인하며,
          로그인·실제 사건·DB·외부 공급자를 사용하지 않습니다. 삭제 요청은 허용하지 않습니다.
        </p>
        <nav aria-label="합성 v1 상태" className="flex flex-wrap gap-2">
          {labels.map((label, index) => (
            <Button
              key={label}
              variant="secondary"
              aria-pressed={selected === index}
              onClick={() => select(index)}
            >
              {label}
            </Button>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setTheme("light")}>
            합성 밝은 화면
          </Button>
          <Button variant="ghost" onClick={() => setTheme("dark")}>
            합성 어두운 화면
          </Button>
        </div>
      </header>
      <div className="case-shell min-w-0">
        <CaseDetail key={identity} caseId={identity} />
      </div>
    </GlobalProductTheme>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
