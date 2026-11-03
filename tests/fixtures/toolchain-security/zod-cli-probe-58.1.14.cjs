const path = require("node:path");
const { createRequire } = require("node:module");
try {
  const root = process.argv[2];
  const cli = path.join(root, "node_modules/@expo/cli");
  const cliRequire = createRequire(path.join(cli, "package.json"));
  const mainRequire = createRequire(path.join(root, "package.json"));
  const legacy = cliRequire("zod");
  const current = mainRequire("zod");
  const { PluginSchema, DevToolsPluginOutputSchema } = require(
    path.join(cli, "build/src/start/server/DevToolsPlugin.schema.js"),
  );
  const { createMCPDevToolsExtensionSchema } = require(
    path.join(cli, "build/src/start/server/createMCPDevToolsExtensionSchema.js"),
  );
  const plugin = {
    packageName: "synthetic-plugin",
    packageRoot: "/synthetic",
    cliExtensions: {
      description: "synthetic",
      entryPoint: "./synthetic.cjs",
      commands: [
        {
          name: "synthetic",
          title: "synthetic",
          environments: ["mcp", "cli"],
          parameters: [
            { name: "enabled", type: "confirm" },
            { name: "count", type: "number" },
            { name: "text", type: "text" },
          ],
        },
      ],
    },
  };
  const command = createMCPDevToolsExtensionSchema(plugin);
  const constrained = (zod) => {
    let visits = 0;
    const schema = zod.z
      .array(
        zod.z.preprocess((value) => {
          visits++;
          return value;
        }, zod.z.number()),
      )
      .max(1);
    const result = schema.safeParse(Array(512).fill("synthetic-invalid-number"));
    return {
      rejected: !result.success,
      elementVisits: visits,
      issues: result.success ? 0 : result.error.issues.length,
    };
  };
  const malformedOutputs = [128, 256, 512].map((size) => {
    const result = DevToolsPluginOutputSchema.safeParse(
      Array(size).fill({ type: "text", text: 17, level: "info" }),
    );
    return {
      syntheticElements: size,
      rejected: !result.success,
      topLevelIssues: result.success ? 0 : result.error.issues.length,
    };
  });
  const output = {
    kind: "bounded-cli-zod-schema-observation",
    cliVersion: cliRequire("./package.json").version,
    cliZodVersion: cliRequire("zod/package.json").version,
    productZodVersion: mainRequire("zod/package.json").version,
    pluginAccepted: PluginSchema.safeParse(plugin).success,
    validOutputAccepted: DevToolsPluginOutputSchema.safeParse([
      { type: "text", text: "synthetic", level: "info" },
    ]).success,
    commandAccepted: command.safeParse({
      command: "synthetic",
      enabled: true,
      count: 1,
      text: "synthetic",
    }).success,
    unknownCommandRejected: !command.safeParse({ command: "unlisted" }).success,
    extraCommandFieldRejected: !command.safeParse({ command: "synthetic", extra: 1 }).success,
    constrainedLegacy: constrained(legacy),
    constrainedProduct: constrained(current),
    malformedOutputs,
    arbitraryLargeInputTested: false,
    peakMemoryProven: false,
    networkStarted: false,
    devServerStarted: false,
    providerCalled: false,
    rawValuesExported: false,
    rawAuditPassed: false,
    entireCliReachabilityProven: false,
  };
  console.log(JSON.stringify(output));
} catch {
  console.log(JSON.stringify({ kind: "bounded-cli-zod-schema-observation-failed" }));
  process.exitCode = 1;
}
