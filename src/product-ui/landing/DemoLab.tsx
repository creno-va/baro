import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  FolderOpen,
  MessageCircle,
  Paperclip,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useClientReady } from "../utils";
import { type DemoFeature, demoScenarios } from "./demo-content";
import { LandingButton, LandingLink } from "./LandingLink";
import { sceneClasses as s } from "./scene-classes";

const features = [
  { id: "conversation", label: "대화", progress: "이야기", icon: MessageCircle },
  { id: "files", label: "자료", progress: "자료 선택", icon: FolderOpen },
  { id: "timeline", label: "타임라인", progress: "타임라인", icon: Clock3 },
  { id: "report", label: "상담 준비", progress: "상담 준비", icon: FileText },
] as const;
function Fallback() {
  return (
    <div className={s("demo-fallback")} data-demo-fallback="">
      <div className={s("demo-fallback-intro")}>
        <MessageCircle size={25} aria-hidden="true" />
        <h3>“빌려준 돈을 돌려받지 못했어요.”</h3>
        <p>이런 이야기에서 시작할 수 있어요. 아래는 가상의 이용 예시예요.</p>
      </div>
      <ol>
        {[
          ["이야기하기", "언제, 어떤 약속을 했는지 차근차근 확인해요."],
          ["자료 모으기", "이체 내역과 주고받은 대화를 함께 살펴봐요."],
          ["흐름 정리하기", "알고 있는 사실을 날짜순으로 확인해요."],
          ["상담 준비하기", "요약을 직접 검토하고, 전달할 자료를 선택해요."],
        ].map(([title, body]) => (
          <li key={title}>
            <strong>{title}</strong>
            <span>{body}</span>
          </li>
        ))}
      </ol>
      <LandingLink href="/new">
        내 이야기로 시작하기 <ArrowRight size={17} aria-hidden="true" />
      </LandingLink>
      <p className={s("demo-fallback-note")}>
        JavaScript를 켜면 이 페이지에서 예시를 직접 체험할 수 있어요.
      </p>
    </div>
  );
}
function Speaker({ children }: { children: ReactNode }) {
  return (
    <div className={s("demo-message demo-message-baro")}>
      <span className={s("demo-baro-avatar")}>
        <img src="/brand/logo.svg" width={22} height={22} alt="" />
      </span>
      <div>
        <span className={s("demo-speaker")}>BARO · 예시 응답</span>
        {children}
      </div>
    </div>
  );
}
function PanelHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s("demo-panel-heading")}>
      <h4 tabIndex={-1} data-demo-focus="">
        {title}
      </h4>
      <p>{children}</p>
    </div>
  );
}

