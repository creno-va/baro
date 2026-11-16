import { useEffect, useState } from "react";

type Status = "checking" | "online" | "offline";

export function FoundationStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health/live", { signal: controller.signal })
      .then((response) => {
        setStatus(response.ok ? "online" : "offline");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("offline");
      });

    return () => controller.abort();
  }, []);

  const label = {
    checking: "기반 상태 확인 중",
    online: "기반 서비스 정상",
    offline: "기반 서비스 확인 필요",
  }[status];

  return (
    <output className="status" data-status={status} aria-live="polite">
      <span aria-hidden="true" className="status__dot" />
      {label}
    </output>
  );
}
