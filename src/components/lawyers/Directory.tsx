import { ArrowRight, ChevronDown, Info, MapPin, Search, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type LawyerView, lawyerErrorMessage } from "../../client/api/lawyers";
import { PUBLIC_PREVIEW } from "../../client/public-preview";
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
    if (PUBLIC_PREVIEW) {
      setBusy(false);
      return;
    }
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
    <div className="lawyer-directory">
      <div className="directory-intro">
        <PageHeader
          eyebrow="함께할 전문가를 찾는 첫걸음"
          title="변호사 찾기"
          description="분야와 지역을 살펴보고, 원하는 변호사에게 직접 연락하세요."
        />
        <div className="directory-illustration" aria-hidden="true">
          <div className="directory-illustration__profile">
            <UserRound size={48} strokeWidth={1.5} />
          </div>
          <span className="directory-illustration__search">
            <Search size={26} strokeWidth={2.2} />
          </span>
        </div>
      </div>
      <ApiModeNotice preview={preview} />
      <Card className="directory-search">
        <CardHeader>
          <CardTitle>어떤 변호사를 찾고 계신가요?</CardTitle>
          <p>필요한 분야와 가까운 지역부터 살펴보세요.</p>
        </CardHeader>
        <CardContent>
          <form
            className="directory-search__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (PUBLIC_PREVIEW || !ready) return;
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
            <label className="directory-search__field">
              <span>이름 또는 사무실</span>
              <span className="directory-search__input">
                <Search size={19} aria-hidden="true" />
                <input
                  placeholder="이름 또는 사무실명 입력"
                  maxLength={100}
                  disabled={PUBLIC_PREVIEW || !ready}
                  value={filters.name}
                  onChange={(event) => setFilters({ ...filters, name: event.target.value })}
                />
              </span>
            </label>
            <label className="directory-search__field">
              <span>지역</span>
              <span className="directory-search__select">
                <select
                  disabled={PUBLIC_PREVIEW || !ready}
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
                <ChevronDown size={18} aria-hidden="true" />
              </span>
            </label>
            <label className="directory-search__field">
              <span>분야</span>
              <span className="directory-search__select">
                <select
                  disabled={PUBLIC_PREVIEW || !ready}
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
                <ChevronDown size={18} aria-hidden="true" />
              </span>
            </label>
            <div className="directory-search__submit">
              <Button
                type="submit"
                disabled={PUBLIC_PREVIEW || !ready}
                className="directory-search__button"
              >
                <Search size={18} aria-hidden="true" />
                {PUBLIC_PREVIEW ? "검색 · 준비 중" : "검색"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="directory-results-heading">
        <h2>공개 프로필</h2>
        {!busy && !error && items.length > 0 && (
          <p role="status">공개 프로필 {items.length}개를 찾았어요.</p>
        )}
      </div>
      {error && (
        <StatePanel
          variant="error"
          title={error}
          action={
            <Button onClick={() => void load(new URLSearchParams(query.current))}>다시 검색</Button>
          }
        />
      )}
      {PUBLIC_PREVIEW && (
        <StatePanel
          variant="pending"
          title="변호사 찾기를 준비하고 있어요."
          description="2026년 11월 1일 웹 전체 출시 예정이에요. 지금은 사건 입력과 질문 답변을 체험해 주세요."
        />
      )}
      {!PUBLIC_PREVIEW && !busy && !error && items.length === 0 && (
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
      <div className="directory-results" aria-busy={busy}>
        {items.slice(0, visibleCount).map((lawyer) => (
          <Card key={lawyer.id} className="directory-profile">
            <CardHeader className="directory-profile__header">
              <div className="directory-profile__photo">
                <AssetPhoto
                  profileId={lawyer.id}
                  assetId={lawyer.photoAssetId}
                  fallback={lawyer.photoUrl}
                  alt={`${lawyer.name} 프로필 사진`}
                  size={64}
                />
              </div>
              <div className="directory-profile__identity">
                <CardTitle>
                  <a href={`/lawyers/${encodeURIComponent(lawyer.id)}`}>{lawyer.name}</a>
                  <span>변호사</span>
                </CardTitle>
                <p>{lawyer.officeName}</p>
              </div>
            </CardHeader>
            <CardContent className="directory-profile__content">
              <p className="directory-profile__location">
                <MapPin size={16} aria-hidden="true" />
                {REGION_LABELS[lawyer.region as keyof typeof REGION_LABELS] ?? lawyer.region}
              </p>
              <p className="directory-profile__introduction">{lawyer.introduction}</p>
              <ul className="directory-profile__fields" aria-label="활동 분야">
                {lawyer.practiceAreas.map((field) => (
                  <li key={field}>{FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field}</li>
                ))}
              </ul>
              <p className="directory-profile__disclosure">본인 작성 정보 · 자격 확인 표시 없음</p>
              <a
                className="directory-profile__link"
                href={`/lawyers/${encodeURIComponent(lawyer.id)}`}
              >
                프로필과 연락처 보기
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
      {busy && <StatePanel variant="loading" title="공개 프로필을 불러오고 있어요." />}
      {items.length > visibleCount && !error && (
        <Button
          variant="outline"
          className="directory-more"
          disabled={busy}
          onClick={() => setVisibleCount((count) => count + 20)}
        >
          더 보기
          <ChevronDown size={17} aria-hidden="true" />
        </Button>
      )}
      <div className="directory-disclosure">
        <Info size={18} aria-hidden="true" />
        <p>
          변호사가 공개한 프로필을 표시합니다. 목록 순서는 매일 바뀝니다. 분야는 변호사가 기재한
          정보이며 적합성이나 성과를 보증하지 않습니다.
        </p>
      </div>
    </div>
  );
}
