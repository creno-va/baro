import { verifyToolchainPatches } from "./toolchain-patches";

await verifyToolchainPatches();
console.log(
  "Pinned CJS patch/lock/installed tree/license bytes verified; raw audit and browser-distribution/CLI/runtime acceptance remain separate",
);
