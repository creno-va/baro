import { expect, test } from "bun:test";
import { elapsedLabel, fileFailureLabel } from "../src/components/workspace/processing-progress";

test("elapsed labels retain the supplied timestamp after reload and never invent a start", () => {
  const start = "2026-10-15T00:00:00.000Z";
  expect(elapsedLabel(start, Date.parse(start) + 65_000)).toBe("1분 5초");
  expect(elapsedLabel(start, Date.parse(start) + 3_665_000)).toBe("1시간 1분");
  expect(elapsedLabel(start, Date.parse(start) + 90_065_000)).toBe("1일 1시간");
  expect(elapsedLabel(start, Date.parse(start) - 1000)).toBeNull();
  expect(elapsedLabel("invalid", Date.now())).toBeNull();
  expect(elapsedLabel(start, Number.NaN)).toBeNull();
});

test("failure guidance distinguishes expired/rejected originals from retryable processing failures", () => {
  expect(fileFailureLabel({ failure: "UPLOAD_EXPIRED" })).toContain("같은 원본을 다시 추가");
  expect(fileFailureLabel({ failure: "FILE_REJECTED" })).toContain("지원하는 형식");
  expect(fileFailureLabel({ failure: "JOB_TIMEOUT", canRetry: true })).toContain("저장된 원본으로");
  expect(fileFailureLabel({ failure: "FILE_PROCESSING_FAILED", canRetry: true })).not.toContain(
    "형식",
  );
  expect(fileFailureLabel({ failure: "INTERNAL_ERROR", canRetry: false })).not.toContain(
    "다시 시도",
  );
});
