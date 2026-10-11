const repository = "creno-va/baro";
type Environment = "preview" | "production";
type ReleaseMode = "foundation" | "public-beta" | "operator-authorized";

export function deploymentOptions(args: string[]) {
  const [environment, ...rest] = args;
  if (environment !== "preview" && environment !== "production")
    throw new Error("Choose preview or production");
  const options: {
    environment: Environment;
    sha?: string;
    mode: ReleaseMode;
    authorization?: string;
    configureAi: boolean;
    plan: boolean;
  } = { environment, mode: "foundation", configureAi: false, plan: false };
  const seen = new Set<string>();
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (!flag || seen.has(flag)) throw new Error("Duplicate deployment option");
    seen.add(flag);
    if (flag === "--plan") options.plan = true;
    else if (flag === "--configure-ai") options.configureAi = true;
    else if (["--sha", "--mode", "--authorization"].includes(flag)) {
      const value = rest[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      if (flag === "--sha") options.sha = value;
      else if (flag === "--authorization") options.authorization = value;
      else {
        if (!["foundation", "public-beta", "operator-authorized"].includes(value))
          throw new Error("Invalid release mode");
        options.mode = value as ReleaseMode;
      }
    } else throw new Error(`Unknown deployment option: ${flag}`);
  }
  if (options.sha && !/^[a-f0-9]{40}$/.test(options.sha))
    throw new Error("--sha must be a full 40-character commit SHA");
  if (environment === "production" && !options.sha)
    throw new Error("Production requires --sha from a successful preview deployment");
  if (
    environment === "preview" &&
    (seen.has("--mode") || options.authorization || options.configureAi)
  )
    throw new Error("Release mode, launch authorization and AI configuration are production-only");
  if (options.mode === "operator-authorized") {
    if (!options.authorization || !/^[1-9]\d*$/.test(options.authorization))
      throw new Error("operator-authorized requires --authorization <issue-71-comment-id>");
  } else if (options.authorization)
    throw new Error("Authorization is only valid for operator-authorized mode");
  return options;
}

export function deploymentCommand(options: ReturnType<typeof deploymentOptions>, sha: string) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid release SHA");
  const args = [
    "gh",
    "workflow",
    "run",
    `deploy-${options.environment}.yml`,
    "--repo",
    repository,
    "--ref",
    "main",
    "-f",
    `target_sha=${sha}`,
  ];
  if (options.environment === "production") {
    args.push(
      "-f",
      "confirmation=production",
      "-f",
      `release_mode=${options.mode}`,
      "-f",
      `configure_ai=${options.configureAi}`,
    );
    if (options.authorization)
      args.push("-f", `launch_authorization_comment=${options.authorization}`);
  }
  return args;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "--help") {
    console.log(
      "bun run deploy:preview [--sha <40sha>] [--plan]\nbun run deploy:production --sha <40sha> [--mode foundation|public-beta|operator-authorized] [--authorization <comment-id>] [--configure-ai] [--plan]\nbun run deploy:status\nPreview defaults to remote main. Production defaults to foundation (public APIs closed).\n--plan prints the dispatch without running it. Credentials stay in GitHub Environments.\nWatch a selected run with: gh run watch <run-id> --repo creno-va/baro --exit-status",
    );
  } else if (args[0] === "status") {
    if (args.length !== 1) throw new Error("status takes no arguments");
    for (const environment of ["preview", "production"]) {
      const child = Bun.spawn(
        [
          "gh",
          "run",
          "list",
          "--repo",
          repository,
          "--workflow",
          `deploy-${environment}.yml`,
          "--limit",
          "5",
        ],
        { stdout: "inherit", stderr: "inherit" },
      );
      const code = await child.exited;
      if (code) {
        process.exitCode = code;
        break;
      }
    }
  } else {
    const options = deploymentOptions(args);
    let sha = options.sha;
    if (!sha) {
      const result = Bun.spawnSync([
        "gh",
        "api",
        `repos/${repository}/git/ref/heads/main`,
        "--jq",
        ".object.sha",
      ]);
      if (result.exitCode !== 0)
        throw new Error("Cannot resolve remote main; check gh auth status");
      sha = result.stdout.toString().trim();
    }
    const command = deploymentCommand(options, sha);
    console.log(
      `Target: ${options.environment} ${sha}${options.environment === "production" ? ` (${options.mode})` : ""}`,
    );
    console.log(command.join(" "));
    if (!options.plan) {
      const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
      process.exitCode = await child.exited;
      if (!process.exitCode)
        console.log(
          `Dispatch requested; deployment is not complete. Check: bun run deploy:status\nhttps://github.com/${repository}/actions/workflows/deploy-${options.environment}.yml`,
        );
    }
  }
}
