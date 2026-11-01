import { createReworkClient } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FollowUpResolution,
  type ResolutionClient,
} from "../../src/components/resolution/FollowUpResolution";

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error("fixture request failed"), { code: data.code });
  return data;
}
const scope = createSessionScope();
const makeRework = () =>
  createReworkClient({
    scope,
    session: async () => {
      const session = await json<{ ownerId: string; needsConsent: boolean }>("/fixture/session");
      return {
        user: { id: session.ownerId, name: "합성 사용자", accountType: "customer" },
        needsConsent: session.needsConsent,
      };
    },
    request: async <T,>(_operation: string, _input: unknown, options = {}) => {
      const params = options as {
        path?: string;
        method?: string;
        body?: unknown;
        expectedOwner?: string;
        signal?: AbortSignal;
      };
      return json<T>(params.path ?? "/invalid", {
        method: params.method ?? "GET",
        headers: {
          "x-fixture-owner": params.expectedOwner ?? "",
          "content-type": "application/json",
        },
        ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
        ...(params.signal ? { signal: params.signal } : {}),
      });
    },
    challenge: async () => "synthetic",
    newKey: () => crypto.randomUUID(),
    guideHosts: ["www.easylaw.go.kr"],
    fingerprint: async (text) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
        (b) => b.toString(16).padStart(2, "0"),
      ).join(""),
  });
let rework = makeRework();
window.addEventListener("baro-session-changed", () => {
  scope.invalidate();
  rework = makeRework();
});
const client: ResolutionClient = {
  session: () => json("/fixture/session"),
  getResolution: (id, options) => rework.getResolution(id, options),
  updateResolution: (id, input, options) => rework.updateResolution(id, input, options),
  prepareDraft: (id, input, options) => rework.prepareDraft(id, input, options),
  files: () => json("/fixture/files"),
  report: () => json("/fixture/report"),
};
function Host() {
  const [surface, setSurface] = useState("report");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main>
      <nav>
        <button
          type="button"
          onClick={() => setSurface(surface === "report" ? "chat" : "report")}
          disabled={dirty || busy}
        >
          대화·리포트 보기 전환
        </button>
        <span>{surface === "report" ? "합성 리포트" : "합성 대화"}</span>
      </nav>
      <FollowUpResolution
        key={surface}
        caseId="case"
        {...(new URLSearchParams(location.search).has("default") ? {} : { client })}
        embedded={surface === "chat"}
        onSaveReport={() => json<void>("/fixture/save-report", { method: "POST" })}
        onDirtyChange={setDirty}
        onBusyChange={setBusy}
      />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw Error("fixture root");
createRoot(root).render(<Host />);
