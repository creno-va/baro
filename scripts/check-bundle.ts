// Run after build:production. A bundle is required; absence fails closed.
let count = 0;
for await (const file of new Bun.Glob("dist/**/*.{js,mjs,cjs,map}").scan(".")) {
  count++;
  const content = await Bun.file(file).text();
  if (
    /(?:tests\/(?:adapters|helpers|fixtures|evals)|MOCK_AUTH|TEST_USER_ID|synthetic-session-|PIPELINE_EVAL_FAILED|INVALID_SYNTHETIC_ORIGIN)/.test(
      content,
    )
  )
    throw new Error(`TEST_CODE_IN_BUNDLE: ${file}`);
}
if (!count) throw new Error("MISSING_PRODUCT_BUNDLE");
console.log(`Product bundle checked: ${count} files, no fixture/adapter/auth-bypass sentinels`);

export {};
