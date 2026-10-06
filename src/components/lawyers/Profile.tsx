import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type LawyerView, lawyerErrorMessage } from "../../client/api/lawyers";
import type { V2Office } from "../../contracts/v2";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { PageHeader } from "../ui/page-header";
import { StatePanel } from "../ui/state-panel";
import { ApiModeNotice } from "./ApiModeNotice";
import { FIELD_LABELS } from "./labels";
import { contactLinks, directionLinks } from "./links";
export function Profile({ id, preview = false }: { id: string; preview?: boolean }) {
  const [lawyer, setLawyer] = useState<LawyerView | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: An explicit retry must refetch the current profile.
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLawyer(null);
    void (async () => {
      try {
        const result = await api.lawyers.get(id);
        if (!controller.signal.aborted) setLawyer(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(lawyerErrorMessage(cause));
      }
    })();
    return () => controller.abort();
  }, [id, reload]);
  return (
    <div className="space-y-6">
      <a className="ui-button ui-button--ghost" href="/lawyers">
        변호사 목록으로
      </a>
      <ApiModeNotice preview={preview} />
      {error ? (
        <StatePanel
          variant="error"
          title={error}
          action={<Button onClick={() => setReload(reload + 1)}>다시 불러오기</Button>}
        />
      ) : !lawyer ? (
        <StatePanel variant="loading" title="프로필을 불러오고 있어요." />
      ) : (
        <ProfileContent lawyer={lawyer} />
      )}
    </div>
  );
}
export function ProfileContent({ lawyer }: { lawyer: LawyerView }) {
  return (
    <div className="space-y-6 lawyer-profile">
      <PageHeader title={lawyer.name || "프로필 미리보기"} description={lawyer.officeName} />
      {lawyer.photoUrl ? (
        <img
          className="h-36 w-36 rounded-xl object-cover"
          src={lawyer.photoUrl}
          alt={`${lawyer.name} 프로필 사진`}
          width={144}
          height={144}
        />
      ) : (
        <UserRound className="lawyer-avatar" size={100} aria-hidden="true" />
      )}
      <p className="text-sm text-muted-foreground">
        {lawyer.verificationStatus === "verified"
          ? "본인·변호사 자격·사무실을 수동 확인했습니다. 확인 표시는 능력이나 성과를 보증하지 않습니다."
          : "본인 작성 정보입니다. 역할 선택과 프로필 등록은 변호사 자격 확인을 의미하지 않습니다."}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>소개와 분야</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap break-words">
            {lawyer.introduction || "소개를 작성해 주세요."}
          </p>
          <p className="mt-4">
            {lawyer.practiceAreas
              .map((field) => FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field)
              .join(" · ")}
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
            {contactLinks({
              phone: lawyer.phone || null,
              email: lawyer.email || null,
              consultationUrl: lawyer.website || null,
            }).map((link) => (
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
          <p>{lawyer.address}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            지도에서 목적지를 확인하고 출발지를 선택해 길찾기를 이어가세요.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {directionLinks({
              name: lawyer.officeName,
              country: "KR",
              postalCode: null,
              address: lawyer.address,
              addressDetail: null,
              region: lawyer.region as V2Office["region"],
            }).map((link) => (
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
          {lawyer.portfolio.length === 0 ? (
            <p>등록된 포트폴리오가 없어요.</p>
          ) : (
            lawyer.portfolio.map((item) => (
              <div className="mb-5" key={item.id}>
                <h3>{item.title}</h3>
                {item.url === null ? (
                  <p className="whitespace-pre-wrap break-words">
                    {"text" in item && typeof item.text === "string" ? item.text : "등록된 활동"}
                  </p>
                ) : (
                  <a
                    className="ui-button ui-button--outline"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    포트폴리오 보기
                  </a>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
