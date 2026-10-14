import { expect, test } from "bun:test";
import { productBoundaryFindings } from "../scripts/product-boundaries";

const path = "src/server/api/v2/workspaces.ts";
const approved =
  'console.info(JSON.stringify({ event: "preview_d1_timing", measurements: timing }));';

test("preview timing permits only the reviewed file and exact static log shape", () => {
  expect(productBoundaryFindings(path, approved)).toEqual([]);
  expect(productBoundaryFindings(path.replaceAll("/", "\\"), approved)).toEqual([]);
  for (const other of [
    "src/server/api/v2/files.ts",
    "src/server/db/preview-d1-timing.ts",
    "src/server/dependency-diagnostics.ts",
  ])
    expect(productBoundaryFindings(other, approved)).toContain("unapproved_payload_log");
});

test("preview timing rejects extra fields, raw values and aliases", () => {
  for (const unsafe of [
    'console.info(JSON.stringify({event:"preview_d1_timing",measurements:timing,ownerId}))',
    'console.info(JSON.stringify({event:"preview_d1_timing",measurements:timing,sql}))',
    'console.info(JSON.stringify({event:"preview_d1_timing",measurements:timing,...payload}))',
    'console.info(JSON.stringify({event:"preview_d1_timing",measurements:error.message}))',
    'console.info(JSON.stringify({event:"preview_d1_timing",measurements:headers}))',
    'console.info(JSON.stringify({event:"preview_d1_timing",measurements:request.url}))',
    'console.info(JSON.stringify({event:"preview_d1_timing",measurements:timing}),error)',
    'console.error(JSON.stringify({event:"preview_d1_timing",measurements:timing}))',
    'console["info"](JSON.stringify({event:"preview_d1_timing",measurements:timing}))',
    'const log = console.info; log(JSON.stringify({event:"preview_d1_timing",measurements:timing}))',
    'const {info} = console; info(JSON.stringify({event:"preview_d1_timing",measurements:timing}))',
    'logger.info(JSON.stringify({event:"preview_d1_timing",measurements:timing}))',
  ])
    expect(productBoundaryFindings(path, unsafe)).toContain("unapproved_payload_log");
});