/** Entirely local synthetic state: never sends, stores, uploads or creates a case. */
export default function DemoLab() {
  const ready = useClientReady(),
    root = useRef<HTMLElement>(null);
  const [scenarioKey, setScenarioKey] = useState("loan"),
    [tab, setTab] = useState(0),
    [answered, setAnswered] = useState(false),
    [selected, setSelected] = useState([0, 1]),
    [summary, setSummary] = useState(demoScenarios.loan?.summary ?? ""),
    [facts, setFacts] = useState(false),
    [files, setFiles] = useState(false),
    [complete, setComplete] = useState(false),
    [live, setLive] = useState(""),
    [focusRequest, setFocusRequest] = useState(0),
    [resetCount, setResetCount] = useState(0);
  const pendingFocus = useRef<{ selector: string; scroll?: ScrollLogicalPosition } | null>(null);
  const summaryBeforeEdit = useRef(summary);
  const scenario = demoScenarios[scenarioKey] ?? demoScenarios.loan;
  if (!scenario) throw new Error("Missing synthetic landing scenario");
  const focusAfterRender = (selector: string, scroll?: ScrollLogicalPosition) => {
    pendingFocus.current = scroll ? { selector, scroll } : { selector };
    setFocusRequest((value) => value + 1);
  };
  useLayoutEffect(() => {
    if (focusRequest === 0) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (!target) return;
    const node = root.current?.querySelector<HTMLElement>(target.selector);
    node?.focus({ preventScroll: true });
    if (target.scroll)
      node?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: target.scroll,
      });
  }, [focusRequest]);
  const invalidate = () => {
    setComplete(false);
    setFacts(false);
    setFiles(false);
  };
  const openFeature = (
    next: DemoFeature,
    focus = false,
    block: ScrollLogicalPosition = "nearest",
  ) => {
    const index = features.findIndex((feature) => feature.id === next);
    if (index < 0) return;
    setTab(index);
    setLive(`${features[index]?.progress} 단계예요.`);
    if (focus) focusAfterRender(`[data-demo-panel="${next}"] [data-demo-focus]`, block);
  };
  const reset = (key: string, focus = false) => {
    const next = demoScenarios[key];
    if (!next) return;
    setScenarioKey(key);
    setAnswered(false);
    setSelected([0, 1]);
    setSummary(next.summary);
    invalidate();
    setTab(0);
    setResetCount((value) => value + 1);
    if (focus) focusAfterRender('[data-demo-panel="conversation"] [data-demo-focus]', "nearest");
  };
  useEffect(() => {
    const onFeature = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (
        !detail ||
        typeof detail !== "object" ||
        !("feature" in detail) ||
        typeof detail.feature !== "string" ||
        !features.some((feature) => feature.id === detail.feature)
      )
        return;
      event.preventDefault();
      const next = detail.feature as DemoFeature;
      if (next !== "conversation") setAnswered(true);
      if (location.hash !== "#try-baro") history.pushState(null, "", "#try-baro");
      openFeature(next, true, "start");
    };
    window.addEventListener("baro:demo-feature", onFeature);
    return () => window.removeEventListener("baro:demo-feature", onFeature);
  });
  return (
    <section
      ref={root}
      id="try-baro"
      className={s(`demo-lab ${ready ? "demo-lab-ready" : ""}`)}
      data-baro-demo=""
      aria-labelledby="demo-title"
    >
      <header className={s("demo-heading")}>
        <span className={s("demo-example-badge")}>
          <Sparkles size={15} aria-hidden="true" /> 예시로 체험하기
        </span>
        <h2 id="demo-title">
          설명보다 먼저,
          <br />
          <span>한번 해보세요.</span>
        </h2>
        <p>
          짧은 이야기 하나가 상담 준비로 바뀌는 과정.
          <br />
          가상의 상황으로 BARO를 가볍게 경험해 보세요.
        </p>
      </header>
      {!ready ? (
        <Fallback />
      ) : (
        <div className={s("demo-interactive")} data-demo-interactive="">
          <fieldset className={s("demo-scenarios")}>
            <legend>어떤 이야기로 시작할까요?</legend>
            <div>
              {[
                { id: "loan", label: "빌려준 돈" },
                { id: "deposit", label: "돌려받을 보증금" },
                { id: "wage", label: "받지 못한 급여" },
              ].map((choice) => (
                <label key={choice.id}>
                  <input
                    type="radio"
                    name="baro-demo-scenario"
                    value={choice.id}
                    checked={scenarioKey === choice.id}
                    onChange={() => {
                      reset(choice.id);
                      setLive(`${demoScenarios[choice.id]?.title} 예시를 시작해요.`);
                    }}
                  />
                  <span>{choice.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <TabGroup
            selectedIndex={tab}
            onChange={(index) => {
              const next = features[index];
              if (next) openFeature(next.id);
            }}
            as={Fragment}
          >
            <div className={s("demo-workspace")}>
              <header className={s("demo-app-header")}>
                <div className={s("demo-app-brand")}>
                  <img src="/brand/logo.svg" width={27} height={27} alt="" />
                  <strong>BARO</strong>
                  <span>나의 이야기</span>
                </div>
                <LandingButton
                  variant="restart"
                  data-demo-restart=""
                  onClick={() => {
                    reset(scenarioKey, true);
                    setLive("선택한 이야기의 체험을 처음부터 다시 시작해요.");
                  }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  <span>다시 체험</span>
                </LandingButton>
              </header>
              <div className={s("demo-case-heading")}>
                <div>
                  <span className={s("demo-case-eyebrow")}>가상의 사건 · 자유롭게 바꿔보세요</span>
                  <h3 data-demo-case-title="">{scenario.title}</h3>
                </div>
                <span className={s("demo-case-state")} data-demo-case-state="">
                  {complete ? "예시 체험 완료" : "이야기 정리 중"}
                </span>
              </div>
              <div className={s("demo-progress")}>
                <progress
                  max={4}
                  value={tab + 1}
                  aria-label="예시 체험 진행"
                  data-demo-progress=""
                />
                <span data-demo-progress-text="">
                  {tab + 1} / 4 · {features[tab]?.progress}
                </span>
              </div>
              <TabList className={s("demo-tabs")} aria-label="예시 체험 단계">
                {features.map((feature) => (
                  <Tab
                    key={feature.id}
                    type="button"
                    id={`demo-tab-${feature.id}`}
                    data-demo-tab={feature.id}
                  >
                    <feature.icon size={17} aria-hidden="true" />
                    <span>{feature.label}</span>
                  </Tab>
                ))}
              </TabList>
              <TabPanels as={Fragment}>
                <TabPanel
                  static
                  hidden={tab !== 0}
                  className={s("demo-panel")}
                  id="demo-panel-conversation"
                  data-demo-panel="conversation"
                >
                  <PanelHeading title="나의 말로 시작해요.">
                    미리 준비한 예시 답변으로 대화를 이어가 보세요.
                  </PanelHeading>
                  <div className={s("demo-conversation")}>
                    <div className={s("demo-message demo-message-user")}>
                      <span className={s("demo-speaker")}>나의 이야기 · 예시</span>
                      <p data-demo-narrative="">{scenario.narrative}</p>
                    </div>
                    <Speaker>
                      <p data-demo-question="">{scenario.question}</p>
                    </Speaker>
                    {answered && (
                      <div className={s("demo-answer-group")} data-demo-answer-group="">
                        <div className={s("demo-message demo-message-user")}>
                          <span className={s("demo-speaker")}>예시 답변</span>
                          <p data-demo-answer="">{scenario.answer}</p>
                        </div>
                        <Speaker>
                          <p>알려주신 날짜와 약속을 정리했어요. 함께 살펴볼 자료도 골라볼까요?</p>
                          <div className={s("demo-found-fact")}>
                            <Check size={15} aria-hidden="true" />
                            <span data-demo-fact="">{scenario.fact}</span>
                          </div>
                        </Speaker>
                      </div>
                    )}
                  </div>
                  <div className={s("demo-panel-actions")}>
                    <span className={s("demo-action-hint")} data-demo-conversation-hint="">
                      {answered
                        ? "대화에서 확인한 사실을 자료와 연결해 볼게요."
                        : "실제 입력 없이, 예시 답변으로 체험해요."}
                    </span>
                    {answered ? (
                      <LandingButton
                        data-demo-next="files"
                        data-demo-conversation-next=""
                        onClick={() => openFeature("files", true)}
                      >
                        함께 볼 자료 선택하기 <ArrowRight size={17} aria-hidden="true" />
                      </LandingButton>
                    ) : (
                      <LandingButton
                        data-demo-answer-button=""
                        onClick={() => {
                          setAnswered(true);
                          focusAfterRender("[data-demo-conversation-next]");
                          setLive(
                            "예시 답변이 추가됐어요. 확인한 날짜와 약속을 살펴보고 자료를 선택해 보세요.",
                          );
                        }}
                      >
                        예시로 답해보기 <ArrowRight size={17} aria-hidden="true" />
                      </LandingButton>
                    )}
                  </div>
                </TabPanel>
                <TabPanel
                  static
                  hidden={tab !== 1}
                  className={s("demo-panel")}
                  id="demo-panel-files"
                  data-demo-panel="files"
                >
                  <PanelHeading title="어떤 자료를 함께 볼까요?">
                    예시 자료를 선택하거나 빼보세요. 파일을 올리지는 않아요.
                  </PanelHeading>
                  <fieldset className={s("demo-files")}>
                    <legend className={s("demo-sr-only")}>정리에 포함할 예시 자료</legend>
                    {scenario.files.map((file, index) => (
                      <label key={file.title} className={s("demo-file-card")}>
                        <input
                          type="checkbox"
                          data-demo-file={index}
                          checked={selected.includes(index)}
                          onChange={(event) => {
                            const next = event.currentTarget.checked
                              ? [...selected, index]
                              : selected.filter((value) => value !== index);
                            setSelected(next);
                            invalidate();
                            setLive(
                              next.length
                                ? `예시 자료 ${next.length}개를 선택했어요.`
                                : "자료 없이 대화 내용으로 이어갈 수 있어요.",
                            );
                          }}
                        />
                        <span className={s("demo-file-icon")}>
                          <FileText size={24} aria-hidden="true" />
                        </span>
                        <span className={s("demo-file-copy")}>
                          <strong data-demo-file-title={index}>{file.title}</strong>
                          <span data-demo-file-description={index}>{file.description}</span>
                          <small>실제 파일이 아닌 예시 자료</small>
                        </span>
                        <span className={s("demo-file-check")} aria-hidden="true">
                          <Check size={17} />
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <div className={s("demo-selection-note")}>
                    <Paperclip size={16} aria-hidden="true" />
                    <span data-demo-file-count="">
                      {selected.length
                        ? `예시 자료 ${selected.length}개를 함께 살펴봐요.`
                        : "자료 없이 대화 내용만으로도 이어갈 수 있어요."}
                    </span>
                  </div>
                  <div className={s("demo-panel-actions")}>
                    <LandingButton
                      variant="secondary"
                      data-demo-next="conversation"
                      onClick={() => openFeature("conversation", true)}
                    >
                      대화 다시 보기
                    </LandingButton>
                    <LandingButton
                      data-demo-next="timeline"
                      onClick={() => openFeature("timeline", true)}
                    >
                      시간순으로 정리해 보기 <ArrowRight size={17} aria-hidden="true" />
                    </LandingButton>
                  </div>
                </TabPanel>
                <TabPanel
                  static
                  hidden={tab !== 2}
                  className={s("demo-panel")}
                  id="demo-panel-timeline"
                  data-demo-panel="timeline"
                >
                  <PanelHeading title="흩어진 이야기에 흐름이 생겼어요.">
                    날짜와 사실을 살펴보고, 연결된 예시 자료도 확인해 보세요.
                  </PanelHeading>
                  <ol className={s("demo-timeline")}>
                    {scenario.timeline.map((event, index) => {
                      const [year, month, day] = event.date.split("-");
                      return (
                        <li key={event.date}>
                          <span className={s("demo-timeline-dot")} aria-hidden="true" />
                          <time dateTime={event.date} data-demo-date={index}>
                            {year}년 {Number(month)}월 {Number(day)}일
                          </time>
                          <h5 data-demo-event-title={index}>{event.title}</h5>
                          <p data-demo-event-body={index}>{event.body}</p>
                          <details key={`${resetCount}:${event.date}`}>
                            <summary>
                              <Paperclip size={13} aria-hidden="true" /> 연결된 예시 자료 보기
                            </summary>
                            <p data-demo-event-source={index}>
                              {selected.includes(event.file)
                                ? `${scenario.files[event.file]?.title} · 선택한 가상 자료에 연결된 예시예요.`
                                : "이 날짜에 연결할 자료를 선택하지 않았어요. 예시 대화에서 확인한 내용이에요."}
                            </p>
                          </details>
                        </li>
                      );
                    })}
                  </ol>
                  <div className={s("demo-timeline-notice")}>
                    <Clock3 size={17} aria-hidden="true" />
                    <span>
                      기록된 날짜를 정리한 예시예요. 법적인 기한이나 판단을 계산하지 않아요.
                    </span>
                  </div>
                  <div className={s("demo-panel-actions")}>
                    <LandingButton
                      variant="secondary"
                      data-demo-next="files"
                      onClick={() => openFeature("files", true)}
                    >
                      자료 다시 선택하기
                    </LandingButton>
                    <LandingButton
                      data-demo-next="report"
                      onClick={() => openFeature("report", true)}
                    >
                      상담 준비 리포트 살펴보기 <ArrowRight size={17} aria-hidden="true" />
                    </LandingButton>
                  </div>
                </TabPanel>
                <TabPanel
                  static
                  hidden={tab !== 3}
                  className={s("demo-panel")}
                  id="demo-panel-report"
                  data-demo-panel="report"
                >
                  <PanelHeading title="마지막 확인은, 내가 직접.">
                    예시 요약을 고쳐보고, 함께 볼 자료를 검토해 보세요.
                  </PanelHeading>
                  <div className={s("demo-report-paper")}>
                    <div className={s("demo-report-top")}>
                      <span>
                        <FileText size={18} aria-hidden="true" /> 상담 준비 리포트
                      </span>
                      <span>예시</span>
                    </div>
                    <label className={s("demo-report-label")} htmlFor="demo-report-summary">
                      사건 요약 직접 수정하기
                    </label>
                    <textarea
                      id="demo-report-summary"
                      data-demo-report-summary=""
                      rows={4}
                      maxLength={600}
                      aria-describedby="demo-summary-note"
                      value={summary}
                      onFocus={(event) => {
                        summaryBeforeEdit.current = event.currentTarget.value;
                      }}
                      onChange={(event) => {
                        setSummary(event.currentTarget.value);
                        invalidate();
                      }}
                      onBlur={(event) => {
                        if (summaryBeforeEdit.current !== event.currentTarget.value)
                          setLive("요약을 수정했어요. 사실과 자료를 다시 확인해 주세요.");
                      }}
                    />
                    <p id="demo-summary-note" className={s("demo-input-note")}>
                      가상 내용만 수정해 주세요. 실제 개인정보는 입력하지 마세요. 이 내용은
                      전송되거나 저장되지 않아요.
                    </p>
                    <div className={s("demo-report-materials")}>
                      <h5>내가 선택한 예시 자료</h5>
                      <div data-demo-report-files="">
                        {selected.length ? (
                          selected.map((index) => (
                            <span key={index} className={s("demo-report-file")}>
                              {scenario.files[index]?.title}
                            </span>
                          ))
                        ) : (
                          <p>선택한 자료가 없어요. 예시 대화 내용을 기준으로 살펴봐요.</p>
                        )}
                      </div>
                    </div>
                    <div className={s("demo-report-question")}>
                      <span>상담에서 확인할 질문</span>
                      <p data-demo-report-question="">{scenario.consultation}</p>
                    </div>
                  </div>
                  <fieldset className={s("demo-review")}>
                    <legend>내가 검토한 내용인지 확인해 주세요.</legend>
                    <label>
                      <input
                        type="checkbox"
                        data-demo-confirm="facts"
                        checked={facts}
                        onChange={(event) => {
                          setFacts(event.currentTarget.checked);
                          if (!event.currentTarget.checked) setComplete(false);
                        }}
                      />
                      <span>예시 요약의 사실과 날짜를 확인했어요.</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        data-demo-confirm="files"
                        checked={files}
                        onChange={(event) => {
                          setFiles(event.currentTarget.checked);
                          if (!event.currentTarget.checked) setComplete(false);
                        }}
                      />
                      <span>함께 볼 예시 자료의 선택을 확인했어요.</span>
                    </label>
                  </fieldset>
                  {complete ? (
                    <div className={s("demo-complete")} data-demo-complete="" role="status">
                      <span className={s("demo-complete-icon")}>
                        <CheckCheck size={24} aria-hidden="true" />
                      </span>
                      <div>
                        <h5>나의 검토까지, 체험 완료.</h5>
                        <p>
                          이제 실제 내 이야기로 시작해 보세요.
                          <br />
                          실제 자료의 전달도 내가 직접 선택해요.
                        </p>
                      </div>
                      <LandingLink href="/new">
                        내 이야기로 시작하기 <ArrowRight size={17} aria-hidden="true" />
                      </LandingLink>
                    </div>
                  ) : (
                    <div className={s("demo-panel-actions")} data-demo-report-actions="">
                      <LandingButton
                        variant="secondary"
                        data-demo-next="timeline"
                        onClick={() => openFeature("timeline", true)}
                      >
                        흐름 다시 보기
                      </LandingButton>
                      <LandingButton
                        data-demo-finish=""
                        disabled={!summary.trim() || !facts || !files}
                        onClick={() => {
                          if (!summary.trim() || !facts || !files) return;
                          setComplete(true);
                          focusAfterRender("[data-demo-complete] a", "nearest");
                          setLive("예시 체험을 마쳤어요. 실제 내 이야기로 시작할 수 있어요.");
                        }}
                      >
                        검토 마치기 <Check size={17} aria-hidden="true" />
                      </LandingButton>
                    </div>
                  )}
                </TabPanel>
              </TabPanels>
              <footer className={s("demo-app-footer")}>
                <ShieldCheck size={15} aria-hidden="true" />
                <span>가상의 체험이에요. 입력·파일 저장이나 외부 전달은 이루어지지 않아요.</span>
              </footer>
            </div>
          </TabGroup>
          <p
            className={s("demo-live demo-sr-only")}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-demo-live=""
          >
            {live}
          </p>
        </div>
      )}
    </section>
  );
}
