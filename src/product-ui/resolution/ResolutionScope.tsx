import { Button } from "../Button";
import { checkboxClass, checkClass } from "./ResolutionComponents";
import type { ResolutionController } from "./useResolutionController";

export function ResolutionScope({ controller: c }: { controller: ResolutionController }) {
  return (
    <fieldset
      data-product-resolution-scope=""
      disabled={c.busy || c.blocked || c.contentDirty}
      className="min-w-0 space-y-2 rounded-2xl border border-[var(--pui-border)] px-4 pb-4 sm:px-5 sm:pb-5"
    >
      <legend className="px-1 text-sm font-medium">사용할 자료와 가림 범위</legend>
      {c.files.length ? (
        c.files.map((file, index) => (
          <label key={file.id} className={checkClass}>
            <input
              type="checkbox"
              className={checkboxClass}
              checked={c.ids.includes(file.id)}
              onChange={(event) => c.changeFile(file.id, event.target.checked)}
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {c.mask ? `선택 자료 ${index + 1}` : file.name}
            </span>
          </label>
        ))
      ) : (
        <p className="py-2 text-sm leading-7 text-[var(--pui-muted)]">
          선택한 자료가 없어요. 사건 사실만 사용할 수 있어요.
        </p>
      )}
      <label className={checkClass}>
        <input
          type="checkbox"
          className={checkboxClass}
          checked={c.mask}
          disabled={!!c.report?.maskIdentifiers}
          onChange={(event) => c.changeMask(event.target.checked)}
        />
        식별정보 가리기
      </label>
      <p className="text-xs leading-6 text-[var(--pui-muted)]">
        가림 후에도 이름·주소·내용을 직접 확인해 주세요. 원본은 첨부하거나 전송하지 않아요.
      </p>
      {c.contentDirty && (
        <p className="text-xs leading-6 text-[var(--pui-muted)]">
          수정한 초안을 먼저 저장한 뒤 자료 범위를 바꿔 주세요.
        </p>
      )}
      {c.scopeDirty && (
        <Button variant="secondary" onClick={c.applyScope}>
          범위 적용
        </Button>
      )}
    </fieldset>
  );
}
