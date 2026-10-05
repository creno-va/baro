import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative as relativePath, resolve } from "node:path";

const repositoryRoot = process.cwd();
const docsRoot = join(repositoryRoot, "docs");

const requiredDocuments = [
  "README.md",
  "PRD.md",
  "product/MVP-SPEC.md",
  "product/UX-SPEC.md",
  "product/ROADMAP.md",
  "product/PUBLIC-CONTENT-AUDIT.md",
  "adr/README.md",
  "adr/0001-mvp-system-boundaries-and-ai-pipeline.md",
  "adr/0002-web-stack-and-cloudflare-runtime.md",
  "adr/0003-identity-data-and-privacy.md",
  "adr/0004-ai-provider-and-legal-retrieval.md",
  "architecture/SYSTEM.md",
  "architecture/DATA-MODEL.md",
  "architecture/HTTP-API.md",
  "architecture/AI-PIPELINE.md",
  "architecture/LEGAL-RETRIEVAL.md",
  "security/SECURITY-PRIVACY.md",
  "quality/TEST-STRATEGY.md",
  "operations/DEPLOYMENT-OPERATIONS.md",
  "operations/OBSERVABILITY.md",
  "analytics/EVENTS.md",
  "policies/PRIVACY-POLICY.DRAFT.md",
  "policies/TERMS.DRAFT.md",
  "policies/AI-NOTICE.md",
  "development/EXECUTION.md",
  "quality/PROJECT-REVIEW.md",
  "architecture/DOMAIN-LIFECYCLE.md",
  "adr/0005-durable-execution-and-release-gates.md",
];

const publicationBlockerAllowlist = new Set([
  "README.md",
  "policies/PRIVACY-POLICY.DRAFT.md",
  "policies/TERMS.DRAFT.md",
]);

async function listMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(path);
      return extname(entry.name) === ".md" ? [path] : [];
    }),
  );
  return nested.flat();
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function relativeDocumentPath(path: string): string {
  return relativePath(docsRoot, path).replaceAll("\\", "/");
}

const errors: string[] = [];

for (const required of requiredDocuments) {
  if (!(await exists(join(docsRoot, required)))) {
    errors.push(`필수 문서 누락: docs/${required}`);
  }
}

const documents = [
  ...(await listMarkdownFiles(docsRoot)),
  join(repositoryRoot, "README.md"),
  join(repositoryRoot, "AGENTS.md"),
  ...(await listMarkdownFiles(join(repositoryRoot, ".github"))),
];
const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

for (const document of documents) {
  const relative = relativeDocumentPath(document);
  const content = await readFile(document, "utf8");
  const lines = content.split("\n");

  if (!content.endsWith("\n")) {
    errors.push(`docs/${relative}: 파일 끝 개행이 없습니다.`);
  }
  if (content.endsWith("\n\n")) {
    errors.push(`docs/${relative}: 파일 끝에 불필요한 빈 줄이 있습니다.`);
  }
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      errors.push(`docs/${relative}:${index + 1}: 후행 공백이 있습니다.`);
    }
  });

  if (
    document.startsWith(docsRoot) &&
    content.includes("[PUBLICATION_BLOCKER:") &&
    !publicationBlockerAllowlist.has(relative)
  ) {
    errors.push(`docs/${relative}: 허용되지 않은 publication blocker가 있습니다.`);
  }

  for (const match of content.matchAll(markdownLinkPattern)) {
    let target = match[1]?.trim().split("#", 1)[0];
    if (!target || /^(https?:|mailto:|#|\/)/i.test(target)) continue;
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    const resolvedTarget = resolve(dirname(document), decodeURIComponent(target));
    if (!(await exists(resolvedTarget))) {
      errors.push(`docs/${relative}: 존재하지 않는 상대 링크 '${target}'`);
    }
  }
}

const adrDocuments = documents.filter((document) => /[\\/]adr[\\/]\d{4}-.*\.md$/.test(document));
for (const adr of adrDocuments) {
  const content = await readFile(adr, "utf8");
  if (
    !/^- Status: (Proposed|Accepted|Superseded|Deprecated)$/m.test(content.replaceAll("\r", ""))
  ) {
    errors.push(`docs/${relativeDocumentPath(adr)}: 유효한 ADR 상태가 없습니다.`);
  }
  if (!/^- Date: \d{4}-\d{2}-\d{2}$/m.test(content.replaceAll("\r", ""))) {
    errors.push(`docs/${relativeDocumentPath(adr)}: ADR 날짜가 없습니다.`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`문서 검사 통과: ${documents.length}개 Markdown, ${adrDocuments.length}개 ADR`);
