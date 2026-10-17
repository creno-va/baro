import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// Windows uses libuv handles instead of the POSIX extra-stdio fd handoff.
test.skipIf(process.platform === "win32")(
  "collecting closed native control pipes does not close descriptors owned by later work",
  async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("./helpers/native-descriptor-probe.ts", import.meta.url)),
      ],
      { stdout: "pipe", stderr: "pipe", timeout: 2_000 },
    );
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exit).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      version: Bun.version,
      iterations: 12,
      recycledDescriptorsClosed: 0,
    });
  },
);
