import { MapPin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type LawyerView, lawyerErrorMessage } from "../../client/api/lawyers";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { PageHeader } from "../ui/page-header";
import { StatePanel } from "../ui/state-panel";
import { ApiModeNotice } from "./ApiModeNotice";
import { AssetPhoto } from "./AssetPhoto";
import { FIELD_LABELS, REGION_LABELS } from "./labels";

export function Directory({ preview = false }: { preview?: boolean }) {
  const [items, setItems] = useState<LawyerView[]>([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState({ name: "", region: "", legalField: "" });
  const current = useRef<AbortController | null>(null);
  const query = useRef("");
  const load = useCallback(async (params: URLSearchParams) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setBusy(true);
    setError("");
    setItems([]);
    setVisibleCount(20);
    try {
      const page = await api.lawyers.list({
        query: params.get("name") ?? "",
        region: params.get("region") ?? "",
        practiceArea: params.get("legalField") ?? "",
      });
      if (controller.signal.aborted) return;
      setItems(page);
    } catch (cause) {
      if (!controller.signal.aborted) setError(lawyerErrorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const chosen = {
        name: params.get("name") ?? "",
        region: params.get("region") ?? "",
        legalField: params.get("legalField") ?? "",
      };
      setFilters(chosen);
      const search = new URLSearchParams(
        Object.entries(chosen).filter(([, value]) => value !== ""),
      );
      query.current = search.toString();
      setReady(true);
      void load(search);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => {
      current.current?.abort();
      window.removeEventListener("popstate", restore);
    };
  }, [load]);
  return (
    <div className="lawyer-directory space-y-6">
      <PageHeader
        title="변호사 찾기"
        description="분야와 지역을 살펴보고, 원하는 변호사에게 직접 연락하세요."
      />
      <ApiModeNotice preview={preview} />
      <Card>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!ready) return;
              const params = new URLSearchParams(
                Object.entries(filters)
                  .filter(([, value]) => value.trim() !== "")
                  .map(([key, value]) => [key, value.trim()]),
              );
              query.current = params.toString();
              const url = `/lawyers${params.size ? `?${params}` : ""}`;
              if (`${window.location.pathname}${window.location.search}` !== url)
                window.history.pushState(null, "", url);
              void load(params);
            }}
          >
            <label className="grid gap-2">
              이름 또는 사무실
              <input
                className="rounded-lg border border-input bg-card p-3"
                maxLength={100}
                disabled={!ready}
                value={filters.name}
                onChange={(event) => setFilters({ ...filters, name: event.target.value })}
              />
            </label>
            <label className="grid gap-2">
              지역
              <select
                className="rounded-lg border border-input bg-card p-3"
                disabled={!ready}
                value={filters.region}
                onChange={(event) => setFilters({ ...filters, region: event.target.value })}
              >
                <option value="">전체 지역</option>
                {Object.entries(REGION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              분야
              <select
                className="rounded-lg border border-input bg-card p-3"
                disabled={!ready}
                value={filters.legalField}
                onChange={(event) => setFilters({ ...filters, legalField: event.target.value })}
              >
                <option value="">전체 분야</option>
                {Object.entries(FIELD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={!ready}>
                검색
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        변호사가 공개한 프로필을 표시합니다. 목록 순서는 매일 바뀝니다. 분야는 변호사가 기재한
        정보이며 적합성이나 성과를 보증하지 않습니다.
      </p>
      {error && (
        <StatePanel
          variant="error"
          title={error}
          action={
            <Button onClick={() => void load(new URLSearchParams(query.current))}>다시 검색</Button>
          }
        />
      )}
      {!busy && !error && items.length === 0 && (
        <StatePanel
          variant="empty"
          title="조건에 맞는 공개 프로필이 없어요."
          description="해당 지역이나 분야의 등록 정보가 부족할 수 있어요. 다른 조건으로 검색해 보세요."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setFilters({ name: "", region: "", legalField: "" });
                query.current = "";
                window.history.pushState(null, "", "/lawyers");
                void load(new URLSearchParams());
              }}
            >
              조건 초기화
            </Button>
          }
        />
      )}
      {!busy && !error && items.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          공개 프로필 {items.length}개를 찾았어요.
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2" aria-busy={busy}>
        {items.slice(0, visibleCount).map((lawyer) => (
          <Card key={lawyer.id}>
            <CardHeader>
              <AssetPhoto
                profileId={lawyer.id}
                assetId={lawyer.photoAssetId}
                fallback={lawyer.photoUrl}
                alt={`${lawyer.name} 프로필 사진`}
                size={80}
              />
              <CardTitle>
                <a href={`/lawyers/${encodeURIComponent(lawyer.id)}`}>{lawyer.name}</a>
              </CardTitle>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                본인 작성 정보 · 자격 확인 표시 없음
              </p>
            </CardHeader>
            <CardContent>
              <p className="flex items-start gap-2">
                <MapPin size={18} aria-hidden="true" />
                {REGION_LABELS[lawyer.region as keyof typeof REGION_LABELS] ?? lawyer.region} ·{" "}
                {lawyer.officeName}
              </p>
              <p className="my-3 whitespace-pre-wrap break-words">{lawyer.introduction}</p>
              <p className="text-sm text-muted-foreground">
                {lawyer.practiceAreas
                  .map((field) => FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field)
                  .join(" · ")}
              </p>
              <a
                className="ui-button ui-button--outline mt-4"
                href={`/lawyers/${encodeURIComponent(lawyer.id)}`}
              >
                프로필과 연락처 보기
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
      {busy && <StatePanel variant="loading" title="공개 프로필을 불러오고 있어요." />}
      {items.length > visibleCount && !error && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setVisibleCount((count) => count + 20)}
        >
          더 보기
        </Button>
      )}
    </div>
  );
}
