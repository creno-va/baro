import { useState } from "react";
import { Badge } from "../../src/components/ui/badge";
import { Button } from "../../src/components/ui/button";
import { Dialog } from "../../src/components/ui/dialog";
import { Input, Label, Select, Textarea } from "../../src/components/ui/form";
import { InlineNotice } from "../../src/components/ui/inline-notice";
import {
  ReadingContent,
  SourceReference,
  TableScroll,
} from "../../src/components/ui/reading-content";
import { ActionGroup, Section } from "../../src/components/ui/section";
import { StatePanel } from "../../src/components/ui/state-panel";
import { CaseWorkspaceFrame } from "../../src/components/ui/workspace-frame";
import { CaseNavigation, type CaseTask } from "../../src/components/workspace/CaseNavigation";

const title =
  "물품 대금을 받지 못한 경위와 상대방이 보낸 장문의 설명을 함께 검토하는 합성 사건 — 계약 내용·자료의 날짜·확인하지 못한 사실을 구분해 준비하기";
const paragraph =
  "약속한 날짜와 실제로 확인한 내용을 나누어 정리했어요. 아래 내용은 디자인 검증을 위한 합성 문장입니다. 자료에 적힌 주장과 사용자가 직접 경험한 사실은 서로 다를 수 있어요. 확인하지 못한 날짜나 금액은 추측으로 채우지 않고 원문과 함께 살펴보세요. 긴 한국어 본문에서도 한 줄을 놓치지 않고 다음 문장과 출처를 이어 읽을 수 있어야 합니다.";

