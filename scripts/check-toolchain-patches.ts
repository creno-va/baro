import { verifyToolchainPatches } from "./toolchain-patches";

await verifyToolchainPatches();
console.log(
  "Pinned CJS/native patch/lock/installed tree/license bytes verified; raw audit and browser-distribution/CLI/native runtime acceptance remain separate",
);
