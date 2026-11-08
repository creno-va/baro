import { expect, test } from "bun:test";

for (const scenario of ["customer", "lawyer", "legacy"])
  test(`real common login transport: ${scenario}`, async () => {
    // Better Auth captures fetch at construction; isolate the real client from
    // other suites instead of replacing its module or changing product wiring.
    const child = Bun.spawn([process.execPath, "tests/helpers/common-login-probe.ts", scenario], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(stdout)).toMatchObject({ scenario, passed: true });
  });
