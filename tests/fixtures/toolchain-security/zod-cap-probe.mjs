import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

try {
  const directory = process.argv[2];
  const require = createRequire(resolve(directory, "package.json"));
  const versions = [
    require("./index.cjs"),
    await import(pathToFileURL(resolve(directory, "index.js")).href),
  ];
  const results = [];
  for (const { z } of versions) {
    const oversized = [];
    for (const async of [false, true])
      for (const kind of ["array-max", "array-length", "set-max"]) {
        let visits = 0;
        const element = z.preprocess((value) => {
          visits++;
          return value;
        }, z.number());
        const schema =
          kind === "array-max"
            ? z.array(element).max(1)
            : kind === "array-length"
              ? z.array(element).length(1)
              : z.set(element).max(1);
        const input =
          kind === "set-max"
            ? new Set(Array.from({ length: 512 }, (_, index) => `synthetic-${index}`))
            : Array(512).fill("synthetic-invalid");
        const output = async ? await schema.safeParseAsync(input) : schema.safeParse(input);
        oversized.push({
          kind,
          async,
          rejected: !output.success,
          visits,
          issues: output.success ? 0 : output.error.issues.length,
          code: output.success ? null : output.error.issues[0].code,
        });
      }
    const compatibility = [];
    for (const async of [false, true]) {
      let visits = 0;
      const element = z.preprocess((value) => {
        visits++;
        return value;
      }, z.number());
      for (const [schema, input] of [
        [z.array(element).max(2), [1, 2]],
        [z.array(element).length(2), [1, 2]],
        [z.set(element).max(2), new Set([1, 2])],
        [z.array(element).length(2), [1]],
        [z.array(element).max(2), ["synthetic-invalid"]],
        [z.array(element), Array(16).fill("synthetic-invalid")],
        [z.array(element).max(1).catch([0]), [1, 2]],
      ]) {
        visits = 0;
        const output = async ? await schema.safeParseAsync(input) : schema.safeParse(input);
        compatibility.push({
          async,
          accepted: output.success,
          output: output.success
            ? output.data instanceof Set
              ? [...output.data]
              : output.data
            : null,
          issues: output.success
            ? []
            : output.error.issues.map((issue) => ({ code: issue.code, path: issue.path })),
          visits,
        });
      }
    }
    results.push({ oversized, compatibility });
  }
  console.log(
    JSON.stringify({
      kind: "bounded-v3-array-set-probe",
      results,
      networkStarted: false,
      providerCalled: false,
    }),
  );
} catch {
  console.log(JSON.stringify({ kind: "bounded-v3-array-set-probe-failed" }));
  process.exitCode = 1;
}
