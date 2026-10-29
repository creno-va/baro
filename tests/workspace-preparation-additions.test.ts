import { expect, test } from "bun:test";
import type { V2Action, V2TimelineEntry } from "../src/contracts/v2";
import { newPreparationEntries } from "../src/server/modules/workspace/preparation-additions";

const action = (id: string): V2Action => ({
  id,
  revision: 1,
  kind: "organize_materials",
  title: "대화 기록 정리",
  instructions: "약속한 날짜가 나온 부분을 정리해 주세요.",
  caution: "원본을 보관해 주세요.",
  status: "todo",
  factIds: [],
  references: [],
});
const event = (id: string): V2TimelineEntry => ({
  id,
  revision: 1,
  date: "2026-10-01",
  datePrecision: "day",
  event: "반환 날짜를 약속했다고 진술함",
  certainty: "reported",
  references: [],
  factIds: [],
  userEdited: false,
});

test("refresh does not recreate completed actions or manually edited events under new IDs", () => {
  const savedAction = { ...action("saved-action"), status: "done" as const };
  const savedEvent = { ...event("saved-event"), userEdited: true };
  const result = newPreparationEntries(
    [action("generated-action")],
    [event("generated-event")],
    [savedAction],
    [savedEvent],
  );
  expect(result).toEqual({ actions: [], timeline: [] });
  expect(savedAction.status).toBe("done");
  expect(savedEvent.userEdited).toBe(true);
});

test("refresh keeps distinct new information and rejects duplicate additions within one response", () => {
  const newAction = { ...action("new-action"), title: "이체확인증 보관" };
  const newEvent = { ...event("new-event"), date: "2026-10-02" };
  const result = newPreparationEntries(
    [
      action("duplicate"),
      newAction,
      { ...newAction, id: "duplicate-new", title: " 이체확인증  보관 " },
    ],
    [event("duplicate-event"), newEvent, { ...newEvent, id: "duplicate-new-event" }],
    [action("saved")],
    [event("saved")],
  );
  expect(result.actions.map((a) => a.id)).toEqual(["new-action"]);
  expect(result.timeline.map((t) => t.id)).toEqual(["new-event"]);
});
