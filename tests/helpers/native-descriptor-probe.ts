import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, fstatSync, openSync } from "node:fs";
import type { Readable } from "node:stream";

// Run only in an isolated subprocess: a broken runtime can close any reused fd.
// This is the extra control pipe used by Miniflare's workerd child, without D1,
// network, or provider dependencies. See oven-sh/bun#32520.
const iterations = 12;
let recycledDescriptorsClosed = 0;
for (let iteration = 0; iteration < iterations; iteration++) {
  let child: ChildProcess | null = spawn("/bin/sh", ["-c", "printf ready >&3"], {
    stdio: ["ignore", "ignore", "ignore", "pipe"],
  });
  let socket = child.stdio[3] as Readable | null;
  if (!socket) throw new Error("Synthetic control pipe missing");
  socket.resume();
  const closed = once(socket, "close");
  await once(child, "exit");
  socket.destroy();
  await closed;
  // POSIX reuses the freed descriptor. Its new owner must survive collection
  // of the old native Subprocess, whose net.Socket already closed the pipe.
  const descriptor = openSync(process.execPath, "r");
  child = null;
  socket = null;
  Bun.gc(true);
  await Bun.sleep(0);
  Bun.gc(true);
  try {
    fstatSync(descriptor);
    closeSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EBADF") throw error;
    recycledDescriptorsClosed++;
  }
}
console.log(JSON.stringify({ version: Bun.version, iterations, recycledDescriptorsClosed }));
