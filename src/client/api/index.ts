import { ApiError, apiMode, apiRequest, registerHttpMockHandler } from "./core";
import { mockRuntime } from "./mock/runtime";
import { sessionApi } from "./session";
import type {
  CaseView,
  FileView,
  LawyerView,
  Provider,
  QuestionView,
  ReportView,
  TimelineView,
  UsageView,
  WorkspaceView,
} from "./types";

// Optional domain modules arrive independently during the parallel sprint.
const modules = import.meta.glob<Record<string, unknown>>("./*.ts");
const mockModules = import.meta.glob<Record<string, unknown>>("./mock/*.ts");
// biome-ignore lint/suspicious/noExplicitAny: Lazy factories are validated by the owning domain modules; the public facade is typed below.
type Client = Record<string, (...args: any[]) => Promise<any>>;
const clients = new Map<string, Promise<Client>>();
let httpMocksReady: Promise<void> | undefined;
async function initializeHttpMocks() {
  for (const name of ["workspace", "files", "reports", "account"]) {
    const mockLoader = mockModules[`./mock/${name}.ts`];
    if (!mockLoader) continue;
    const mock = await mockLoader();
    const suffix = name[0]?.toUpperCase() + name.slice(1);
    const runtime = {
      ...mockRuntime,
      original: (caseId: string, fileId: string) => api.files.original(caseId, fileId),
      removeOriginals: async (ownerId: string, caseId?: string) => {
        const files = await mockModules["./mock/files.ts"]?.();
        if (files?.clearMockOriginals)
          await (files.clearMockOriginals as (owner: string, id?: string) => Promise<void>)(
            ownerId,
            caseId,
          );
      },
    };
    const create = mock[`create${suffix}Mock`] as (
      runtime: unknown,
    ) => import("./core").HttpMockHandler;
    registerHttpMockHandler(create(runtime));
  }
}
async function loadClient(name: string): Promise<Client> {
  const loader = modules[`./${name}.ts`];
  if (!loader) throw new ApiError("UNAVAILABLE", "이 화면의 API 연결을 준비하고 있어요.", true);
  const domain = await loader();
  if (apiMode === "mock" && ["workspace", "files", "reports", "account"].includes(name)) {
    httpMocksReady ??= initializeHttpMocks();
    await httpMocksReady;
  }
  const existing = domain[`${name}Api`] ?? domain[name];
  if (existing) return existing as Client;
  const suffix = name[0]?.toUpperCase() + name.slice(1);
  const factory = domain[`create${suffix}Api`] as (transport: typeof apiRequest) => Client;
  if (!factory) throw new ApiError("UNAVAILABLE", "API 연결을 확인해 주세요.", true);
  return factory(apiRequest);
}
function domain<T>(name: string): T {
  return new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        async (...args: unknown[]) => {
          let client = clients.get(name);
          if (!client) {
            client = loadClient(name);
            clients.set(name, client);
          }
          try {
            const resolved = await client;
            const fn = resolved[method];
            if (!fn) throw new ApiError("UNAVAILABLE", "이 기능을 연결하고 있어요.", true);
            return await fn.apply(resolved, args);
          } catch (error) {
            clients.delete(name);
            throw error;
          }
        },
    },
  ) as T;
}
type Questions = {
  questions: QuestionView[];
  complete: boolean;
  revision: number;
  processing?: boolean;
  failed?: boolean;
};
type Answers = {
  expectedRevision: number;
  answers: (
    | { questionId: string; state: "answered"; value: string }
    | { questionId: string; state: "unknown" | "skipped" }
  )[];
};
export const api = {
  session: sessionApi,
  cases: domain<{
    list(): Promise<CaseView[]>;
    create(input: {
      narrative: string;
      subjectContext: "individual" | "company";
      turnstileToken?: string;
    }): Promise<CaseView>;
    get(id: string): Promise<CaseView>;
    getQuestions(id: string): Promise<Questions>;
    saveAnswers(id: string, input: Answers): Promise<Questions>;
    advance(id: string, input: { expectedRevision: number }): Promise<Questions>;
    saveSummary(
      id: string,
      input: { expectedRevision: number; summary: string },
    ): Promise<CaseView>;
    confirmSummary(id: string, input: { expectedRevision: number }): Promise<CaseView>;
  }>("cases"),
  workspace: domain<{
    get(id: string): Promise<WorkspaceView>;
    sendMessage(
      id: string,
      input: { expectedRevision: number; text: string; selectedFileIds: string[] },
    ): Promise<WorkspaceView>;
    retryMessage(id: string, messageId: string): Promise<WorkspaceView>;
    setAction(id: string, actionId: string, done: boolean): Promise<WorkspaceView>;
    saveTimeline(
      id: string,
      entry: Omit<TimelineView, "id"> & { id?: string },
    ): Promise<WorkspaceView>;
  }>("workspace"),
  files: domain<{
    list(id: string): Promise<FileView[]>;
    upload(id: string, file: File): Promise<FileView>;
    retry(id: string, fileId: string): Promise<FileView>;
    remove(id: string, fileId: string): Promise<FileView[]>;
    original(id: string, fileId: string): Promise<Blob>;
  }>("files"),
  reports: domain<{
    get(id: string): Promise<ReportView>;
    save(
      id: string,
      input: { content: string; maskIdentifiers: boolean; excludedFileIds: string[] },
    ): Promise<ReportView>;
    generate(id: string): Promise<ReportView>;
    pdf(id: string): Promise<Blob>;
    zip(id: string, selectedFileIds: string[]): Promise<Blob>;
  }>("reports"),
  account: domain<{
    usage(): Promise<
      UsageView & { resetAt?: string; waitReasons?: string[]; includesReservations?: boolean }
    >;
    deleteCase(id: string, confirmation: string, schemaVersion?: "1" | "2"): Promise<void>;
    deleteAccount(confirmation: string): Promise<void>;
    deletionAccess(): Promise<{
      ownerTag: string;
      recentOAuth: boolean;
      authenticatedAt: string | null;
      providers: Provider[];
      canDelete: boolean;
    }>;
    reauthenticate(provider: Provider): Promise<void>;
  }>("account"),
  lawyers: domain<{
    list(filters?: {
      region?: string;
      practiceArea?: string;
      query?: string;
    }): Promise<LawyerView[]>;
    get(id: string): Promise<LawyerView>;
    getMine(): Promise<LawyerView>;
    saveMine(profile: LawyerView): Promise<LawyerView>;
    publishMine(published: boolean): Promise<LawyerView>;
  }>("lawyers"),
};
export { ApiError, apiMode, apiRequest, errorMessage, request } from "./core";
export { roleStart } from "./session";
export * from "./types";
