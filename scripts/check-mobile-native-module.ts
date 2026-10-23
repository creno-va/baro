/** Resolve the real SDK autolinker, not source-name substring checks. No native toolchain needed. */
const expected = "baro-private-download";
for (const platform of ["apple", "android"]) {
  const child = Bun.spawn(
    [
      "node",
      "node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js",
      "resolve",
      "--platform",
      platform,
      "--project-root",
      "apps/mobile",
      "--json",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (code) throw new Error("NATIVE_MODULE_RESOLUTION_FAILED");
  const resolved = JSON.parse(output) as {
    modules: {
      packageName: string;
      packageVersion: string;
      modules?: { class: string }[];
      pods?: { podName: string }[];
      projects?: { name: string; modules: { classifier: string }[] }[];
    }[];
  };
  const module = resolved.modules.find((value) => value.packageName === expected);
  if (module?.packageVersion !== "0.1.0") throw new Error("NATIVE_MODULE_VERSION_MISSING");
  if (
    platform === "apple"
      ? !module.pods?.some((pod) => pod.podName === "BaroPrivateDownload") ||
        !module.modules?.some((value) => value.class === "BaroPrivateDownloadModule")
      : !module.projects?.some(
          (project) =>
            project.name === expected &&
            project.modules.some(
              (value) => value.classifier === "site.baro.download.BaroPrivateDownloadModule",
            ),
        )
  )
    throw new Error("NATIVE_MODULE_NOT_LINKED");
}
console.log(
  "Local private download module resolves for both platforms; compilation/device acceptance is separate",
);

export {};
