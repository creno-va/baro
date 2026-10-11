import { expect, test } from "bun:test";
import { timelineDateInput, timelineEventLength } from "../src/components/workspace/timeline-draft";

test("precision changes preserve known date parts and clear unknown finer parts", () => {
  expect(timelineDateInput("2026-10-06", "month", "day")).toBe("2026-10");
  expect(timelineDateInput("2026-10", "day", "month")).toBe("");
  expect(timelineDateInput("2026-10-01", "day", "month")).toBe("");
  expect(timelineDateInput("2026", "month", "year")).toBe("");
  expect(timelineDateInput("2026-01-01", "month", "year")).toBe("");
  expect(timelineDateInput("2026-10-06", "year", "day")).toBe("2026");
  expect(timelineDateInput("2026-10-06", "day", "day")).toBe("2026-10-06");
  expect(timelineDateInput("2026-10-06", "unknown", "day")).toBe("");
});

test("timeline uses the contract's combined 2000 code point event budget", () => {
  expect(timelineEventLength({ title: "가".repeat(400), detail: "" })).toBe(400);
  expect(timelineEventLength({ title: "😀".repeat(1000), detail: "😀".repeat(999) })).toBe(2000);
  expect(timelineEventLength({ title: "가".repeat(2000), detail: "추가" })).toBe(2003);
});
