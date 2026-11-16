/** Offline request/D1 counts only. Never import this fixture runner into product code. */
import {
  createCasesClient,
  createFileMetadataReader,
  createReworkClient,
  createWorkspaceClient,
  type OperationRequest,
  type OperationRequestOptions,
  type WorkspaceTransport,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { createProductQueryClient, productQueryKeys } from "../src/product-ui/queries";
import { createV2Core } from "../src/server/db/v2-core";
import { createReportsService } from "../src/server/modules/reports/service";
import { createReworkStateService } from "../src/server/modules/rework/state";
import { intake, summary, workspace } from "../tests/fixtures/contracts/v2";
import { conversationState } from "../tests/helpers/conversation-state";
import { countD1Calls } from "../tests/helpers/d1-call-count";

class BaselineError extends Error {}
function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new BaselineError(code);
}
function unexpectedWrite(): never {
  throw new BaselineError("UNEXPECTED_WRITE_OR_CHALLENGE");
}

type Resource =
  | "workspace"
  | "intake"
  | "summary"
  | "messages"
  | "actions"
  | "timeline"
  | "files"
  | "latestJob";
function transportFixture() {
  const reads: Resource[] = [];
  const base = `/api/v2/cases/${workspace.id}/`;
  const request: WorkspaceTransport = async (path, init) => {
    assert((init?.method ?? "GET") === "GET", "UNEXPECTED_HTTP_WRITE");
    assert(path.startsWith(base), "UNEXPECTED_SYNTHETIC_ROUTE");
    const resource = path.slice(base.length);
    if (resource === "workspace") {
      reads.push("workspace");
      return Response.json(workspace);
    }
    if (resource === "intake") {
      reads.push("intake");
      return Response.json({
        ...intake,
        summary: { id: "synthetic-summary", revision: summary.revision },
      });
    }
    if (resource === "summary") {
      reads.push("summary");
      return Response.json(summary);
    }
    if (resource === "workspace-jobs/latest") {
      reads.push("latestJob");
      return Response.json(null);
    }
    if (resource.startsWith("messages?")) {
      reads.push("messages");
      return Response.json({ items: [], nextCursor: null });
    }
    if (resource === "actions" || resource === "timeline") {
      reads.push(resource);
      return Response.json({ items: [], nextCursor: null });
    }
    if (resource === "files") {
      reads.push("files");
      return Response.json([]);
    }
    throw new BaselineError("UNEXPECTED_SYNTHETIC_ROUTE");
  };
  const scope = createSessionScope();
  const client = createWorkspaceClient({
    request,
    scope,
    newKey: unexpectedWrite,
    listFiles: createFileMetadataReader(request),
  });
  const jsonRequest: OperationRequest = async <T>(
    _operation: string,
    _input?: unknown,
    options: OperationRequestOptions = {},
  ) => {
    const response = await request(options.path ?? "", {
      ...(options.method ? { method: options.method } : {}),
    });
    return (await response.json()) as T;
  };
  const cases = createCasesClient({
    scope,
    mode: "real",
    request: jsonRequest,
    newKey: unexpectedWrite,
    fingerprint: async () => unexpectedWrite(),
    challenge: async () => unexpectedWrite(),
  });
  return { client, cases, reads };
}

async function measureTransport() {
  const direct = transportFixture();
  const directViews = await Promise.all([
    direct.client.get(workspace.id),
    direct.client.get(workspace.id),
  ]);
  const shared = transportFixture();
  const cache = createProductQueryClient();
  try {
    const key = productQueryKeys.resource(
      { ownerId: "synthetic-owner", generation: 1, caseId: workspace.id },
      "conversation",
    );
    const read = () =>
      cache.fetchQuery({ queryKey: key, queryFn: () => shared.client.get(workspace.id) });
    const sharedViews = await Promise.all([read(), read()]);
    const cold = shared.reads.length;
    assert(cold > 0 && direct.reads.length === cold * 2, "CONCURRENT_QUERY_COALESCING_CHANGED");
    assert(
      [...directViews, ...sharedViews].every((view) => view.case.id === workspace.id),
      "UNEXPECTED_WORKSPACE_IDENTITY",
    );
    await read();
    const freshCacheHit = shared.reads.length - cold;
    const warmStart = shared.reads.length;
    await shared.client.get(workspace.id);
    const warm = shared.reads.length - warmStart;
    const redundant = transportFixture();
    await redundant.cases.get(workspace.id);
    const detail = redundant.reads.length;
    await redundant.client.get(workspace.id);
    return {
      concurrentConsumers: 2,
      concurrentDirectRequests: direct.reads.length,
      concurrentSharedQueryRequests: cold,
      coldWorkspaceRequests: cold,
      freshQueryCacheHitRequests: freshCacheHit,
      warmWorkspaceRevalidationRequests: warm,
      redundantCaseDetail: {
        detailRequests: detail,
        subsequentWorkspaceRequests: redundant.reads.length - detail,
        combinedRequests: redundant.reads.length,
      },
    };
  } finally {
    cache.clear();
  }
}

