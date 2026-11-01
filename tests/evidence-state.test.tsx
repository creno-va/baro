import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FileView } from "../src/client/api/types";
import { CaseMaterials } from "../src/components/workspace/CaseMaterials";
import {
  evidenceRequirementStates,
  materialState,
  observationKind,
} from "../src/components/workspace/evidence-state";
import type { V2EvidenceRequirement, V2Fact, V2FileObservation } from "../src/contracts/v2";

const file: FileView = {
  id: "synthetic-file",
  revision: 2,
  name: "계약서라는-이름만.txt",
  mimeType: "text/plain",
  sizeBytes: 5,
  status: "ready",
  coverage: "",
  extractedText: "",
};
const requirement: V2EvidenceRequirement = {
  id: "synthetic-requirement",
  kind: "contract",
  label: "계약 내용을 확인할 자료",
  reason: "약정 내용을 확인해 주세요.",
  fileIds: [],
};
const fact = (revision: number): V2Fact => ({
  id: "synthetic-fact",
  text: "합성 관찰",
  attribution: "user_material",
  certainty: "uncertain",
  significance: "neutral",
  references: [
    {
      kind: "user_material",
      fileId: file.id,
      fileRevision: revision,
      position: { kind: "image", region: null },
    },
  ],
  conflictingFactIds: [],
  userEdited: false,
});

describe("explicit evidence associations", () => {
  test("a filename never fulfils an evidence type; an absent or deleted association is requested again", () => {
    expect(evidenceRequirementStates([requirement], [file])[0]?.status).toBe("missing");
    const linked = { ...requirement, fileIds: [file.id] };
    expect(evidenceRequirementStates([linked], [], [fact(2)])[0]?.status).toBe("missing");
    expect(evidenceRequirementStates([linked], [file])[0]?.status).toBe("review");
  });
  test("pending UI associations suppress repeated requests while retaining upload and review states", () => {
    const states = evidenceRequirementStates(
      [requirement],
      [{ ...file, status: "uploading" }],
      [],
      { [requirement.id]: [file.id] },
    );
    expect(states[0]?.status).toBe("uploading");
    expect(states[0]?.canRequest).toBe(false);
    expect(
      evidenceRequirementStates(
        [{ ...requirement, fileIds: [file.id] }],
        [{ ...file, status: "processing" }],
        [fact(2)],
      )[0]?.status,
    ).toBe("processing");
  });
  test("only the current ready revision is linked; changing observations invalidates old references", () => {
    const linked = { ...requirement, fileIds: [file.id] };
    expect(evidenceRequirementStates([linked], [file], [fact(2)])[0]?.status).toBe("linked");
    expect(evidenceRequirementStates([linked], [file], [fact(1)])[0]?.status).toBe("stale");
    expect(materialState({ ...file, revision: undefined }, [fact(2)])).toBe("review");
    expect(materialState({ ...file, status: "failed" }, [fact(2)])).toBe("failed");
    expect(
      materialState({ ...file, status: "uploading", uploadRejection: "FILE_REJECTED" }, [fact(2)]),
    ).toBe("rejected");
  });
  test("one fulfilled file does not hide a second file's pending transfer or failure", () => {
    const second = { ...file, id: "synthetic-second", status: "uploading" as const };
    const linked = { ...requirement, fileIds: [file.id, second.id] };
    expect(evidenceRequirementStates([linked], [file, second], [fact(2)])[0]?.status).toBe(
      "uploading",
    );
    expect(
      evidenceRequirementStates([linked], [file, { ...second, status: "failed" }], [fact(2)])[0]
        ?.status,
    ).toBe("failed");
  });
});

test("photo categories preserve the exact text and never upgrade uncertain model observations", () => {
  const value: V2FileObservation = {
    id: "synthetic-observation",
    text: "[문서 기재] 읽을 수 있는 금액",
    position: { kind: "image", region: null },
    certainty: "uncertain",
    userEdited: false,
    included: true,
  };
  expect(observationKind(value)).toBe("stated");
  expect(observationKind({ ...value, text: "[보이는 상태] 사각형" })).toBe("visible");
  expect(observationKind({ ...value, text: "[확인 필요] 흐린 글자" })).toBe("uncertain");
  expect(observationKind({ ...value, text: "알 수 없는 prefix 없는 과거 관찰" })).toBe("uncertain");
  expect(observationKind({ ...value, certainty: "observed", text: "추출된 문서 내용" })).toBe(
    "extracted",
  );
  expect(observationKind({ ...value, userEdited: true })).toBe("edited");
  expect(value.certainty).toBe("uncertain");
  expect(value.text).toBe("[문서 기재] 읽을 수 있는 금액");
});

test("CaseMaterials shows processing independently from old facts and directs summary corrections to reconfirmation", () => {
  const html = renderToStaticMarkup(
    <CaseMaterials
      caseId="synthetic-case"
      files={[{ ...file, status: "uploading" }]}
      facts={[fact(2)]}
    />,
  );
  expect(html).toContain("업로드 중");
  expect(html).not.toContain("사실에 연결된 자료");
  expect(html).not.toContain("요약 본문은 직접 수정");
  expect(html).toContain("사건 정리 재확인");
});
