import { useEffect, useState } from "react";
import { type V2PublicLawyer, v2PublicLawyerSchema } from "../../contracts/v2";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { PageHeader } from "../ui/page-header";
import { StatePanel } from "../ui/state-panel";
import { FIELD_LABELS } from "./labels";
import { contactLinks, directionLinks } from "./links";
export function Profile({ id, preview = false }: { id: string; preview?: boolean }) {
  const [lawyer, setLawyer] = useState<V2PublicLawyer | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: An explicit retry must refetch the current profile.
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLawyer(null);
    void (async () => {
      try {
        const response = await fetch(`/api/v2/lawyers/${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "공개된 프로필을 찾을 수 없어요."
              : "프로필을 불러오지 못했어요.",
          );
        const result = v2PublicLawyerSchema.safeParse(await response.json());
        if (!result.success) throw new Error("프로필을 불러오지 못했어요.");
        if (!controller.signal.aborted) setLawyer(result.data);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "프로필을 불러오지 못했어요.");
      }
    })();
    return () => controller.abort();
  }, [id, reload]);
  return (
    <div className="space-y-6">
      <a className="ui-button ui-button--ghost" href="/lawyers">
        변호사 목록으로
      </a>
      {preview && (
        <p className="rounded-lg bg-secondary p-4 text-secondary-foreground">
          Preview 환경입니다. 합성 프로필은 테스트용이며 실제 변호사가 아닙니다.
        </p>
      )}
      {error ? (
        <StatePanel
          variant="error"
          title={error}
          action={<Button onClick={() => setReload(reload + 1)}>다시 불러오기</Button>}
        />
      ) : !lawyer ? (
        <StatePanel variant="loading" title="프로필을 불러오고 있어요." />
      ) : (
        <>
          <PageHeader title={lawyer.content.name} description={lawyer.content.office.name} />
          <img
            className="h-36 w-36 rounded-xl object-cover"
            src={`/api/v2/lawyers/${encodeURIComponent(id)}/assets/${encodeURIComponent(lawyer.content.photoAssetId)}`}
            alt={`${lawyer.content.name} 프로필 사진`}
            width={144}
            height={144}
          />
          <p className="text-sm text-muted-foreground">
            본인·변호사 자격·사무실을 수동 확인했습니다. 확인일{" "}
            {lawyer.verification.verifiedAt.slice(0, 10)}. 확인 표시는 능력이나 성과를 보증하지
            않습니다.
          </p>
          <Card>
            <CardHeader>
              <CardTitle>소개와 분야</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap break-words">{lawyer.content.introduction}</p>
              <p className="mt-4">
                {lawyer.content.legalFields.map((field) => FIELD_LABELS[field]).join(" · ")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>직접 연락</CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                상담 여부와 조건은 변호사에게 직접 확인해 주세요. 사건이나 자료는 자동으로 전송되지
                않습니다.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {contactLinks(lawyer.content.contact).map((link) => (
                  <a
                    className="ui-button ui-button--outline"
                    key={link.label}
                    href={link.href}
                    target={link.href.startsWith("https:") ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>사무실과 길찾기</CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                {lawyer.content.office.address} {lawyer.content.office.addressDetail}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                지도에서 목적지를 확인하고 출발지를 선택해 길찾기를 이어가세요.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {directionLinks(lawyer.content.office).map((link) => (
                  <a
                    className="ui-button ui-button--outline"
                    href={link.href}
                    key={link.label}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>포트폴리오</CardTitle>
            </CardHeader>
            <CardContent>
              {lawyer.content.portfolio.length === 0 ? (
                <p>등록된 포트폴리오가 없어요.</p>
              ) : (
                lawyer.content.portfolio.map((item) => (
                  <div className="mb-5" key={item.id}>
                    <h3>{item.title}</h3>
                    {item.kind === "text" ? (
                      <p className="whitespace-pre-wrap break-words">{item.text}</p>
                    ) : (
                      <a
                        className="ui-button ui-button--outline"
                        href={`/api/v2/lawyers/${encodeURIComponent(id)}/assets/${encodeURIComponent(item.assetId)}`}
                      >
                        승인 자료 보기
                      </a>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
