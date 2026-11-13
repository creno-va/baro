import { ArrowRight, FileText, Scale } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import type { FileView } from "../../client/api/types";
import { ActionButton as ControlButton } from "../ui/button";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "../ui/tabs";

function PrecedentUnavailable({ caseId }: { caseId: string }) {
  return (
    <section role="alert">
      <p>판례 도구를 불러오지 못했어요. 작성 중인 대화는 그대로 유지돼요.</p>
      <a
        href={`/cases/${encodeURIComponent(caseId)}/precedents`}
        target="_blank"
        rel="noopener noreferrer"
      >
        별도 화면에서 판례 보기
      </a>
    </section>
  );
}
const PrecedentResearch = lazy(() =>
  import("./PrecedentResearch")
    .then((module) => ({ default: module.PrecedentResearch }))
    .catch(() => ({ default: PrecedentUnavailable })),
);

const tabs = ["지금 확인", "자료", "판례"] as const;

/** Priorities come from persisted processing/report state; changing data never steals a chosen tab. */
export function CaseContextPanel({
  caseId,
  files,
  reportStatus,
  materials,
  viewer,
  viewingFileId,
  materialsRequest = 0,
  onAdd,
  canAdd,
  onReview,
  preparation,
  needsEvidence = false,
  feedback,
}: {
  caseId: string;
  files: FileView[];
  reportStatus?: string | undefined;
  materials: ReactNode;
  viewer: ReactNode;
  viewingFileId?: string | undefined;
  materialsRequest?: number;
  onAdd: () => void;
  canAdd: boolean;
  onReview: (file: FileView, origin: HTMLButtonElement) => void;
  preparation?: ReactNode;
  needsEvidence?: boolean;
  feedback?: ReactNode;
}) {
  const failed = files.filter((file) => file.status === "failed" || file.uploadRejection);
  const processing = files.filter((file) =>
    ["uploading", "processing", "waiting"].includes(file.status),
  );
  const attention =
    needsEvidence ||
    failed.length > 0 ||
    processing.length > 0 ||
    reportStatus === "stale" ||
    reportStatus === "failed";
  const [chosen, setChosen] = useState<number | null>(null);
  const [researchOpened, setResearchOpened] = useState(false);
  const active = chosen ?? (attention || !files.length ? 0 : 1);
  useEffect(() => {
    if (viewingFileId) setChosen(1);
  }, [viewingFileId]);
  useEffect(() => {
    if (materialsRequest > 0) setChosen(1);
  }, [materialsRequest]);
  const select = (index: number) => {
    setChosen(index);
    if (index === 2) setResearchOpened(true);
  };
  return (
    <TabGroup className="case-context" selectedIndex={active} onChange={select}>
      <TabList className="case-context__tabs" aria-label="사건 참고 자료">
        {tabs.map((label, index) => (
          <Tab key={label}>
            {label}
            {index === 1 && files.length > 0 && <span>{files.length}</span>}
            {index === 0 && attention && <i aria-hidden="true" />}
          </Tab>
        ))}
      </TabList>
      {feedback && <div className="case-context__feedback">{feedback}</div>}
      <TabPanels>
        <TabPanel as="section" unmount={false} className="case-context__pane">
          <div className="context-intro">
            <span className="context-eyebrow">사건 준비</span>
            <h3>
              {attention
                ? "이 부분부터 확인해 보세요"
                : files.length
                  ? "차근차근 준비하고 있어요"
                  : "자료와 함께 더 정확하게"}
            </h3>
            <p>대화를 이어가면서 자료와 리포트를 함께 확인하세요.</p>
          </div>
          {failed.map((file) => (
            <ControlButton
              type="button"
              className="context-task"
              key={file.id}
              onClick={(event) => onReview(file, event.currentTarget)}
            >
              <FileText size={18} />
              <span>
                <strong>{file.name}</strong>
                <small>
                  {file.uploadRejection
                    ? "등록 거절 내용을 확인해 주세요"
                    : "처리 실패 내용을 확인해 주세요"}
                </small>
              </span>
              <ArrowRight size={16} />
            </ControlButton>
          ))}
          {processing.length > 0 && (
            <div className="context-state" role="status">
              <span className="context-status-dot" />
              <div>
                <strong>자료 {processing.length}개를 처리하고 있어요</strong>
                <p>완료된 자료는 자료 탭에서 확인할 수 있어요.</p>
              </div>
            </div>
          )}
          {preparation}
          <a
            className="context-task"
            href={`/cases/${encodeURIComponent(caseId)}/reports?mode=conversation`}
          >
            <FileText size={18} />
            <span>
              <strong>
                {reportStatus === "stale"
                  ? "리포트를 갱신해 주세요"
                  : reportStatus === "failed"
                    ? "리포트 상태를 확인해 주세요"
                    : reportStatus === "not_started"
                      ? "리포트 준비하기"
                      : reportStatus === "pending"
                        ? "리포트 준비 상태 보기"
                        : reportStatus === "ready"
                          ? "지금까지 정리한 내용 보기"
                          : "리포트 확인하기"}
              </strong>
              <small>준비 중에도 리포트를 확인할 수 있어요</small>
            </span>
            <ArrowRight size={16} />
          </a>
          {!files.length && (
            <ControlButton
              type="button"
              className="context-task"
              onClick={onAdd}
              disabled={!canAdd}
            >
              <FileText size={18} />
              <span>
                <strong>첫 자료 추가하기</strong>
                <small>받은 문서나 관련 자료를 첨부하세요</small>
              </span>
              <ArrowRight size={16} />
            </ControlButton>
          )}
          <ControlButton type="button" className="context-task" onClick={() => select(2)}>
            <Scale size={18} />
            <span>
              <strong>관련 판례 살펴보기</strong>
              <small>사건 요약을 바탕으로 직접 찾아보세요</small>
            </span>
            <ArrowRight size={16} />
          </ControlButton>
        </TabPanel>
        <TabPanel as="section" unmount={false} className="case-context__pane">
          {viewer}
          <div hidden={!!viewingFileId}>{materials}</div>
        </TabPanel>
        <TabPanel as="section" unmount={false} className="case-context__pane">
          {researchOpened && (
            <Suspense fallback={<p role="status">판례 도구를 불러오고 있어요.</p>}>
              <PrecedentResearch key={caseId} caseId={caseId} embedded />
            </Suspense>
          )}
        </TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
