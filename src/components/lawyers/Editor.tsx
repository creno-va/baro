import { Eye, Pencil, Plus, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  LawyerApiError,
  type LawyerAssetView,
  type LawyerView,
  lawyerAssets,
  lawyerErrorMessage,
} from "../../client/api/lawyers";
import { sessionApi } from "../../client/api/session";
import {
  selfAssetUrl,
  stripSelfPhotoMetadata,
} from "../../server/modules/lawyers/self-profile-contract";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { PageHeader } from "../ui/page-header";
import { StatePanel } from "../ui/state-panel";
import { ApiModeNotice } from "./ApiModeNotice";
import { AssetPhoto } from "./AssetPhoto";
import { FIELD_LABELS, REGION_LABELS } from "./labels";
import { ProfileContent } from "./Profile";

async function photoData(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new LawyerApiError("VALIDATION_ERROR", "JPEG·PNG·WebP 사진을 10MB 이하로 선택해 주세요.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image unavailable");
    const side = Math.min(bitmap.width, bitmap.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 240, 240);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      240,
      240,
    );
    for (const quality of [0.8, 0.6, 0.4]) {
      const result = stripSelfPhotoMetadata(canvas.toDataURL("image/jpeg", quality));
      if (result.length <= 44000) return result;
    }
    throw new LawyerApiError(
      "VALIDATION_ERROR",
      "사진을 줄이지 못했어요. 더 작은 사진으로 다시 선택해 주세요.",
    );
  } finally {
    bitmap.close();
  }
}
export function Editor() {
  const [saved, setSaved] = useState<LawyerView | null>(null);
  const [draft, setDraft] = useState<LawyerView | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publicationConsent, setPublicationConsent] = useState(false);
  const [assets, setAssets] = useState<LawyerAssetView[]>([]);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const dirty = !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft);
  const fail = (cause: unknown) => {
    setError(lawyerErrorMessage(cause));
    setErrorCode(cause instanceof LawyerApiError ? cause.code : "");
  };
  const owner = useRef<string | null>(null);
  const epoch = useRef(0);
  const sessionRequest = useRef(0);
  const profileRequest = useRef(0);
  const clear = useCallback(() => {
    epoch.current += 1;
    profileRequest.current += 1;
    setAssets([]);
    setPhotoPreview(null);
    setSaved(null);
    setDraft(null);
    setPreview(false);
    setConfirmDiscard(false);
    setConfirmPublish(false);
    setPublicationConsent(false);
    setNotice("");
    setError("");
    setErrorCode("");
  }, []);
  const verify = useCallback(async () => {
    const request = ++sessionRequest.current;
    let session: Awaited<ReturnType<typeof sessionApi.get>>;
    try {
      session = await sessionApi.get();
    } catch (cause) {
      if (request !== sessionRequest.current) return null;
      throw cause;
    }
    if (request !== sessionRequest.current) return null;
    const identity = session.user
      ? `${session.user.id}:${session.user.accountType}:${session.needsConsent}`
      : "signed-out";
    const changed = owner.current !== identity;
    if (changed) {
      owner.current = identity;
      clear();
    }
    if (session.user?.accountType !== "lawyer" || session.needsConsent) {
      clear();
      setBusy(false);
      setErrorCode(session.needsConsent ? "CONSENT_REQUIRED" : "UNAUTHENTICATED");
      setError(
        session.needsConsent ? "필수 동의를 확인해 주세요." : "변호사 역할로 로그인해 주세요.",
      );
      return null;
    }
    return { identity, epoch: epoch.current, changed };
  }, [clear]);
  const load = useCallback(async () => {
    setBusy(true);
    let run = profileRequest.current;
    try {
      const checked = await verify();
      if (!checked) return;
      run = ++profileRequest.current;
      const p = await api.lawyers.getMine();
      if (checked.epoch !== epoch.current || run !== profileRequest.current) return;
      const after = await verify();
      if (!after || after.identity !== checked.identity || after.epoch !== checked.epoch) {
        if (after?.changed) await load();
        return;
      }
      setSaved(p);
      setDraft(p);
      setError("");
      setErrorCode("");
    } catch (cause) {
      if (run !== profileRequest.current) return;
      clear();
      run = profileRequest.current;
      setError(lawyerErrorMessage(cause));
      setErrorCode(cause instanceof LawyerApiError ? cause.code : "");
    } finally {
      if (run === profileRequest.current) setBusy(false);
    }
  }, [verify, clear]);
  useEffect(() => {
    let alive = true;
    void load();
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const checked = await verify();
        if (alive && checked?.changed) await load();
      } catch (cause) {
        if (!alive) return;
        clear();
        setBusy(false);
        setError(lawyerErrorMessage(cause));
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      epoch.current += 1;
      sessionRequest.current += 1;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, verify, clear]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const patch = (field: keyof LawyerView, value: unknown) => {
    setDraft((p) => (p ? { ...p, [field]: value } : p));
    setNotice("");
  };
  const mutate = async (operation: () => Promise<LawyerView>, message: string) => {
    const startEpoch = epoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const checked = await verify();
      if (!checked || checked.epoch !== startEpoch) {
        if (checked?.changed) await load();
        return;
      }
      const p = await operation();
      if (epoch.current !== startEpoch) return;
      const after = await verify();
      if (!after || after.identity !== checked.identity || after.epoch !== startEpoch) {
        if (after?.changed) await load();
        return;
      }
      setDraft(p);
      setSaved(p);
      setConfirmPublish(false);
      setPublicationConsent(false);
      setErrorCode("");
      setPhotoPreview(null);
      setNotice(message);
    } catch (cause) {
      if (epoch.current === startEpoch) fail(cause);
    } finally {
      if (epoch.current === startEpoch) setBusy(false);
    }
  };
  const save = async () => {
    if (!draft || busy) return;
    await mutate(() => api.lawyers.saveMine(draft), "프로필을 저장했어요.");
  };
  const publish = async (published: boolean) => {
    if (!saved || busy) return;
    await mutate(
      () => api.lawyers.publishMine(published, saved),
      published
        ? "프로필을 공개했어요. 디렉터리에서 확인할 수 있어요."
        : "프로필을 비공개로 전환했어요.",
    );
  };
  const attach = (asset: LawyerAssetView) => {
    if (!draft || asset.status !== "ready") return;
    if (asset.purpose === "profile_photo") {
      setDraft({ ...draft, photoAssetId: asset.id, photoUrl: selfAssetUrl(draft.id, asset.id) });
    } else {
      setDraft({
        ...draft,
        portfolio: [
          ...draft.portfolio,
          {
            id: crypto.randomUUID(),
            title: "공개 자료",
            url: selfAssetUrl(draft.id, asset.id),
            assetId: asset.id,
          },
        ],
      });
    }
    setNotice("자료를 연결했어요. 프로필을 저장하면 반영돼요.");
  };
  const refreshAssets = async () => {
    const startEpoch = epoch.current;
    try {
      const checked = await verify();
      if (!checked || checked.epoch !== startEpoch) return;
      const items = await lawyerAssets.list();
      if (epoch.current !== startEpoch) return;
      const after = await verify();
      if (!after || after.epoch !== startEpoch) {
        if (after?.changed) await load();
        return;
      }
      setAssets(items);
    } catch (cause) {
      if (epoch.current === startEpoch) fail(cause);
    }
  };
  const removeAsset = async (asset: LawyerAssetView) => {
    const startEpoch = epoch.current;
    setBusy(true);
    setError("");
    try {
      const checked = await verify();
      if (!checked || checked.epoch !== startEpoch) return;
      await lawyerAssets.remove(asset.id, asset.revision);
      if (epoch.current !== startEpoch) return;
      const after = await verify();
      if (!after || after.epoch !== startEpoch) {
        if (after?.changed) await load();
        return;
      }
      if (epoch.current === startEpoch) {
        setAssets((items) => items.filter((a) => a.id !== asset.id));
        setNotice("자료 삭제를 접수했어요. 원격 정리는 별도 절차로 진행돼요.");
      }
    } catch (cause) {
      if (epoch.current === startEpoch) fail(cause);
    } finally {
      if (epoch.current === startEpoch) setBusy(false);
    }
  };
  const upload = async (file: File, purpose: "profile_photo" | "portfolio") => {
    if (!draft || busy) return;
    const startEpoch = epoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const checked = await verify();
      if (!checked || checked.epoch !== startEpoch) return;
      let selected = file,
        previewData: string | null = null;
      if (purpose === "profile_photo") {
        previewData = await photoData(file);
        selected = new File(
          [Uint8Array.from(atob(previewData.split(",")[1] ?? ""), (c) => c.charCodeAt(0))],
          "profile.jpg",
          { type: "image/jpeg" },
        );
      }
      if (epoch.current !== startEpoch) return;
      const asset = await lawyerAssets.upload(draft.id, selected, purpose);
      if (epoch.current !== startEpoch) return;
      const after = await verify();
      if (!after || after.epoch !== startEpoch) {
        if (after?.changed) await load();
        return;
      }
      setAssets((items) => [asset, ...items.filter((a) => a.id !== asset.id)]);
      if (asset.status === "ready") {
        attach(asset);
        if (previewData) setPhotoPreview(previewData);
      } else
        setNotice(
          "자료를 업로드했어요. 정제 완료 후 ‘자료 상태 확인’에서 연결해 주세요. 처리 대기는 공개 완료가 아니에요.",
        );
    } catch (cause) {
      if (epoch.current === startEpoch) fail(cause);
    } finally {
      if (epoch.current === startEpoch) setBusy(false);
    }
  };
  return (
    <div className="lawyer-editor space-y-6">
      <ApiModeNotice />
      <PageHeader
        title="내 변호사 프로필"
        description="소개와 연락처를 작성하고, 공개할 정보를 직접 관리하세요."
      />
      <div className="flex flex-wrap gap-3">
        <a className="ui-button ui-button--outline" href="/lawyers">
          변호사 디렉터리
        </a>
        {saved?.published && (
          <a
            className="ui-button ui-button--outline"
            href={`/lawyers/${encodeURIComponent(saved.id)}`}
          >
            내 공개 프로필 보기
          </a>
        )}
      </div>
      {error && (
        <StatePanel
          variant={
            errorCode === "UNAUTHENTICATED" || errorCode === "CONSENT_REQUIRED"
              ? "permission"
              : "error"
          }
          title={error}
          description={
            errorCode === "CONFLICT"
              ? "지금 작성한 내용은 그대로 남아 있어요. 최신 내용을 불러오면 현재 변경을 버릴지 먼저 확인해요."
              : draft
                ? "입력한 내용은 그대로 남아 있어요. 내용을 확인한 뒤 다시 저장해 주세요."
                : "본인 계정의 프로필만 관리할 수 있어요."
          }
          action={
            errorCode === "UNAUTHENTICATED" ? (
              <a className="ui-button ui-button--primary" href="/login?returnTo=%2Flawyer">
                로그인
              </a>
            ) : errorCode === "CONSENT_REQUIRED" ? (
              <a className="ui-button ui-button--primary" href="/consent?returnTo=%2Flawyer">
                동의 확인
              </a>
            ) : (
              <Button
                disabled={busy}
                onClick={() => {
                  if (dirty) setConfirmDiscard(true);
                  else void load();
                }}
              >
                최신 프로필 다시 불러오기
              </Button>
            )
          }
        />
      )}
      {notice && (
        <p className="lawyer-notice" role="status">
          {notice}
        </p>
      )}
      {busy && !draft && <StatePanel variant="loading" title="내 프로필을 불러오고 있어요." />}
      {draft && (
        <>
          <div className="lawyer-toolbar">
            <p>
              <strong>{saved?.published ? "공개 중" : "비공개"}</strong> ·{" "}
              {dirty ? "저장하지 않은 변경이 있어요" : "저장된 프로필"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setPreview(!preview)}>
                {preview ? <Pencil size={16} /> : <Eye size={16} />}{" "}
                {preview ? "편집으로 돌아가기" : "미리보기"}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !dirty}
                onClick={() => setConfirmDiscard(true)}
              >
                변경 취소
              </Button>
            </div>
          </div>
          {confirmDiscard && (
            <Card>
              <CardContent>
                <p>저장하지 않은 변경을 버리고 최신 프로필을 불러올까요?</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setConfirmDiscard(false);
                      void load();
                    }}
                  >
                    변경 버리기
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmDiscard(false)}>
                    계속 편집
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {preview ? (
            <>
              <p className="lawyer-notice">
                현재 작성 내용을 미리 보고 있어요. 미리보기는 저장하거나 공개하지 않아요.
              </p>
              <ProfileContent
                lawyer={
                  photoPreview ? { ...draft, photoUrl: photoPreview, photoAssetId: null } : draft
                }
                privateRead
              />
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={busy} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>사진과 기본 정보</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="lawyer-photo-row">
                      <AssetPhoto
                        profileId={draft.id}
                        assetId={photoPreview ? null : draft.photoAssetId}
                        fallback={photoPreview ?? draft.photoUrl}
                        alt="내 프로필 사진"
                        size={100}
                        privateRead
                      />
                      <div>
                        <label className="lawyer-field">
                          프로필 사진
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={async (e) => {
                              const file = e.currentTarget.files?.[0];
                              e.currentTarget.value = "";
                              if (!file) return;
                              await upload(file, "profile_photo");
                            }}
                          />
                        </label>
                        <p className="text-sm text-muted-foreground">
                          10MB 이하 · 정사각형 사진으로 저장돼요.
                        </p>
                        <Button
                          variant="ghost"
                          disabled={!draft.photoUrl || busy}
                          onClick={() => {
                            setDraft({ ...draft, photoUrl: null, photoAssetId: null });
                            setPhotoPreview(null);
                          }}
                        >
                          프로필에서 사진 제외
                        </Button>
                      </div>
                    </div>
                    <div className="lawyer-fields mt-4">
                      <label className="lawyer-field">
                        이름
                        <input
                          value={draft.name}
                          maxLength={100}
                          onChange={(e) => patch("name", e.target.value)}
                          autoComplete="name"
                        />
                      </label>
                      <label className="lawyer-field">
                        사무실 이름
                        <input
                          value={draft.officeName}
                          maxLength={200}
                          onChange={(e) => patch("officeName", e.target.value)}
                          autoComplete="organization"
                        />
                      </label>
                    </div>
                    <label className="lawyer-field mt-4">
                      소개
                      <textarea
                        value={draft.introduction}
                        maxLength={5000}
                        rows={5}
                        onChange={(e) => patch("introduction", e.target.value)}
                      />
                    </label>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>분야와 사무실</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <fieldset>
                      <legend>분야 (복수 선택)</legend>
                      <div className="lawyer-checkboxes">
                        {Object.entries(FIELD_LABELS).map(([value, label]) => (
                          <label key={value}>
                            <input
                              type="checkbox"
                              checked={draft.practiceAreas.includes(value)}
                              onChange={(e) =>
                                patch(
                                  "practiceAreas",
                                  e.target.checked
                                    ? [...draft.practiceAreas, value]
                                    : draft.practiceAreas.filter((f) => f !== value),
                                )
                              }
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="lawyer-fields mt-4">
                      <label className="lawyer-field">
                        지역
                        <select
                          value={draft.region}
                          onChange={(e) => patch("region", e.target.value)}
                        >
                          <option value="">지역 선택</option>
                          {Object.entries(REGION_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="lawyer-field">
                        사무실 주소
                        <input
                          value={draft.address}
                          maxLength={500}
                          onChange={(e) => patch("address", e.target.value)}
                          autoComplete="street-address"
                        />
                      </label>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>직접 연락처</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="mb-4 text-sm text-muted-foreground">
                      공개할 연락처만 입력하세요. 연락 수단을 하나 이상 입력하면 공개할 수 있어요.
                    </p>
                    <div className="lawyer-fields">
                      <label className="lawyer-field">
                        전화번호
                        <input
                          type="tel"
                          value={draft.phone}
                          maxLength={30}
                          onChange={(e) => patch("phone", e.target.value)}
                          autoComplete="tel"
                        />
                      </label>
                      <label className="lawyer-field">
                        이메일
                        <input
                          type="email"
                          value={draft.email}
                          maxLength={254}
                          onChange={(e) => patch("email", e.target.value)}
                          autoComplete="email"
                        />
                      </label>
                      <label className="lawyer-field">
                        웹사이트 / 외부 상담 URL
                        <input
                          type="url"
                          placeholder="https://"
                          value={draft.website}
                          maxLength={2000}
                          onChange={(e) => patch("website", e.target.value)}
                        />
                      </label>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>포트폴리오</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="mb-4 text-sm text-muted-foreground">
                      공개 가능한 활동과 자료 링크를 등록하세요. 의뢰인 정보는 포함하지 마세요.
                    </p>
                    <label className="lawyer-field mb-4">
                      포트폴리오 파일 (이미지·PDF)
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        disabled={busy || draft.portfolio.length >= 30}
                        onChange={async (event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (file) await upload(file, "portfolio");
                        }}
                      />
                    </label>
                    <Button variant="outline" disabled={busy} onClick={() => void refreshAssets()}>
                      자료 상태 확인
                    </Button>
                    <p className="mt-2 text-sm text-muted-foreground">
                      연결된 자료는 프로필에서 제외하고 저장한 뒤 삭제할 수 있어요.
                    </p>
                    {assets.length > 0 && (
                      <ul className="lawyer-assets" aria-label="업로드 자료 상태">
                        {assets.map((asset) => (
                          <li key={asset.id}>
                            <span>
                              {asset.purpose === "profile_photo"
                                ? "프로필 사진"
                                : "포트폴리오 자료"}{" "}
                              ·{" "}
                              {asset.status === "ready"
                                ? "연결 가능"
                                : asset.status === "failed"
                                  ? "처리 실패 · 파일을 확인하고 다시 선택하세요"
                                  : "처리 대기 또는 진행 중"}
                            </span>
                            <Button
                              variant="outline"
                              disabled={
                                busy ||
                                asset.status !== "ready" ||
                                draft.photoAssetId === asset.id ||
                                draft.portfolio.some((p) => p.assetId === asset.id) ||
                                (asset.purpose !== "profile_photo" && draft.portfolio.length >= 30)
                              }
                              onClick={() => attach(asset)}
                            >
                              프로필에 연결
                            </Button>
                            <Button
                              variant="outline"
                              disabled={
                                busy ||
                                saved?.photoAssetId === asset.id ||
                                draft.photoAssetId === asset.id ||
                                saved?.portfolio.some((p) => p.assetId === asset.id) ||
                                draft.portfolio.some((p) => p.assetId === asset.id)
                              }
                              onClick={() => void removeAsset(asset)}
                            >
                              업로드 자료 삭제
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {draft.portfolio.length === 0 && (
                      <p className="mb-3">등록된 포트폴리오가 없어요.</p>
                    )}
                    {draft.portfolio.map((item, index) => (
                      <div className="lawyer-portfolio-row" key={item.id}>
                        <label className="lawyer-field">
                          활동 제목 {index + 1}
                          <input
                            value={item.title}
                            maxLength={300}
                            required
                            onChange={(e) =>
                              patch(
                                "portfolio",
                                draft.portfolio.map((i) =>
                                  i.id === item.id ? { ...i, title: e.target.value } : i,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="lawyer-field">
                          자료 URL {index + 1}
                          <input
                            type="url"
                            maxLength={2000}
                            value={item.assetId ? "" : (item.url ?? "")}
                            disabled={!!item.assetId}
                            placeholder={
                              item.assetId ? "업로드 자료가 연결되어 있어요" : "https:// (선택)"
                            }
                            onChange={(e) =>
                              patch(
                                "portfolio",
                                draft.portfolio.map((i) =>
                                  i.id === item.id ? { ...i, url: e.target.value || null } : i,
                                ),
                              )
                            }
                          />
                        </label>
                        <Button
                          variant="ghost"
                          aria-label={`포트폴리오 ${index + 1} 삭제`}
                          onClick={() =>
                            patch(
                              "portfolio",
                              draft.portfolio.filter((i) => i.id !== item.id),
                            )
                          }
                        >
                          <X size={18} />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      disabled={draft.portfolio.length >= 30 || busy}
                      onClick={() =>
                        patch("portfolio", [
                          ...draft.portfolio,
                          { id: crypto.randomUUID(), title: "", url: null },
                        ])
                      }
                    >
                      <Plus size={16} />
                      포트폴리오 추가
                    </Button>
                  </CardContent>
                </Card>
                <div className="lawyer-toolbar">
                  <p className="text-sm text-muted-foreground">
                    등록은 자격 확인을 의미하지 않아요.
                  </p>
                  <Button type="submit" disabled={busy || !dirty}>
                    <Save size={16} />
                    {busy ? "저장 중…" : "프로필 저장"}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          <Card>
            <CardHeader>
              <CardTitle>공개 설정</CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                공개하면 사진·소개·분야·사무실·연락처·포트폴리오가 디렉터리에 표시돼요. 비공개로
                전환하면 목록과 상세에서 보이지 않아요.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                공개 여부를 바꾸기 전에 변경 내용을 저장하세요.
              </p>
              <div className="mt-4">
                <Button
                  variant={saved?.published ? "outline" : "default"}
                  disabled={busy || dirty}
                  onClick={() => (saved?.published ? void publish(false) : setConfirmPublish(true))}
                >
                  {saved?.published ? "비공개로 전환" : "프로필 공개"}
                </Button>
              </div>
              {confirmPublish && (
                <div className="lawyer-publication-confirm">
                  <p className="mb-3 text-sm">
                    공개 정보는 누구나 보고 저장할 수 있어요. 비공개로 전환해도 제3자가 보관한
                    사본은 삭제할 수 없어요. <a href="/policies/privacy">개인정보 처리방침 초안</a>
                    에서 공개 범위를 확인하세요.
                  </p>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={publicationConsent}
                      onChange={(e) => setPublicationConsent(e.target.checked)}
                    />
                    내 사진과 연락처를 포함한 작성 정보의 공개에 동의합니다.
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      disabled={busy || !publicationConsent}
                      onClick={() => void publish(true)}
                    >
                      동의하고 공개
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setConfirmPublish(false);
                        setPublicationConsent(false);
                      }}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
