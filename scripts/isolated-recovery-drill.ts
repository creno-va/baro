import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteAccount, replayDeletionJournal } from "../src/server/modules/deletion/service";
import { createIsolatedJournalManifest, validateIsolatedJournalManifest } from "./deletion-journal";
import {
  type DrillMigrations,
  installDrillSchema,
  loadDrillMigrations,
  seedDrillFixture,
} from "./isolated-recovery-drill-fixture";
import {
  configuredDatabases,
  type DrillPlan,
  drillPlanSchema,
  IsolatedD1,
} from "./isolated-recovery-drill-platform";

type Manifest = Awaited<ReturnType<typeof createIsolatedJournalManifest>>;
export interface DrillStorage {
  writeJournal(manifest: Manifest): Promise<void>;
  readJournal(): Promise<unknown>;
  writeEvidence(report: DrillEvidence): Promise<void>;
}
export type DrillEvidence = {
  version: 1;
  candidateSha: string;
  runId: string;
  runAttempt: string;
  environment: "isolated-test";
  scope: "v1-d1-account-journal";
  startedAt: string;
  finishedAt: string | null;
  databaseName: string;
  databaseId: string | null;
  creationAttempted: boolean;
  status: "running" | "failure" | "success";
  errorCode: string | null;
  stage: string;
  cleanup: "not-created" | "unconfirmed" | "confirmed-absent";
  steps: { name: string; at: string; observations: Record<string, unknown> }[];
  unverified: readonly string[];
};
export async function drillHash(value: string) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

/** One new synthetic DB, no runtime binding, no prior resource adoption or automatic mutation retry. */
export async function runRecoveryDrill(
  plan: DrillPlan,
  platform: IsolatedD1,
  storage: DrillStorage,
  migrations: DrillMigrations,
  now = () => new Date().toISOString(),
) {
  drillPlanSchema.parse(plan);
  const report: DrillEvidence = {
    version: 1,
    candidateSha: plan.candidateSha,
    runId: plan.runId,
    runAttempt: plan.runAttempt,
    environment: "isolated-test",
    scope: "v1-d1-account-journal",
    startedAt: now(),
    finishedAt: null,
    databaseName: platform.name,
    databaseId: null,
    creationAttempted: false,
    status: "running",
    errorCode: null,
    stage: "create",
    cleanup: "not-created",
    steps: [],
    unverified: [
      "live-oauth",
      "v2-object-inventory",
      "worker-workflow-r2-container",
      "worker-rollback",
      "key-recovery",
      "alert-delivery",
      "durable-journal-custody",
      "full-release-acceptance",
    ],
  };
  const record = async (name: string, observations: Record<string, unknown> = {}) => {
    report.steps.push({ name, at: now(), observations });
    await storage.writeEvidence(report);
  };
  // Persist the deterministic resource name before any creation, even if its API outcome is unknown.
  await storage.writeEvidence(report);
  try {
    const resource = await platform.create();
    report.databaseId = resource.databaseId;
    report.creationAttempted = true;
    report.cleanup = "unconfirmed";
    await record("created-and-identity-verified");
    report.stage = "schema-and-fixture";
    const db = platform.database();
    await installDrillSchema(db, migrations);
    await record("schema-installed", {
      migrations: migrations.length,
      sourceHash: await drillHash(JSON.stringify(migrations)),
    });
    const fixture = await seedDrillFixture(db, Date.parse(now()));
    await record("baseline-observed", await fixture.observe(false));
    report.stage = "bookmark-and-delete";
    const bookmarkHash = await drillHash(await platform.captureBookmark());
    await record("bookmark-captured", { bookmarkHash });
    const deletedAt = now();
    if (
      !(await deleteAccount(
        db,
        fixture.target.owner,
        fixture.target.session,
        Date.parse(deletedAt),
      ))
    )
      throw new Error("DRILL_ACCOUNT_DELETE_REJECTED");
    await record("account-deletion-observed", await fixture.observe(true));
    const exportedAt = now();
    report.stage = "journal-export";
    const manifest = await createIsolatedJournalManifest({
      version: 1,
      candidateSha: plan.candidateSha,
      resource,
      exportedAt,
      journal: await fixture.exportJournal(),
    });
    await storage.writeJournal(manifest);
    const reloadJournal = async () => {
      const loaded = await validateIsolatedJournalManifest(await storage.readJournal(), {
        resource,
        candidateSha: plan.candidateSha,
        exportedNotBefore: deletedAt,
        now: now(),
      });
      if (loaded.checksumSha256 !== manifest.checksumSha256)
        throw new Error("DRILL_JOURNAL_CHANGED");
      return loaded;
    };
    await reloadJournal();
    // Compare a second live export with the file independently of its self-reported checksum.
    const latest = await createIsolatedJournalManifest({
      version: 1,
      candidateSha: plan.candidateSha,
      resource,
      exportedAt,
      journal: await fixture.exportJournal(),
    });
    if (latest.checksumSha256 !== manifest.checksumSha256)
      throw new Error("DRILL_JOURNAL_NOT_LATEST");
    await record("external-journal-verified", {
      count: manifest.journal.length,
      checksumSha256: manifest.checksumSha256,
      storage: "private-runner-file-outside-d1",
    });
    report.stage = "time-travel-restore";
    await platform.restore();
    // A restore response alone is insufficient: deleted rows must actually reappear at the baseline.
    await record("bookmark-restore-observed", await fixture.observe(false));
    report.stage = "journal-replay";
    const restoredJournal = await reloadJournal();
    if (
      (await replayDeletionJournal(db, restoredJournal.journal)).replayed !==
      manifest.journal.length
    )
      throw new Error("DRILL_REPLAY_COUNT_MISMATCH");
    await record("journal-replay-observed", await fixture.observe(true));
    await replayDeletionJournal(db, (await reloadJournal()).journal);
    await record("repeat-replay-observed", await fixture.observe(true));
    report.stage = "cleanup";
    report.status = "success";
  } catch (error) {
    // Do not expose upstream SQL, rows, credentials, endpoints, stack or arbitrary API diagnostics.
    report.status = "failure";
    const known = [
      "DRILL_API_PERMISSION_DENIED",
      "DRILL_API_OUTCOME_UNKNOWN",
      "DRILL_DATABASE_ALREADY_EXISTS",
      "DRILL_PROTECTED_RESOURCE",
      "DRILL_RESOURCE_IDENTITY_CHANGED",
      "DRILL_RESTORE_BOOKMARK_MISMATCH",
      "DRILL_JOURNAL_CHANGED",
      "DRILL_JOURNAL_NOT_LATEST",
      "DRILL_OWNER_STATE_MISMATCH",
      "DRILL_FOREIGN_KEY_VIOLATIONS",
      "DRILL_ACCOUNT_DELETE_REJECTED",
    ];
    report.errorCode =
      error instanceof Error && known.includes(error.message)
        ? error.message
        : "DRILL_STAGE_FAILED";
  } finally {
    report.creationAttempted = platform.creationAttempted;
    report.databaseId = platform.resource?.databaseId ?? null;
    if (platform.creationAttempted) report.cleanup = "unconfirmed";
    try {
      await storage.writeEvidence(report);
    } catch {
      // Losing the report must not skip cleanup of a DB already created by this run.
      report.status = "failure";
      report.errorCode ??= "DRILL_EVIDENCE_WRITE_FAILED";
    }
    if (platform.resource) {
      try {
        await platform.destroy();
        report.cleanup = "confirmed-absent";
        await record("database-cleanup-observed");
      } catch {
        report.status = "failure";
        report.errorCode ??= "DRILL_CLEANUP_UNCONFIRMED";
      }
    }
    report.finishedAt = now();
    await storage.writeEvidence(report);
  }
  return report;
}

