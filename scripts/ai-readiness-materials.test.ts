import { expect, test } from "bun:test";
import { createSyntheticMaterialLookup } from "./ai-readiness-materials";

test("synthetic material answer is withheld from initial context and requires a scoped read", async () => {
  const fixture = createSyntheticMaterialLookup();
  expect(fixture.context.materials).toHaveLength(16);
  expect(JSON.stringify(fixture.context)).not.toContain("86,420");
  expect(JSON.stringify(fixture.context)).not.toContain("보라등대");
  expect(fixture.snapshot()).toMatchObject({
    readRequests: 0,
    lastPageRead: false,
    answerMatched: false,
  });
  const fileId = fixture.context.references.files[0]?.id;
  if (!fileId) throw new Error("Synthetic file unavailable");
  for (const invalid of [
    { fileId: "wrong", fileRevision: 1 },
    { fileId, fileRevision: 2 },
  ])
    await expect(
      fixture.readMaterials(fixture.context, [{ ...invalid, startOrdinal: 16, count: 32 }]),
    ).rejects.toThrow();
  expect(fixture.snapshot().readRequests).toBe(0);
  const result = await fixture.readMaterials(fixture.context, [
    { fileId, fileRevision: 1, startOrdinal: 16, count: 32 },
  ]);
  expect(result.materials).toHaveLength(48);
  expect(result.materialWindows?.at(-1)?.nextOrdinal).toBeNull();
  expect(
    fixture.snapshot({
      text: "86,420원 · 보라등대",
      references: [result.materials[47]?.reference],
    }),
  ).toEqual({
    readRequests: 1,
    observationsRead: 32,
    lastPageRead: true,
    answerMatched: true,
    sourcePositionMatched: true,
  });
  expect(
    fixture.snapshot({ text: "86,420원 · 보라등대", references: [result.materials[0]?.reference] })
      .sourcePositionMatched,
  ).toBe(false);
  await expect(
    fixture.readMaterials(result, [{ fileId, fileRevision: 1, startOrdinal: 47, count: 1 }]),
  ).rejects.toThrow();
});