/** Representative tasks, all synthetic. No API, storage or generation behavior. */
export function FoundationFixture() {
  const [task, setTask] = useState<CaseTask>("reports");
  const [panel, setPanel] = useState(false);
  const [notice, setNotice] = useState(false);
  return (
    <CaseWorkspaceFrame
      kind={task === "files" ? "compare" : "document"}
      header={
        <CaseNavigation
          caseId="synthetic-foundation"
          title={title}
          active={task}
          activeTask={task}
          fileCount={3}
          onNavigate={setTask}
        />
      }
      panelOpen={panel}
      onPanelOpenChange={setPanel}
      panelLabel="근거 확인"
      panel={
        <div className="ui-stack">
          <Section title="선택한 자료" description="합성 자료 · 원문에서 확인할 위치">
            <p>{paragraph}</p>
            <Label htmlFor="basis-note">근거 메모</Label>
            <Input id="basis-note" />
          </Section>
        </div>
      }
    >
      <div className="ui-stack">
        <p className="ui-meta">
          테스트 전용 · 합성 예시 · 실제 법률 판단이나 저장 동작이 아닙니다.
        </p>
        <section hidden={task !== "chat"} aria-label="대화 작업">
          <ReadingContent>
            <Section title="지금까지 확인한 내용을 이어서 정리해요">
              <p>{paragraph}</p>
              <Label htmlFor="unsent">이어서 설명할 내용</Label>
              <Textarea id="unsent" defaultValue="아직 보내지 않은 합성 설명" />
              <Label htmlFor="attachment">보내기 전 첨부 선택</Label>
              <Input id="attachment" type="file" />
              <ActionGroup>
                <Button>보내기 예시</Button>
              </ActionGroup>
            </Section>
          </ReadingContent>
        </section>
        <section hidden={task !== "files"} aria-label="자료 작업">
          <Section
            title="자료를 비교하고 확인해요"
            description="파일명, 처리 범위와 아직 확인할 내용을 함께 살펴보세요."
          >
            <InlineNotice
              tone="warning"
              title="자료 3개 중 1개는 확인이 필요해요"
              action={<Button variant="outline">실패한 자료 다시 시도 예시</Button>}
            >
              완료된 자료 2개는 계속 확인할 수 있어요.
            </InlineNotice>
            <TableScroll label="합성 자료 비교">
              <table>
                <thead>
                  <tr>
                    <th>자료</th>
                    <th>현재 상태</th>
                    <th>확인한 내용</th>
                    <th>다음 확인</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>계약 내용과 약정 일자를 확인하는 매우 긴 합성 첨부 문서 이름.pdf</td>
                    <td>
                      <Badge tone="success">처리 완료</Badge>
                    </td>
                    <td>자료의 날짜와 약정 내용</td>
                    <td>사용자 설명과 비교</td>
                  </tr>
                  <tr>
                    <td>받은 설명.txt</td>
                    <td>
                      <Badge tone="warning">부분 처리</Badge>
                    </td>
                    <td>확인 가능한 문단</td>
                    <td>누락된 페이지를 직접 확인</td>
                  </tr>
                </tbody>
              </table>
            </TableScroll>
          </Section>
        </section>
        <section hidden={task !== "reports"} aria-label="리포트 작업">
          <ReadingContent>
            <Section
              title="사건 준비 리포트"
              description="저장본 2 · 합성 예시 · 읽기만으로 새 분석을 실행하지 않아요."
              action={
                <Button variant="outline" onClick={() => setPanel(true)}>
                  근거 열기
                </Button>
              }
            >
              <InlineNotice tone="warning" title="추가한 자료가 아직 반영되지 않았어요">
                이 리포트가 확인한 범위를 먼저 살펴보고, 실제 갱신은 자료 검토 뒤 명시적으로
                실행하세요.
              </InlineNotice>
            </Section>
            <Section title="어디까지 확인했나요">
              <p>{paragraph}</p>
              <p>{paragraph}</p>
              <SourceReference href="#synthetic-source">
                [자료 1] 합성 계약 문서 · 2쪽
              </SourceReference>
            </Section>
            <Section title="더 확인할 내용">
              <p>{paragraph}</p>
              <blockquote>
                확인하지 않은 주장은 확정된 사실과 구분해요. 인용은 자료의 위치와 함께 읽습니다.
              </blockquote>
              <p>{paragraph}</p>
            </Section>
            <Section title="이어서 준비하기">
              <ActionGroup>
                <Button>직접 해결</Button>
                <Button variant="outline" onClick={() => setNotice(true)}>
                  변호사와 해결
                </Button>
                <Button variant="ghost">리포트만 저장</Button>
              </ActionGroup>
            </Section>
            <Section title="자료 위치" id="synthetic-source">
              <p className="ui-meta">
                자료 1 · 합성 문서 · 외부 원문이나 실제 사건 자료를 사용하지 않았어요.
              </p>
            </Section>
          </ReadingContent>
        </section>
        <section hidden={task !== "drafts"} aria-label="문서 초안 작업">
          <ReadingContent>
            <Section
              title="문서 초안을 검토해요"
              description="기준 리포트 2 · 작성 내용은 이 예시 안에서만 유지돼요."
            >
              <Label htmlFor="draft-kind">문서 종류</Label>
              <Select id="draft-kind">
                <option>사실 정리 메모</option>
                <option>확인할 항목</option>
              </Select>
              <Label htmlFor="draft-body">초안 본문</Label>
              <Textarea id="draft-body" defaultValue={paragraph} />
              <ActionGroup>
                <Button>검토 후 저장 예시</Button>
                <Button variant="outline">TXT 저장 예시</Button>
              </ActionGroup>
            </Section>
          </ReadingContent>
        </section>
        <Section title="상태 프리뷰">
          <div className="ui-grid">
            <StatePanel variant="loading" title="자료 처리 상태를 확인하고 있어요" />
            <StatePanel
              variant="empty"
              title="아직 추가한 자료가 없어요"
              description="사건 설명부터 시작할 수 있어요."
            />
            <StatePanel
              variant="partial"
              title="일부 자료를 확인했어요"
              description="확인한 결과는 유지하고 실패한 자료만 다시 시도해요."
            />
            <StatePanel
              variant="error"
              title="저장을 완료하지 못했어요"
              description="입력한 내용은 유지됩니다."
              action={<Button variant="outline">다시 시도 예시</Button>}
            />
            <StatePanel variant="success" title="명시한 작업이 완료됐어요" />
            <StatePanel variant="permission" title="이 사건을 열 권한이 없어요" />
          </div>
          <ActionGroup>
            <Button loading>저장 중 예시</Button>
            <Button disabled>조건 확인 후 사용</Button>
          </ActionGroup>
        </Section>
      </div>
      <Dialog
        open={notice}
        onOpenChange={setNotice}
        title="아직 지원하지 않는 기능이에요"
        description="현재 변호사 연결 기능은 제공하지 않습니다."
        showCloseButton={false}
      >
        <ActionGroup>
          <Button onClick={() => setNotice(false)}>확인</Button>
        </ActionGroup>
      </Dialog>
    </CaseWorkspaceFrame>
  );
}
