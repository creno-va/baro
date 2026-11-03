const path = require("node:path");
const { createRequire } = require("node:module");
try {
  const root = process.argv[2];
  const cli = path.join(root, "node_modules/@expo/cli");
  const cliRequire = createRequire(path.join(cli, "package.json"));
  const mainRequire = createRequire(path.join(root, "package.json"));
  const current = mainRequire("zod");
  const { validate } = cliRequire("@expo/schema-utils");
  const { PluginSchema, DevToolsPluginOutputSchema } = require(
    path.join(cli, "build/src/start/server/devtools/DevToolsPlugin.schema.js"),
  );
  const { createMCPDevToolsExtensionSchema } = require(
    path.join(cli, "build/src/start/server/mcp/createMCPDevToolsExtensionSchema.js"),
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
  const checked = (schema, value) => {
    try {
      validate(schema, value);
      return { accepted: true, issues: 0 };
    } catch (error) {
      return { accepted: false, issues: Array.isArray(error.errors) ? error.errors.length : 1 };
    }
  };
  const command = createMCPDevToolsExtensionSchema(plugin, current.z);
  let visits = 0;
  const constrained = current.z
    .array(
      current.z.preprocess((value) => {
        visits++;
        return value;
      }, current.z.number()),
    )
    .max(1)
    .safeParse(Array(512).fill("synthetic-invalid-number"));
  const malformedOutputs = [128, 256, 512].map((size) => {
    const result = checked(
      DevToolsPluginOutputSchema,
      Array(size).fill({ type: "text", text: 17, level: "info" }),
    );
    return { syntheticElements: size, rejected: !result.accepted, topLevelIssues: result.issues };
  });
  console.log(
    JSON.stringify({
      kind: "bounded-upstream-cli-schema-observation",
      cliVersion: cliRequire("./package.json").version,
      cliDeclaresZod: Boolean(cliRequire("./package.json").dependencies.zod),
      productZodVersion: mainRequire("zod/package.json").version,
      pluginAccepted: checked(PluginSchema, plugin).accepted,
      validOutputAccepted: checked(DevToolsPluginOutputSchema, [
        { type: "text", text: "synthetic", level: "info" },
      ]).accepted,
      commandAccepted: command.safeParse({
        command: "synthetic",
        enabled: true,
        count: 1,
        text: "synthetic",
      }).success,
      unknownCommandRejected: !command.safeParse({ command: "unlisted" }).success,
      extraCommandFieldRejected: !command.safeParse({ command: "synthetic", extra: 1 }).success,
      constrainedProduct: {
        rejected: !constrained.success,
        elementVisits: visits,
        issues: constrained.success ? 0 : constrained.error.issues.length,
      },
      malformedOutputs,
      arbitraryLargeInputTested: false,
      peakMemoryProven: false,
      networkStarted: false,
      devServerStarted: false,
      providerCalled: false,
      rawValuesExported: false,
      rawAuditPassed: false,
      entireCliReachabilityProven: false,
    }),
  );
} catch {
  console.log(JSON.stringify({ kind: "bounded-upstream-cli-schema-observation-failed" }));
  process.exitCode = 1;
}
