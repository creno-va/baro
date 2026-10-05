import { useEffect, useState } from "react";
import type { AnalyticsEvent } from "../contracts/analytics";
import {
  analyticsOptedIn,
  analyticsOptIn,
  analyticsOptOut,
  configureAnalytics,
} from "../server/modules/analytics/browser";
export function AnalyticsChoice({
  environment,
  release,
}: {
  environment: AnalyticsEvent["environment"];
  release: string;
}) {
  const [opted, setOpted] = useState(false),
    [decided, setDecided] = useState(false);
  useEffect(() => {
    configureAnalytics({ environment, release });
    setOpted(analyticsOptedIn());
    setDecided(analyticsOptedIn());
  }, [environment, release]);
  return (
    <aside className="case-panel" aria-label="선택 사용 지표">
      <h2>선택 사용 지표</h2>
      <p>
        동의하면 이 브라우저 세션에서 화면·제출·결과 열람 같은 비민감 이벤트를 기록해요. 사건 내용과
        인증 ID는 기록하지 않으며 외부로 전송하지 않아요. 탭을 닫거나 동의를 철회하면 지워져요.
        거부해도 모든 사건 기능을 사용할 수 있어요.
      </p>
      {!decided ? (
        <>
          <button
            type="button"
            onClick={() => {
              analyticsOptIn();
              setOpted(true);
              setDecided(true);
            }}
          >
            사용 지표 동의
          </button>
          <button
            type="button"
            onClick={() => {
              analyticsOptOut();
              setDecided(true);
            }}
          >
            사용 지표 거부
          </button>
        </>
      ) : (
        <>
          <p aria-live="polite">{opted ? "선택 지표 동의됨" : "선택 지표 수집 안 함"}</p>
          <button
            type="button"
            onClick={() => {
              if (opted) analyticsOptOut();
              else analyticsOptIn();
              setOpted(!opted);
            }}
          >
            {opted ? "동의 철회 및 지표 삭제" : "사용 지표 동의"}
          </button>
        </>
      )}
    </aside>
  );
}