export async function privateDrillStorage(
  directory: string,
  evidencePath: string,
): Promise<DrillStorage> {
  const journalPath = join(directory, "latest-journal.json");
  return {
    async writeJournal(manifest) {
      await writeFile(journalPath, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
    },
    async readJournal() {
      const info = await lstat(journalPath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.nlink !== 1 ||
        (info.mode & 0o777) !== 0o600 ||
        info.size > 262_144
      )
        throw new Error("DRILL_PRIVATE_JOURNAL_INVALID");
      return JSON.parse(await readFile(journalPath, "utf8"));
    },
    async writeEvidence(report) {
      await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

if (import.meta.main) {
  try {
    if (Bun.argv.length !== 2) throw new Error("DRILL_ARGUMENTS_NOT_ALLOWED");
    const plan = drillPlanSchema.parse({
      candidateSha: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF,
      event: process.env.GITHUB_EVENT_NAME,
      confirmation: process.env.DRILL_CONFIRMATION,
    });
    const child = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
    const [sha, , code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code || sha.trim() !== plan.candidateSha) throw new Error("DRILL_CHECKOUT_MISMATCH");
    const migrations = await loadDrillMigrations();
    const platform = new IsolatedD1(
      plan,
      process.env.CLOUDFLARE_API_TOKEN ?? "",
      configuredDatabases(await Bun.file("wrangler.jsonc").json()),
    );
    const output = ".wrangler/isolated-recovery-drill";
    await mkdir(output, { recursive: true, mode: 0o700 });
    const privateDirectory = await mkdtemp(join(tmpdir(), "baro-d1-journal-"));
    const report = await runRecoveryDrill(
      plan,
      platform,
      await privateDrillStorage(privateDirectory, join(output, "evidence.json")),
      migrations,
    );
    // The private journal remains on the isolated job runner until it is destroyed. It is never uploaded.
    console.log(
      `Isolated D1 drill: ${report.status}; cleanup: ${report.cleanup}. Full acceptance remains unverified.`,
    );
    if (report.status !== "success") process.exitCode = 1;
  } catch {
    console.error(
      "DRILL_FAILED: inspect the sanitized evidence and resource identity; do not blindly rerun an unknown mutation.",
    );
    process.exitCode = 1;
  }
}
