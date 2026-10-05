import type { EnvelopeCipher } from "../crypto";
import { createV2AccountingRepository } from "./v2-accounting";
import { createV2Core } from "./v2-core";
import { createV2DeletionRepository } from "./v2-deletion";
import { createV2DirectoryRepository } from "./v2-directory";
import { createV2FileEditsRepository } from "./v2-file-edits";
import { createV2FileStagingRepository } from "./v2-file-staging";
import { createV2FilesRepository } from "./v2-files";
import { createV2JobsRepository } from "./v2-jobs";
import { createV2LawyersRepository } from "./v2-lawyers";
import { createV2LegacyUpgradeRepository } from "./v2-legacy-upgrade";
import { createV2OfficialSourceRepository } from "./v2-official-sources";
import { createV2ReportsRepository } from "./v2-reports";
import { createV2StagingRepository } from "./v2-staging";
import { createV2SummaryEditsRepository } from "./v2-summary-edits";
import { createV2SummaryStagingRepository } from "./v2-summary-staging";
import { createV2WorkspaceRepository } from "./v2-workspace";
// Services bind one environment allocation explicitly. This factory makes no
// external calls or schema changes; HTTP/workflow adapters own invocation steps.
export function createV2Repository(
  binding: D1Database,
  cipher: EnvelopeCipher,
  options: { environment: "preview" | "production"; guideHosts?: readonly string[] },
) {
  const core = createV2Core(binding, cipher);
  return {
    accounting: createV2AccountingRepository(core, options.environment),
    workspace: createV2WorkspaceRepository(binding, cipher, options.guideHosts),
    files: createV2FilesRepository(core),
    fileStaging: createV2FileStagingRepository(core),
    fileEdits: createV2FileEditsRepository(core),
    summaryStaging: createV2SummaryStagingRepository(core),
    summaryEdits: createV2SummaryEditsRepository(core),
    staging: createV2StagingRepository(core),
    jobs: createV2JobsRepository(core),
    reports: createV2ReportsRepository(core, options.guideHosts),
    lawyers: createV2LawyersRepository(core),
    directory: createV2DirectoryRepository(core),
    deletion: createV2DeletionRepository(core),
    officialSources: createV2OfficialSourceRepository(core, options.guideHosts),
    legacyUpgrade: createV2LegacyUpgradeRepository(core),
  };
}
