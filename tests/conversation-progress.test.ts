import { expect, test } from "bun:test";
import { observeReportContinuation } from "../src/components/workspace/conversation-progress";

test("confirmation includes the request time and phase/revision updates never renew its window", () => {
  const first = observeReportContinuation(null, true, 100, 2100);
  expect(first).toEqual({ deadline: 30100, pending: true, unconfirmed: false });
  const updated = observeReportContinuation(first, true, 20100, 29999);
  expect(updated?.deadline).toBe(30100);
  expect(updated?.unconfirmed).toBe(false);
  expect(observeReportContinuation(updated, true, 30100, 30100)?.unconfirmed).toBe(true);
});
test("verified completion before the boundary releases waiting without inventing a job", () => {
  const first = observeReportContinuation(null, true, 0, 0);
  expect(observeReportContinuation(first, false, 29000, 29999)).toBeNull();
  expect(observeReportContinuation(null, false, 0, 31000)).toBeNull();
});
test("late success and new pending observations cannot automatically resume an expired send", () => {
  const first = observeReportContinuation(null, true, 0, 0);
  const expired = observeReportContinuation(first, true, 30000, 30000);
  expect(expired?.unconfirmed).toBe(true);
  expect(observeReportContinuation(expired, false, 31000, 31000)).toEqual({
    deadline: 30000,
    pending: false,
    unconfirmed: true,
  });
  expect(observeReportContinuation(expired, true, 50000, 50000)?.deadline).toBe(30000);
});
test("only an explicit confirmation reset can start a new window or release a paused send", () => {
  expect(observeReportContinuation(null, true, 50000, 50000)).toEqual({
    deadline: 80000,
    pending: true,
    unconfirmed: false,
  });
  expect(observeReportContinuation(null, false, 50000, 50000)).toBeNull();
});