async function measureReworkClient() {
  let domainRequests = 0;
  let sessionChecks = 0;
  const value = {
    contractVersion: "conversation-report-progress-v1",
    state: conversationState(),
    reportContinuation: null,
  };
  const request: OperationRequest = async <T>() => {
    domainRequests++;
    return value as T;
  };
  const client = createReworkClient({
    scope: createSessionScope(),
    request,
    session: async () => {
      sessionChecks++;
      return {
        user: { id: "synthetic-owner", name: "합성", accountType: "customer" },
        needsConsent: false,
      };
    },
    challenge: async () => unexpectedWrite(),
    fingerprint: async () => unexpectedWrite(),
    newKey: unexpectedWrite,
  });
  await client.getConversationProgress(workspace.id);
  return { domainRequests, sessionChecks };
}

async function measureProgressD1() {
  // This existing fixture switch skips test-runner hooks in the standalone CLI.
  // Its SQLite/R2 adapters remain local; it enables no product fallback or provider.
  const previous = Bun.env.BARO_SYNTHETIC_REPORT_SERVER;
  Bun.env.BARO_SYNTHETIC_REPORT_SERVER = "true";
  try {
    const { reportFixture } = await import("../tests/helpers/report-fixture");
    const fixture = await reportFixture();
    try {
      const meter = countD1Calls(fixture.db.binding);
      const core = createV2Core(meter.binding, fixture.core.cipher);
      const state = createReworkStateService(core, {
        clock: () => fixture.actor.now,
        peekReport: (owner, id) => createReportsService(core, fixture.deps).peek(owner, id),
      });
      await state.getProgress(fixture.actor.ownerId, fixture.workspaceId);
      const withoutReport = { ...meter.work };
      // Fixture setup intentionally creates one legacy synthetic report outside
      // the measured binding. No provider or remote database is involved.
      await fixture.reports.get(fixture.actor.ownerId, fixture.workspaceId);
      meter.reset();
      await state.getProgress(fixture.actor.ownerId, fixture.workspaceId);
      return { withoutReport, withStoredLegacyReport: { ...meter.work } };
    } finally {
      fixture.db.close();
    }
  } finally {
    if (previous === undefined) delete Bun.env.BARO_SYNTHETIC_REPORT_SERVER;
    else Bun.env.BARO_SYNTHETIC_REPORT_SERVER = previous;
  }
}

async function measure() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => {
      throw new BaselineError("NETWORK_ACCESS_FORBIDDEN");
    },
    {
      preconnect: () => {
        throw new BaselineError("NETWORK_ACCESS_FORBIDDEN");
      },
    },
  );
  try {
    return {
      environment: "local synthetic",
      excludes: [
        "network latency",
        "HTTP authentication database work",
        "cloud D1 latency and rows read",
        "provider latency",
        "production acceptance",
      ],
      transport: await measureTransport(),
      reworkClient: await measureReworkClient(),
      reworkProgressD1: await measureProgressD1(),
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

try {
  console.log(JSON.stringify(await measure(), null, 2));
} catch (error) {
  // Never print request text, identities, secrets, SQL or dependency stacks.
  console.error(
    JSON.stringify({
      environment: "local synthetic",
      error: error instanceof BaselineError ? error.message : "BASELINE_MEASUREMENT_FAILED",
    }),
  );
  process.exitCode = 1;
}
