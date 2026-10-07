// Run after deployed real-API preview/production builds. Missing bundles fail closed.
let count = 0;
for await (const file of new Bun.Glob("dist/**/*").scan({ dot: true, onlyFiles: true })) {
  if (/(?:^|\/)(?:\.dev\.vars|\.env)(?:\..*)?$/.test(file))
    throw new Error(`LOCAL_SECRETS_IN_BUNDLE: ${file}`);
  if (!/\.(?:js|mjs|cjs|map)$/.test(file)) continue;
  count++;
  const content = await Bun.file(file).text();
  if (
    /(?:tests\/(?:adapters|helpers|fixtures|evals)|MOCK_AUTH|TEST_USER_ID|synthetic-session-|PIPELINE_EVAL_FAILED|INVALID_SYNTHETIC_ORIGIN|baro-api-mock-v1:["'`]|baro-workspace-originals-v1)/.test(
      content,
    )
  )
    throw new Error(`TEST_CODE_IN_BUNDLE: ${file}`);
}
if (!count) throw new Error("MISSING_PRODUCT_BUNDLE");
console.log(`Product bundle checked: ${count} files, no fixture/adapter/auth-bypass sentinels`);

export {};
