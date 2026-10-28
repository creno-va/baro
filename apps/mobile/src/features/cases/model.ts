import {
  type AnswersInput,
  ApiError,
  type createCasesClient,
  createInputSchema,
  errorMessage,
  type QuestionsResult,
} from "@baro/api-client";
import type { CaseView } from "@baro/client-core";
import { CASE_NARRATIVE_MIN_LENGTH } from "@baro/contracts/v1";
import type { SessionModel, SessionState } from "../session/model";

type Client = ReturnType<typeof createCasesClient> & {
  deleteCase?: (id: string, confirmation: string, schemaVersion: "1" | "2") => Promise<void>;
};
type Answer = AnswersInput["answers"][number];
export interface CasesState {
  gate: "checking" | "login" | "consent" | "role" | "ready" | "error";
  view: "list" | "create" | "detail";
  items: CaseView[];
  item: CaseView | null;
  questions: QuestionsResult | null;
  narrative: string;
  subjectContext: "individual" | "company";
  answers: Record<string, Answer>;
  round: number;
  summary: string;
  facts: Record<string, string>;
  unknowns: string;
  busy: boolean;
  error: string | null;
  conflict: boolean;
  deleteConfirmation: string;
  deleteUncertain: boolean;
  notice: string | null;
}
const empty = (): CasesState => ({
  gate: "checking",
  view: "list",
  items: [],
  item: null,
  questions: null,
  narrative: "",
  subjectContext: "individual",
  answers: {},
  round: 1,
  summary: "",
  facts: {},
  unknowns: "",
  busy: false,
  error: null,
  conflict: false,
  deleteConfirmation: "",
  deleteUncertain: false,
  notice: null,
});
function gate(session: SessionState): CasesState["gate"] {
  if (session.phase === "error") return "error";
  if (session.phase !== "ready")
    return session.phase === "consent"
      ? "consent"
      : session.phase === "anonymous"
        ? "login"
        : "checking";
  if (!session.session?.user) return "login";
  if (session.session.needsConsent) return "consent";
  return session.session.user.accountType === "customer" ? "ready" : "role";
}
export function createCasesModel(dependencies: {
  session: Pick<SessionModel, "getSnapshot" | "subscribe" | "refresh">;
  createClient: (signal: AbortSignal, ownerId: string, onDeleted: (id: string) => void) => Client;
  schedule?: (callback: () => void, ms: number) => () => void;
}) {
  let state = empty(),
    owner: string | undefined,
    version = 0,
    controller: AbortController | undefined;
  let client: Client | undefined, cancelPoll: (() => void) | undefined;
  let parked: { owner: string; state: CasesState } | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: CasesState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const schedule =
    dependencies.schedule ??
    ((callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    });
  function retire() {
    version++;
    cancelPoll?.();
    cancelPoll = undefined;
    controller?.abort();
    client = undefined;
  }
  function renew() {
    retire();
    controller = new AbortController();
    const captured = version;
    if (owner)
      client = dependencies.createClient(controller.signal, owner, (id) => {
        if (current(captured) && state.item?.id === id) acknowledgeDeletion();
      });
  }
  const current = (value: number) =>
    value === version && state.gate === "ready" && !controller?.signal.aborted;
  const summaryDirty = () =>
    Object.keys(state.facts).length > 0 ||
    Boolean(
      state.item &&
        (state.summary !== state.item.summary ||
          state.unknowns !== (state.item.summaryDetails?.unknowns ?? []).join("\n")),
    );
  const dirty = () => Object.keys(state.answers).length > 0 || summaryDirty();
  function clearSelected(notice: string) {
    parked = undefined;
    retire();
    publish({
      ...empty(),
      gate: "ready",
      notice,
    });
  }
  function acknowledgeDeletion() {
    clearSelected(
      "삭제 요청이 접수됐어요. 사건 목록에서 확인해 주세요. 관련 자료 정리는 서버에서 이어질 수 있어요.",
    );
  }
  function fail(captured: number, error: unknown) {
    if (!current(captured)) return;
    cancelPoll?.();
    if (error instanceof ApiError && ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(error.code)) {
      if (owner) parked = { owner, state: { ...state, busy: false } };
      retire();
      publish(empty());
      void dependencies.session.refresh();
      return;
    }
    if (error instanceof ApiError && error.code === "NOT_FOUND" && state.view === "detail") {
      clearSelected("사건을 찾을 수 없어요. 목록에서 다시 확인해 주세요.");
      // The same owner may have changed role; the server deliberately maps that denial to NOT_FOUND.
      void dependencies.session.refresh();
      void refresh();
      return;
    }
    publish({
      ...state,
      busy: false,
      error: errorMessage(error),
      conflict: state.conflict || (error instanceof ApiError && error.code === "CONFLICT"),
    });
  }
  function poll() {
    cancelPoll?.();
    if (state.questions?.processing && state.gate === "ready")
      cancelPoll = schedule(() => {
        void refresh();
      }, 3000);
  }
  function apply(item: CaseView, questions: QuestionsResult | null, preserve = false) {
    const changed = preserve && dirty() && state.item?.revision !== item.revision;
    const keepSummary = preserve && summaryDirty();
    publish({
      ...state,
      item,
      questions,
      busy: false,
      answers: preserve ? state.answers : {},
      summary: keepSummary ? state.summary : item.summary,
      facts: keepSummary ? state.facts : {},
      unknowns: keepSummary ? state.unknowns : (item.summaryDetails?.unknowns ?? []).join("\n"),
      round: preserve ? state.round : (questions?.rounds?.at(-1)?.ordinal ?? 1),
      error: changed
        ? "다른 화면의 변경이 있어요. 입력을 확인한 뒤 최신 내용으로 다시 시작해 주세요."
        : null,
      conflict: changed || (preserve && state.conflict),
    });
    poll();
  }
  async function refresh(discard = false) {
    if (state.gate !== "ready" || state.busy) return;
    if (!client) renew();
    const captured = version,
      api = client;
    if (!api) return;
    publish({ ...state, busy: true, error: null });
    try {
      if (state.view !== "detail" || !state.item) {
        const items = await api.list();
        if (current(captured)) publish({ ...state, items, busy: false, error: null });
      } else {
        const id = state.item.id;
        let item = await api.get(id);
        const questions =
          item.schemaVersion === "1" || item.stage === "active" || item.stage === "archived"
            ? null
            : await api.getQuestions(id);
        if (questions?.complete && item.stage === "intake") item = await api.get(id);
        if (questions?.complete && item.stage === "intake")
          throw new ApiError("UNAVAILABLE", "최신 요약을 다시 확인해 주세요.", true);
        if (current(captured)) apply(item, questions, !discard);
      }
    } catch (error) {
      fail(captured, error);
    }
  }
  function sync() {
    const session = dependencies.session.getSnapshot(),
      next = gate(session);
    if (next !== "ready") {
      if (state.gate === "ready" && owner) parked = { owner, state: { ...state, busy: false } };
      retire();
      if (["login", "role"].includes(next)) {
        parked = undefined;
        owner = undefined;
      }
      publish({ ...empty(), gate: next, error: next === "error" ? session.error : null });
      return;
    }
    const id = session.session?.user?.id;
    if (!id) return;
    if (state.gate === "ready" && owner === id) return;
    const restore = parked?.owner === id ? parked.state : empty();
    owner = id;
    parked = undefined;
    renew();
    publish({ ...restore, gate: "ready", busy: false, error: null });
    void refresh();
  }
  async function mutate(action: (api: Client) => Promise<CaseView | QuestionsResult>) {
    if (state.gate !== "ready" || state.busy || state.conflict || state.deleteUncertain) return;
    if (!client) renew();
    const api = client,
      captured = version;
    if (!api) return;
    cancelPoll?.();
    publish({ ...state, busy: true, error: null });
    try {
      const value = await action(api);
      if (!current(captured)) return;
      if ("questions" in value) {
        publish({ ...state, questions: value });
        if (state.item) {
          const item = await api.get(state.item.id);
          if (current(captured)) apply(item, value, true);
        } else publish({ ...state, busy: false });
      } else {
        publish({
          ...state,
          view: "detail",
          item: value,
          questions: null,
          narrative: state.view === "create" ? "" : state.narrative,
          answers: {},
          facts: {},
          summary: value.summary,
          unknowns: (value.summaryDetails?.unknowns ?? []).join("\n"),
          conflict: false,
        });
        const questions =
          value.schemaVersion === "1" || ["active", "archived"].includes(value.stage)
            ? null
            : await api.getQuestions(value.id);
        if (current(captured)) {
          publish({ ...state, view: "detail" });
          apply(value, questions);
        }
      }
    } catch (error) {
      fail(captured, error);
    }
  }
  const model = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      const unsubscribe = dependencies.session.subscribe(sync);
      sync();
      return () => {
        unsubscribe();
        parked = undefined;
        owner = undefined;
        retire();
        publish(empty());
      };
    },
    refresh,
    list() {
      renew();
      publish({
        ...state,
        view: "list",
        busy: false,
        item: null,
        questions: null,
        answers: {},
        facts: {},
        conflict: false,
        deleteConfirmation: "",
        deleteUncertain: false,
      });
      void refresh();
    },
    newCase() {
      if (state.gate !== "ready" || state.busy) return;
      publish({ ...state, view: "create", error: null, notice: null });
    },
    setNarrative(narrative: string) {
      if (!state.busy && state.gate === "ready") publish({ ...state, narrative });
    },
    setSubject(subjectContext: "individual" | "company") {
      if (!state.busy && state.gate === "ready") publish({ ...state, subjectContext });
    },
    create() {
      const parsed = createInputSchema.safeParse({
        narrative: state.narrative,
        subjectContext: state.subjectContext,
      });
      if (!parsed.success) {
        publish({
          ...state,
          error: `상황을 ${CASE_NARRATIVE_MIN_LENGTH}~5,000자로 입력해 주세요.`,
        });
        return Promise.resolve();
      }
      return mutate((api) => api.create(parsed.data));
    },
    async open(item: CaseView | string) {
      if (state.gate !== "ready" || state.busy) return;
      renew();
      publish({ ...state, deleteConfirmation: "", deleteUncertain: false, notice: null });
      if (typeof item === "string") {
        publish({ ...state, conflict: false });
        await mutate((api) => api.get(item));
        return;
      }
      publish({
        ...state,
        view: "detail",
        item,
        questions: null,
        answers: {},
        facts: {},
        summary: item.summary,
        unknowns: (item.summaryDetails?.unknowns ?? []).join("\n"),
        error: null,
        conflict: false,
      });
      await refresh(true);
    },
    selectRound(round: number) {
      if (!state.busy) publish({ ...state, round });
    },
    answer(answer: Answer) {
      if (!state.busy && !state.conflict && state.gate === "ready")
        publish({ ...state, answers: { ...state.answers, [answer.questionId]: answer } });
    },
    saveAnswers() {
      if (summaryDirty()) {
        publish({ ...state, error: "수정한 요약을 먼저 저장해 주세요." });
        return Promise.resolve();
      }
      const ids =
        state.questions?.rounds?.find((r) => r.ordinal === state.round)?.questionIds ??
        state.questions?.questions.slice(0, 3).map((q) => q.id) ??
        [];
      const answers = ids.flatMap((id) => (state.answers[id] ? [state.answers[id]] : []));
      const item = state.item,
        questions = state.questions,
        captured = version;
      if (!item || !questions || !answers.length) return Promise.resolve();
      return mutate(async (api) => {
        const result = await api.saveAnswers(item.id, {
          expectedRevision: questions.revision,
          answers,
        });
        // Clear only acknowledged answers, preserving edits in another round.
        const next = { ...state.answers };
        for (const answer of answers) delete next[answer.questionId];
        if (current(captured) && state.item?.id === item.id)
          publish({ ...state, answers: next, item: { ...item, revision: result.revision } });
        return result;
      });
    },
    advance() {
      const item = state.item,
        q = state.questions;
      if (!item || !q) return Promise.resolve();
      if (dirty()) {
        publish({ ...state, error: "입력한 내용을 먼저 저장해 주세요." });
        return Promise.resolve();
      }
      return mutate((api) => api.advance(item.id, { expectedRevision: q.revision }));
    },
    editSummary(summary: string) {
      if (!state.busy && state.gate === "ready") publish({ ...state, summary });
    },
    editFact(id: string, text: string) {
      if (!state.busy && state.gate === "ready")
        publish({ ...state, facts: { ...state.facts, [id]: text } });
    },
    editUnknowns(unknowns: string) {
      if (!state.busy && state.gate === "ready") publish({ ...state, unknowns });
    },
    saveSummary() {
      const item = state.item;
      if (!item) return Promise.resolve();
      return mutate((api) =>
        api.saveSummary(item.id, {
          expectedRevision: item.revision,
          summary: state.summary,
          ...(Object.keys(state.facts).length
            ? { factEdits: Object.entries(state.facts).map(([factId, text]) => ({ factId, text })) }
            : {}),
          unknowns: state.unknowns
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
        }),
      );
    },
    confirm() {
      const item = state.item;
      if (!item) return Promise.resolve();
      if (dirty()) {
        publish({ ...state, error: "수정한 요약을 먼저 저장해 주세요." });
        return Promise.resolve();
      }
      return mutate((api) => api.confirmSummary(item.id, { expectedRevision: item.revision }));
    },
    setDeleteConfirmation(deleteConfirmation: string) {
      if (state.gate === "ready" && !state.busy && !state.deleteUncertain)
        publish({ ...state, deleteConfirmation });
    },
    async deleteCase() {
      const item = state.item;
      if (state.gate !== "ready" || state.busy || !item || !item.schemaVersion) return;
      if (state.deleteConfirmation !== "DELETE") {
        publish({ ...state, error: "삭제 확인란에 DELETE를 입력해 주세요." });
        return;
      }
      if (!client) renew();
      const api = client,
        captured = version,
        capturedOwner = owner;
      if (!api?.deleteCase) {
        publish({ ...state, error: "삭제 기능을 사용할 수 없어요. 앱 설정을 확인해 주세요." });
        return;
      }
      cancelPoll?.();
      publish({ ...state, busy: true, deleteUncertain: true, error: null });
      try {
        await api.deleteCase(item.id, "DELETE", item.schemaVersion);
        if (current(captured)) acknowledgeDeletion();
        if (owner === capturedOwner && state.gate === "ready" && !state.item) await refresh();
      } catch (error) {
        fail(captured, error);
      }
    },
    cancel() {
      if (state.gate !== "ready") return;
      renew();
      publish({
        ...state,
        busy: false,
        error: "요청을 중단했어요. 저장 여부는 목록이나 최신 내용에서 확인해 주세요.",
      });
    },
  };
  return model;
}
export type CasesModel = ReturnType<typeof createCasesModel>;
