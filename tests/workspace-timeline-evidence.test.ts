import { expect, test } from "bun:test";
import type { FileView, TimelineView } from "../src/client/api/types";
import { timelineEvidence } from "../src/components/workspace/timeline-evidence";
import type { V2Fact, V2FactReference } from "../src/contracts/v2";

const file: FileView = {
  id: "evidence",
  revision: 2,
  name: "합성 자료",
  mimeType: "image/png",
  sizeBytes: 100,
  status: "ready",
  coverage: "처리 완료",
  extractedText: "",
};
const reference: Extract<V2FactReference, { kind: "user_material" }> = {
  kind: "user_material",
  fileId: file.id,
  fileRevision: 2,
  position: { kind: "image", region: null },
};
const entry: TimelineView = {
  id: "event",
  date: "2026-10-01",
  title: "합성 사건",
  detail: "",
  certainty: "reported",
  references: [],
  factIds: [],
  userEdited: false,
};
const fact: V2Fact = {
  id: "fact",
  text: "합성 자료의 내용",
  attribution: "user_material",
  certainty: "observed",
  significance: "neutral",
  references: [reference],
  conflictingFactIds: [],
  userEdited: false,
};

test("user statements and official guidance alone never become material-confirmed case events", () => {
  expect(timelineEvidence(entry, [file]).kind).toBe("reported");
  expect(timelineEvidence({ ...entry, certainty: "observed" }, [file]).kind).toBe("unknown");
  expect(
    timelineEvidence(
      {
        ...entry,
        certainty: "observed",
        references: [{ kind: "official_source", citationId: "law" }],
      },
      [file],
    ).kind,
  ).toBe("unknown");
});

test("current photo, document, audio and video references retain the source's confirmation scope", () => {
  const positions: Extract<V2FactReference, { kind: "user_material" }>["position"][] = [
    { kind: "image", region: null },
    { kind: "document", page: 1, paragraph: null, table: null },
    { kind: "audio", startSeconds: 1, endSeconds: 3 },
    { kind: "video", timestampSeconds: 2, frameIndex: 2, sampling: "one_second" },
  ];
  for (const position of positions) {
    const references = [{ ...reference, position }];
    expect(timelineEvidence({ ...entry, references }, [file]).kind).toBe("material");
    expect(timelineEvidence({ ...entry, references, certainty: "observed" }, [file]).kind).toBe(
      "observed",
    );
  }
});

test("linked fact sources are resolved and duplicate material positions are displayed once", () => {
  const view = { ...entry, certainty: "observed" as const, factIds: [fact.id] };
  expect(timelineEvidence(view, [file], [fact]).kind).toBe("observed");
  expect(
    timelineEvidence({ ...view, references: [reference] }, [file], [fact]).materials,
  ).toHaveLength(1);
});

test("changed, missing or unfinished files cannot retain a confirmed badge", () => {
  const view = { ...entry, certainty: "observed" as const, references: [reference] };
  for (const files of [
    [],
    [{ ...file, revision: 3 }],
    [{ ...file, status: "processing" as const }],
  ]) {
    const result = timelineEvidence(view, files);
    expect(result.kind).toBe("stale");
    expect(result.hasMaterials).toBe(false);
  }
  expect(timelineEvidence({ ...view, userEdited: true }, [file]).kind).toBe("edited");
});

test("uncertainty and conflicting facts take priority over available material links", () => {
  const view = { ...entry, certainty: "observed" as const, factIds: [fact.id] };
  expect(timelineEvidence(view, [file], [{ ...fact, certainty: "uncertain" }]).kind).toBe(
    "uncertain",
  );
  expect(timelineEvidence(view, [file], [{ ...fact, userEdited: true }]).kind).toBe("uncertain");
  const result = timelineEvidence(
    view,
    [file],
    [{ ...fact, certainty: "conflicting", conflictingFactIds: ["other-fact"] }],
  );
  expect(result.kind).toBe("conflicting");
  expect(result.hasMaterials).toBe(true);
});
