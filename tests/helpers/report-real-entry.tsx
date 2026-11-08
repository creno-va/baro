import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type ReportQuestionContext,
  ReportReview,
} from "../../src/components/reports/ReportReview";

function RetainedReportHost() {
  const [task, setTask] = useState<"chat" | "files" | "reports" | "drafts">("reports");
  const [question, setQuestion] = useState<ReportQuestionContext | null>(null);
  return (
    <main>
      <nav aria-label="합성 작업">
        {(["chat", "files", "reports", "drafts"] as const).map((id) => (
          <button key={id} type="button" onClick={() => setTask(id)}>
            {id}
          </button>
        ))}
      </nav>
      <div hidden={task !== "reports" && task !== "drafts"}>
        <ReportReview
          caseId={location.pathname.split("/")[2] ?? ""}
          embedded
          rework
          active={task === "reports" || task === "drafts"}
          initialSection={task === "drafts" ? "drafts" : "report"}
          onNavigateTask={setTask}
          onAskAboutReport={(context) => {
            setQuestion(context);
            setTask("chat");
          }}
        />
      </div>
      <div hidden={task !== "chat"}>
        <textarea aria-label="합성 대화 입력" defaultValue="보내기 전 문장" />
        {question && (
          <section aria-label="질문의 리포트 맥락">
            <pre>{JSON.stringify(question)}</pre>
          </section>
        )}
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    new URLSearchParams(location.search).has("retained") ? (
      <RetainedReportHost />
    ) : (
      <ReportReview
        caseId={location.pathname.split("/")[2] ?? ""}
        embedded={new URLSearchParams(location.search).get("embedded") === "true"}
        rework={new URLSearchParams(location.search).get("rework") === "true"}
        onDirtyChange={(dirty) => {
          document.documentElement.dataset.reportDirty = String(dirty);
        }}
        onBusyChange={(busy) => {
          document.documentElement.dataset.reportBusy = String(busy);
        }}
        onViewed={(identity) => {
          document.documentElement.dataset.reportViewed = JSON.stringify(identity);
        }}
      />
    ),
  );
