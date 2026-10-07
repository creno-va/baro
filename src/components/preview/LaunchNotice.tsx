import { ArrowRight, Check, Monitor, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { PUBLIC_PREVIEW } from "../../client/public-preview";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

export function LaunchNotice() {
  const [open, setOpen] = useState(PUBLIC_PREVIEW);

  useEffect(() => {
    const showOnReturn = (event: PageTransitionEvent) => {
      if (event.persisted && PUBLIC_PREVIEW) setOpen(true);
    };
    window.addEventListener("pageshow", showOnReturn);
    return () => window.removeEventListener("pageshow", showOnReturn);
  }, []);

  return (
    <div className="launch-notice">
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="BARO를 먼저 만나보세요"
        description="복잡한 일도, 하나씩. 지금 가능한 기능부터 체험해 보세요."
      >
        <div className="launch-notice__experience">
          <span className="launch-notice__check" aria-hidden="true">
            <Check size={20} strokeWidth={2.5} />
          </span>
          <div>
            <span className="launch-notice__eyebrow">지금 체험할 수 있어요</span>
            <h3>사건 작성 · 후속 질문</h3>
            <p>어떤 일이 있었는지 적고, 상황에 맞는 질문에 답하며 이야기를 정리해 보세요.</p>
          </div>
        </div>

        <div className="launch-notice__upcoming">
          <span className="launch-notice__status">준비 중</span>
          <p>사건 상세 기능과 변호사 찾기는 준비 중이에요. 정식 출시와 함께 이용할 수 있어요.</p>
        </div>

        <section className="launch-notice__schedule" aria-label="출시 예정 일정">
          <div className="launch-notice__release">
            <span className="launch-notice__release-label">
              <Monitor size={17} aria-hidden="true" /> 전체 웹 출시 예정
            </span>
            <time dateTime="2026-11-01">2026.11.01</time>
          </div>
          <div className="launch-notice__release">
            <span className="launch-notice__release-label">
              <Smartphone size={17} aria-hidden="true" /> 모바일 앱 출시 예정
            </span>
            <time dateTime="2026-11-10">2026.11.10</time>
          </div>
        </section>

        <Button className="launch-notice__start" onClick={() => setOpen(false)}>
          체험 시작하기 <ArrowRight size={18} aria-hidden="true" />
        </Button>
      </Dialog>
    </div>
  );
}
