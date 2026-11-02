import { expect, test } from "bun:test";
import {
  verifyFullValidationJobs,
  verifyFullValidationJoin,
  verifyFullValidationSections,
} from "../scripts/full-validation-receipt";

import { fixtureItem, joinedFullFixture } from "./helpers/full-validation-receipt";

test("the receipt requires exactly three successful needs results", () => {
  const success = {
    core: { result: "success" },
    browser: { result: "success" },
    native: { result: "success" },
  };
  expect(verifyFullValidationSections(JSON.stringify(success))).toEqual([
    "browser",
    "core",
    "native",
  ]);
  for (const value of [
    undefined,
    "invalid",
    "null",
    "[]",
    "{}",
    JSON.stringify({ ...success, extra: { result: "success" } }),
    JSON.stringify({ core: success.core, browser: success.browser }),
    ...["failure", "cancelled", "skipped", "timed_out", "", null, true].map((result) =>
      JSON.stringify({ ...success, native: { result } }),
    ),
  ])
    expect(() => verifyFullValidationSections(value)).toThrow(
      "FULL_VALIDATION_SECTIONS_INCOMPLETE",
    );
});

test("all completed section jobs must belong to the same run, attempt and dispatcher", () => {
  const f = joinedFullFixture();
  expect(() => verifyFullValidationJobs(f.run, f.jobs)).not.toThrow();
  for (const role of [0, 1, 2]) {
    const mutations: ((f: ReturnType<typeof joinedFullFixture>) => void)[] = [
      (f) => {
        f.jobs.jobs.splice(role, 1);
        f.jobs.total_count--;
      },
      (f) => {
        f.jobs.jobs.push(structuredClone(fixtureItem(f.jobs.jobs, role)));
        f.jobs.total_count++;
      },
      (f) => {
        fixtureItem(f.jobs.jobs, role).run_id++;
      },
      (f) => {
        fixtureItem(f.jobs.jobs, role).run_attempt--;
      },
      (f) => {
        fixtureItem(f.jobs.jobs, role).head_sha = "e".repeat(40);
      },
      (f) => {
        fixtureItem(f.jobs.jobs, role).steps.shift();
      },
      ...["failure", "skipped", "cancelled", "timed_out"].flatMap((result) => [
        (f: ReturnType<typeof joinedFullFixture>) => {
          fixtureItem(f.jobs.jobs, role).conclusion = result;
        },
        (f: ReturnType<typeof joinedFullFixture>) => {
          fixtureItem(fixtureItem(f.jobs.jobs, role).steps, 1).conclusion = result;
        },
      ]),
    ];
    for (const mutate of mutations) {
      const broken = joinedFullFixture();
      mutate(broken);
      expect(() => verifyFullValidationJobs(broken.run, broken.jobs)).toThrow();
    }
  }
  const incomplete = joinedFullFixture();
  incomplete.jobs.total_count++;
  expect(() => verifyFullValidationJobs(incomplete.run, incomplete.jobs)).toThrow();
});

test("only the completed join verifier requires a successful same-attempt producer", () => {
  const f = joinedFullFixture();
  expect(() => verifyFullValidationJoin(f.run, f.jobs)).not.toThrow();
  fixtureItem(f.jobs.jobs, 3).conclusion = "in_progress";
  expect(() => verifyFullValidationJobs(f.run, f.jobs)).not.toThrow();
  expect(() => verifyFullValidationJoin(f.run, f.jobs)).toThrow("FULL_VALIDATION_JOIN_INCOMPLETE");
  for (const result of ["failure", "skipped", "cancelled", "timed_out"]) {
    for (const index of [0, 1, 2]) {
      const broken = joinedFullFixture();
      fixtureItem(fixtureItem(broken.jobs.jobs, 3).steps, index).conclusion = result;
      expect(() => verifyFullValidationJoin(broken.run, broken.jobs)).toThrow();
    }
  }
  const duplicate = joinedFullFixture();
  duplicate.jobs.jobs.push(structuredClone(fixtureItem(duplicate.jobs.jobs, 3)));
  duplicate.jobs.total_count++;
  expect(() => verifyFullValidationJoin(duplicate.run, duplicate.jobs)).toThrow();
});
