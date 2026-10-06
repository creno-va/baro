import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { lawyerAssets } from "../../client/api/lawyers";

export function AssetPhoto({
  profileId,
  assetId,
  fallback,
  alt,
  size = 144,
  privateRead = false,
}: {
  profileId: string;
  assetId?: string | null | undefined;
  fallback: string | null;
  alt: string;
  size?: number;
  privateRead?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (assetId)
      void lawyerAssets
        .blob(profileId, assetId, privateRead)
        .then(async (blob) => {
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("Photo unavailable"));
            reader.readAsDataURL(blob);
          });
          if (alive) setUrl(data);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    return () => {
      alive = false;
    };
  }, [assetId, profileId, privateRead]);
  const src = assetId ? url : fallback;
  return src ? (
    <img className="lawyer-photo" src={src} alt={alt} width={size} height={size} />
  ) : (
    <div>
      <UserRound className="lawyer-avatar" size={size} aria-hidden="true" />
      {failed && <p className="text-sm">사진을 불러오지 못했어요.</p>}
    </div>
  );
}
export async function downloadLawyerAsset(
  profileId: string,
  assetId: string,
  privateRead = false,
  title = "portfolio",
) {
  const blob = await lawyerAssets.blob(profileId, assetId, privateRead);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const filename = title.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 100) || "portfolio";
  link.download = `${filename}.${blob.type === "application/pdf" ? "pdf" : blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
