import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../client/api/errors";
import { precedentsApi } from "../../client/api/precedents";
import { useCustomerAccess } from "../../components/intake/useCustomerAccess";
import type {
  V2PrecedentReadResponse,
  V2PrecedentResearchContext,
  V2PrecedentSearchResponse,
  V2PrecedentTopic,
} from "../../contracts/v2/precedent-research";
import { PRECEDENT_TOPIC_LABELS } from "../../contracts/v2/precedent-topics";
import { isAccessError } from "./presentation";

type Item = V2PrecedentSearchResponse["items"][number];
const allTopics = Object.keys(PRECEDENT_TOPIC_LABELS) as V2PrecedentTopic[];
export function useResearchController({
  caseId,
  embedded = false,
}: {
  caseId: string;
  embedded?: boolean;
}) {
  const [context, setContext] = useState<V2PrecedentResearchContext | null>(null);
  const [topics, setTopics] = useState<V2PrecedentTopic[]>([]);
  const [result, setResult] = useState<V2PrecedentSearchResponse | null>(null);
  const [document, setDocument] = useState<V2PrecedentReadResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const currentContext = useRef<V2PrecedentResearchContext | null>(null);
  const documentHeading = useRef<HTMLHeadingElement>(null);
  const detailView = useRef<HTMLElement>(null);
  const resultOpener = useRef<HTMLButtonElement | null>(null);
  const listScroll = useRef(0);
  const requests = useRef<{
    context?: AbortController;
    search?: AbortController;
    read?: AbortController;
  }>({});
  const clearResults = useCallback(() => {
    requests.current.search?.abort();
    requests.current.read?.abort();
    setResult(null);
    setDocument(null);
    setSelected(null);
    setBusy(false);
    setReading(false);
    setReadError(null);
  }, []);
  useEffect(() => {
    const renamed = (event: Event) => {
      if ((event as CustomEvent<{ id?: string }>).detail?.id === caseId)
        setReload((value) => value + 1);
    };
    window.addEventListener("baro-case-title-changed", renamed);
    return () => window.removeEventListener("baro-case-title-changed", renamed);
  }, [caseId]);
  const access = useCustomerAccess(() => {
    requests.current.context?.abort();
    clearResults();
    currentContext.current = null;
    setContext(null);
    setTopics([]);
  }, setError);
  const boundary = useRef(access);
  boundary.current = access;

  useEffect(() => {
    // Foreground verification and explicit retry each refresh the case revision.
    void access.version;
    void reload;
    if (!access.ready) return;
    const controller = new AbortController();
    requests.current.context?.abort();
    requests.current.context = controller;
    const ticket = access.ticket();
    void precedentsApi
      .context(caseId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || !boundary.current.current(ticket)) return;
        const prior = currentContext.current;
        if (
          prior &&
          (prior.summaryRevision !== next.summaryRevision ||
            prior.workspaceRevision < (next.researchRevision ?? next.workspaceRevision) ||
            prior.workspaceRevision > next.workspaceRevision)
        ) {
          clearResults();
        }
        if (!prior || prior.summaryRevision !== next.summaryRevision)
          setTopics(next.recommendedTopics.slice(0, 2));
        currentContext.current = next;
        setContext(next);
        setError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted || !boundary.current.alive(ticket)) return;
        if (isAccessError(cause)) boundary.current.deny();
        if (cause instanceof ApiError && ["NOT_FOUND", "CONFLICT"].includes(cause.code)) {
          clearResults();
          currentContext.current = null;
          setContext(null);
        }
        setError(cause);
      });
    return () => controller.abort();
  }, [caseId, access.ready, access.version, access.ticket, reload, clearResults]);
  useEffect(
    () => () => {
      for (const controller of Object.values(requests.current)) controller?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!selected) return;
    documentHeading.current?.focus({ preventScroll: true });
    detailView.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [selected]);

  function backToResults() {
    requests.current.read?.abort();
    setSelected(null);
    setDocument(null);
    setReadError(null);
    setReading(false);
    requestAnimationFrame(() => {
      resultOpener.current?.focus({ preventScroll: true });
      if (!embedded) window.scrollTo({ top: listScroll.current, behavior: "instant" });
    });
  }

  async function search(more = false) {
    if (busy || !context || !topics.length) return;
    if (!more) clearResults();
    setError(null);
    const controller = new AbortController();
    requests.current.search = controller;
    setBusy(true);
    const ticket = access.ticket();
    try {
      if (!(await access.verify()) || controller.signal.aborted || !access.current(ticket)) return;
      const next = await precedentsApi.search(
        caseId,
        {
          expectedRevision: more && result ? result.workspaceRevision : context.workspaceRevision,
          summaryRevision: context.summaryRevision,
          topics: more && result ? result.topics : topics,
          pageSize: 5,
          ...(more && result?.nextCursor ? { cursor: result.nextCursor } : {}),
        },
        controller.signal,
      );
      if (!controller.signal.aborted && access.current(ticket))
        setResult((prior) => {
          if (!more || !prior) return next;
          const items = [
            ...new Map(
              [...prior.items, ...next.items].map((item) => [item.citation.sourceId, item]),
            ).values(),
          ];
          return {
            ...next,
            items,
            status: items.length
              ? next.unavailableTopics.length
                ? "partial"
                : "complete"
              : next.status,
          };
        });
    } catch (cause) {
      if (!controller.signal.aborted && access.alive(ticket)) {
        if (isAccessError(cause)) access.deny();
        if (cause instanceof ApiError && ["NOT_FOUND", "CONFLICT"].includes(cause.code)) {
          clearResults();
          currentContext.current = null;
          setContext(null);
          if (cause.code === "CONFLICT") {
            setError(null);
            setReload((n) => n + 1);
            return;
          }
        }
        setError(cause);
      }
    } finally {
      if (!controller.signal.aborted && access.current(ticket)) setBusy(false);
    }
  }
  async function read(item: Item) {
    if (!context) return;
    if (!selected) listScroll.current = window.scrollY;
    requests.current.read?.abort();
    const controller = new AbortController();
    requests.current.read = controller;
    setSelected(item.id);
    setDocument(null);
    setReadError(null);
    setReading(true);
    const ticket = access.ticket();
    try {
      if (!(await access.verify()) || controller.signal.aborted || !access.current(ticket)) return;
      const next = await precedentsApi.read(
        caseId,
        {
          expectedRevision: result?.workspaceRevision ?? context.workspaceRevision,
          readToken: item.readToken,
          includeFullText: true,
        },
        controller.signal,
      );
      if (!controller.signal.aborted && access.current(ticket)) setDocument(next);
    } catch (cause) {
      if (!controller.signal.aborted && access.alive(ticket)) {
        if (isAccessError(cause)) access.deny();
        if (cause instanceof ApiError && cause.code === "CONFLICT") {
          clearResults();
          currentContext.current = null;
          setContext(null);
          setError(null);
          setReload((n) => n + 1);
        } else {
          setReadError(cause);
          // A missing proof can also mean the case/role was revoked. Refresh
          // scope without hiding valid results merely because a proof expired.
          if (cause instanceof ApiError && cause.code === "NOT_FOUND") setReload((n) => n + 1);
        }
      }
    } finally {
      if (!controller.signal.aborted && access.current(ticket)) setReading(false);
    }
  }
  const visibleTopics = [
    ...new Set([...(context?.recommendedTopics ?? []), ...allTopics.slice(0, 8)]),
  ];
  const chosen = result?.items.find((item) => item.id === selected);
  const sourceCurrent =
    !!result &&
    !!context &&
    result.workspaceRevision >= (context.researchRevision ?? context.workspaceRevision) &&
    result.workspaceRevision <= context.workspaceRevision &&
    result?.summaryRevision === context?.summaryRevision;
  return {
    caseId,
    embedded,
    context,
    topics,
    result,
    document,
    selected,
    busy,
    reading,
    error,
    readError,
    access,
    documentHeading,
    detailView,
    resultOpener,
    visibleTopics,
    allTopics,
    chosen,
    sourceCurrent,
    setReload,
    setError,
    setTopics,
    backToResults,
    search,
    read,
  };
}
export type ResearchProps = Parameters<typeof useResearchController>[0];
export type ResearchController = ReturnType<typeof useResearchController>;
