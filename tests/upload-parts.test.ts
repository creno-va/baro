import { expect, test } from "bun:test";
import { uploadParts } from "../packages/api-client/src/upload-parts";

test("part zero precedes bounded overlapping writes and the manifest keeps ordinal order", async () => {
  const first = Promise.withResolvers<void>();
  const finish = Array.from({ length: 7 }, () => Promise.withResolvers<void>());
  const started: number[] = [];
  let active = 0,
    maximum = 0;
  const task = uploadParts(7, 3, async (index) => {
    started.push(index);
    active++;
    maximum = Math.max(maximum, active);
    if (index === 0) await first.promise;
    else await finish[index]?.promise;
    active--;
    return index;
  });
  await Promise.resolve();
  expect(started).toEqual([0]);
  first.resolve();
  await Bun.sleep(1);
  expect(started).toEqual([0, 1, 2, 3]);
  finish[3]?.resolve();
  await Bun.sleep(1);
  expect(started).toEqual([0, 1, 2, 3, 4]);
  for (const part of finish) part.resolve();
  expect(await task).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(maximum).toBe(3);
});

test("a failed part drains in-flight writes before cleanup and does not start remaining parts", async () => {
  const slow = Promise.withResolvers<void>();
  const started: number[] = [];
  let rejected = false;
  const failure = new Error("SYNTHETIC_PART_LOST");
  const task = uploadParts(9, 3, async (index) => {
    started.push(index);
    if (index === 1) throw failure;
    if (index > 1) await slow.promise;
    return index;
  }).catch((error) => {
    rejected = true;
    return error;
  });
  await Bun.sleep(1);
  expect(rejected).toBe(false);
  expect(started).toEqual([0, 1, 2, 3]);
  slow.resolve();
  expect(await task).toBe(failure);
  expect(started).toEqual([0, 1, 2, 3]);
});
