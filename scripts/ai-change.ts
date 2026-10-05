// Metadata only. Eval is mandatory for every candidate, including metadata/docs-only changes.
const base = process.env.EVAL_BASE_SHA;
let files: string[] = [];
if (base) {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("INVALID_EVAL_BASE");
  const child = Bun.spawn(["git", "diff", "--name-only", base, "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  files = (await new Response(child.stdout).text()).trim().split(/\r?\n/);
  if (await child.exited) throw new Error("EVAL_DIFF_UNAVAILABLE");
}
const aiChanged =
  !base ||
  files.some((file) =>
    /^(src\/(?:contracts|server\/modules\/(?:llm-gateway|case-structure|legal-retrieval))|tests\/(?:evals|fixtures\/evals)|scripts\/eval-)/.test(
      file,
    ),
  );
console.log(
  `AI-sensitive change: ${aiChanged}; deterministic eval required; live candidate eval belongs to #27/#19`,
);

export {};
