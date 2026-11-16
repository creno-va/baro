import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { GlobalProductTheme } from "../GlobalTheme";
import { type ExperienceController, useExperienceController } from "./useExperienceController";

export function ProductExperience() {
  const controller = useExperienceController();
  return (
    <GlobalProductTheme className="contents">
      <ProductExperienceView controller={controller} />
    </GlobalProductTheme>
  );
}

export function ProductExperienceView({ controller: c }: { controller: ExperienceController }) {
  return (
    <Dialog
      open={Boolean(c.pending)}
      title="작성한 내용을 확인해 주세요"
      description={c.pending?.message}
      onClose={c.cancel}
      initialFocus={c.cancelButton}
      returnFocusRef={c.returnFocus}
      preserveMounted
      className="[overflow-wrap:anywhere]"
    >
      <div
        data-product-experience-actions=""
        className="flex flex-col gap-2 sm:flex-row sm:justify-end"
      >
        <Button variant="secondary" ref={c.cancelButton} autoFocus onClick={c.cancel}>
          계속 작성하기
        </Button>
        <Button variant="danger" onClick={c.discard}>
          변경 버리기
        </Button>
      </div>
    </Dialog>
  );
}
