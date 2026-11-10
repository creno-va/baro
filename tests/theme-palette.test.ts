import { expect, test } from "bun:test";

const color = /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(?:white|black)\s*[;)]/i;
// The baseline/landing palette and saved paper documents are separate contracts.
const themed = [
  "app-focus",
  "case-workbench",
  "cases",
  "consent",
  "evidence",
  "feedback",
  "intake",
  "lawyers",
  "login",
  "policies",
  "precedents",
  "public-compat",
  "reports",
  "resolution",
  "settings",
  "stories",
  "workspace",
  "workspace-conversation",
];
test("application-owned styles consume semantic colors instead of a fixed light palette", async () => {
  for (const name of themed) {
    const source =
      (await Bun.file(`src/styles/${name}.css`).text()).split(
        "/* Same scoped presentation as document.ts;",
      )[0] ?? "";
    const declarations = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n");
    const literals = declarations.filter((line) => color.test(line));
    expect({ file: name, literals }).toEqual({ file: name, literals: [] });
  }
  const shell = (await Bun.file("src/styles/shell.css").text()).split("\nbody {")[1] ?? "";
  expect(shell.match(color)).toBeNull();
});
