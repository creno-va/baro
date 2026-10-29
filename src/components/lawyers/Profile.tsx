import { ArrowLeft, Mail, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { api, LawyerApiError, type LawyerView, lawyerErrorMessage } from "../../client/api/lawyers";
import type { V2Office } from "../../contracts/v2";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Dialog } from "../ui/dialog";
import { LoadingContent } from "../ui/loading";
import { StatePanel } from "../ui/state-panel";
import { AssetPhoto, downloadLawyerAsset } from "./AssetPhoto";
import { FIELD_LABELS } from "./labels";
import { contactLinks, directionLinks } from "./links";
export function Profile({
  id,
  directoryHref = "/lawyers",
}: {
  id: string;
  directoryHref?: string;
}) {
  const [lawyer, setLawyer] = useState<LawyerView | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [reload, setReload] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: An explicit retry must refetch the current profile.
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setMissing(false);
    setLawyer(null);
    void (async () => {
      try {
        const result = await api.lawyers.get(id);
        if (!controller.signal.aborted) setLawyer(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setMissing(cause instanceof LawyerApiError && cause.code === "NOT_FOUND");
          setError(lawyerErrorMessage(cause));
        }
      }
    })();
    return () => controller.abort();
  }, [id, reload]);
  return (
    <div className="lawyer-public-detail space-y-6">
      <a className="lawyer-profile-back" href={directoryHref}>
        <ArrowLeft size={18} aria-hidden="true" />
        변호사 목록으로
      </a>
      {error ? (
        <StatePanel
          variant="error"
          title={missing ? "현재 공개된 프로필이 아니에요." : error}
          description={
            missing
              ? "비공개로 전환했거나 삭제된 프로필일 수 있어요. 목록에서 다른 공개 프로필을 확인하세요."
              : "연결 상태를 확인한 뒤 다시 불러와 주세요."
          }
          action={<Button onClick={() => setReload(reload + 1)}>다시 불러오기</Button>}
        />
      ) : !lawyer ? (
        <LoadingContent layout="detail" title="프로필을 불러오고 있어요." />
      ) : (
        <ProfileContent lawyer={lawyer} />
      )}
    </div>
  );
}
export function ProfileContent({
  lawyer,
  privateRead = false,
  canDeliverDownload,
}: {
  lawyer: LawyerView;
  privateRead?: boolean;
  canDeliverDownload?: () => Promise<boolean>;
}) {
  const [assetError, setAssetError] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const contacts = contactLinks({
    phone: lawyer.phone || null,
    email: lawyer.email || null,
    consultationUrl: lawyer.website || null,
  });
  return (
    <div className="space-y-6 lawyer-profile">
      <header className="lawyer-profile-hero">
        <AssetPhoto
          profileId={lawyer.id}
          assetId={lawyer.photoAssetId}
          fallback={lawyer.photoUrl}
          alt={`${lawyer.name} 프로필 사진`}
          privateRead={privateRead}
        />
        <div>
          <h1>{lawyer.name || "프로필 미리보기"}</h1>
          <p>{lawyer.officeName}</p>
          <p className="lawyer-profile-fields">
            {lawyer.practiceAreas
              .map((field) => FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field)
              .join(" · ")}
          </p>
        </div>
        <Button onClick={() => setContactOpen(true)} aria-haspopup="dialog">
          연락처 보기
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">
        본인 작성 정보입니다. 역할 선택과 프로필 등록은 변호사 자격 확인을 의미하지 않습니다.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>소개</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap break-words">
            {lawyer.introduction || "소개를 작성해 주세요."}
          </p>
        </CardContent>
      </Card>
      <Dialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        title="연락처"
        description={[lawyer.name, lawyer.officeName].filter(Boolean).join(" · ")}
      >
        <dl className="lawyer-contact-list">
          {[
            {
              label: "전화번호",
              value: lawyer.phone,
              href: contacts.find((link) => link.label === "전화")?.href,
              Icon: Phone,
            },
            {
              label: "이메일",
              value: lawyer.email,
              href: contacts.find((link) => link.label === "이메일")?.href,
              Icon: Mail,
            },
          ].map(({ label, value, href, Icon }) => (
            <div key={label}>
              <dt>
                <Icon size={18} aria-hidden="true" />
                {label}
              </dt>
              <dd>
                {value && href ? (
                  <a href={href} referrerPolicy="no-referrer">
                    {value}
                  </a>
                ) : (
                  <span>
                    {label === "전화번호" ? "등록된 전화번호가 없어요." : "등록된 이메일이 없어요."}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {contacts
          .filter((link) => link.label === "외부 상담 페이지")
          .map((link) => (
            <a
              className="ui-button ui-button--outline"
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              {link.label}
            </a>
          ))}
        <p className="lawyer-contact-note">
          상담 여부와 조건은 직접 확인해 주세요. 상담·위임 비용은 별도이며, 사건이나 자료는 자동으로
          전송되지 않아요.
        </p>
      </Dialog>
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
      {assetError && <StatePanel variant="error" title={assetError} />}
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
                {(item.text || !item.url) && (
                  <p className="whitespace-pre-wrap break-words">{item.text || "등록된 활동"}</p>
                )}
                {item.url && (
                  <a
                    className="ui-button ui-button--outline"
                    href={item.url}
                    onClick={
                      item.assetId
                        ? (event) => {
                            event.preventDefault();
                            setAssetError("");
                            void downloadLawyerAsset(
                              lawyer.id,
                              item.assetId as string,
                              privateRead,
                              item.title,
                              canDeliverDownload,
                            ).catch((cause) => setAssetError(lawyerErrorMessage(cause)));
                          }
                        : undefined
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {item.assetId ? `${item.title} 자료 다운로드` : `${item.title} 포트폴리오 보기`}
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
