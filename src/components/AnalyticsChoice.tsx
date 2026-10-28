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
    [decided, setDecided] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    configureAnalytics({ environment, release });
    setOpted(analyticsOptedIn());
    setDecided(analyticsOptedIn());
    setReady(true);
  }, [environment, release]);
  return (
    <aside className="case-panel" aria-label="선택 사용 지표">
      <h2>사용 기록 남기기 (선택)</h2>
      <p>
        동의하면 어떤 화면을 열었는지, 저장이나 결과 보기 버튼을 눌렀는지만 이 탭에 기록해요.
        적어주신 사건 내용이나 계정을 알아볼 수 있는 정보는 기록하지 않고, 외부로 보내지도 않아요.
        탭을 닫거나 동의를 취소하면 지워져요. 동의하지 않아도 모든 기능을 이용할 수 있어요.
      </p>
      {!decided ? (
        <>
          <button
            type="button"
            className="ui-button ui-button--outline"
            disabled={!ready}
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
            className="ui-button ui-button--ghost"
            disabled={!ready}
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
          <p className="analytics-choice-status" data-enabled={opted} aria-live="polite">
            {opted ? "✓ 선택 지표 동의됨" : "선택 지표 수집 안 함"}
          </p>
          <button
            type="button"
            className="ui-button ui-button--outline"
            aria-pressed={opted}
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
