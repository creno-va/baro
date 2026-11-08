/* biome-ignore-all lint/suspicious/noArrayIndexKey: Static numbered fixture rows never reorder. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { installAppFocus } from "../../src/client/app-focus";
import { AppNavigation } from "../../src/components/ui/app-navigation";
import { Button } from "../../src/components/ui/button";
import { Dialog } from "../../src/components/ui/dialog";
import { CaseWorkspaceFrame } from "../../src/components/ui/workspace-frame";
import { CaseNavigation } from "../../src/components/workspace/CaseNavigation";

function MaterialsFixture() {
  const [nested, setNested] = useState(false);
  return (
    <div className="shell-fixture-materials">
      <p>합성 자료 패널 · 기능 데이터는 소비자가 제공합니다.</p>
      <label htmlFor="correction">자료 교정 초안</label>
      <input id="correction" defaultValue="" />
      <Button
        variant="outline"
        onClick={(event) => {
          event.currentTarget.focus();
          setNested(true);
        }}
      >
        자료 확인창
      </Button>
      {Array.from({ length: 10 }, (_, index) => (
        <p key={`static-${index}`}>
          자료 {index + 1} · {"아주 긴 한글 파일명과 확인할 내용 ".repeat(3)}
        </p>
      ))}
      <a href="/?document" className="ui-button ui-button--outline">
        리포트 열기
      </a>
      <Dialog open={nested} onOpenChange={setNested} title="합성 자료 확인">
        <p>안쪽 확인창을 닫아도 자료 패널은 유지됩니다.</p>
      </Dialog>
    </div>
  );
}
function Fixture() {
  const [open, setOpen] = useState(new URLSearchParams(location.search).has("open"));
  const documentMode = new URLSearchParams(location.search).has("document");
  const noPanel = new URLSearchParams(location.search).has("no-panel");
  return (
    <div className="app-frame app-frame--product" data-product-ui="refresh" data-app-workspace>
      <AppNavigation
        role={"user" as const}
        pathname="/cases/shell-case"
        availableRoutes={["/app", "/lawyers", "/settings"]}
      />
      <div className="app-surface">
        <main id="main-content" tabIndex={-1}>
          <CaseWorkspaceFrame
            header={
              <CaseNavigation
                caseId="shell-case"
                title={"보증금을 돌려받기 위해 사실과 자료를 차근차근 정리하는 아주 긴 사건 제목"}
                active="chat"
                fileCount={10}
              />
            }
            panel={noPanel ? undefined : <MaterialsFixture />}
            panelOpen={open}
            onPanelOpenChange={setOpen}
            kind={documentMode ? "document" : "conversation"}
          >
            {documentMode ? (
              <article className="shell-fixture-document">
                <h2>내 사건 이해와 해결 준비</h2>
                {Array.from({ length: 40 }, (_, index) => (
                  <p key={`static-${index}`}>
                    {index + 1}. 긴 문서의 합성 본문입니다. 지금 확인된 사실과 앞으로 준비할 자료를
                    읽습니다.
                  </p>
                ))}
              </article>
            ) : (
              <div className="shell-fixture-chat">
                <section
                  className="shell-fixture-messages"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: This bounded message region must support keyboard scrolling.
                  tabIndex={0}
                  aria-label="합성 대화"
                >
                  <h2>사건을 함께 정리해요</h2>
                  {Array.from({ length: 30 }, (_, index) => (
                    <p key={`static-${index}`}>
                      대화 {index + 1} ·{" "}
                      {"날짜와 자료에서 확인한 내용을 함께 정리하고 있어요. ".repeat(2)}
                    </p>
                  ))}
                </section>
                <label className="shell-fixture-composer">
                  메시지 초안
                  <textarea
                    defaultValue=""
                    // biome-ignore lint/a11y/noAutofocus: This opt-in fixture reproduces a consumer's initial composer focus.
                    autoFocus={new URLSearchParams(location.search).has("focus")}
                  />
                </label>
              </div>
            )}
          </CaseWorkspaceFrame>
        </main>
      </div>
    </div>
  );
}
installAppFocus(document);
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
