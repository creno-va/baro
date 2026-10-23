import { compiledMobileFontProof } from "./mobile-native-assets";

/** Resolve named resources, not optimizer-dependent ZIP filenames. Reject qualifiers/aliases/ambiguity. */
export function androidFontResources(dump: string) {
  if (!/^Package name=site\.baro\.app\.preview id=7f$/m.test(dump))
    throw new Error("ANDROID_FONT_RESOURCE_IDENTITY_REQUIRED");
  function named(name: string, extension: string) {
    const headers = [...dump.matchAll(/^ {4}resource (0x[0-9a-f]{8}) ([^\r\n]+)$/gm)],
      matches = headers.filter((m) => m[2] === `font/${name}`);
    const header = matches[0];
    if (matches.length !== 1 || !header || header.index === undefined || !header[1])
      throw new Error("ANDROID_FONT_RESOURCE_AMBIGUOUS");
    const tail = dump.slice(header.index + header[0].length),
      block = tail.split(/^ {4}resource |^ {2}type |^Package /m)[0] ?? "",
      lines = block.split(/\r?\n/).filter((l) => l.trim());
    const match = lines[0]?.match(/^ {6}\(\) \(file\) (res\/[A-Za-z0-9_./-]+)(?: type=XML)?$/);
    if (
      lines.length !== 1 ||
      !match?.[1]?.endsWith(extension) ||
      match[1].split("/").some((p) => !p || p === "." || p === "..")
    )
      throw new Error("ANDROID_FONT_RESOURCE_PATH_REQUIRED");
    return { id: header[1], path: match[1] };
  }
  const font = named("baro_mobile", ".ttf"),
    family = named("xml_baro_mobile", ".xml");
  if (font.id === family.id) throw new Error("ANDROID_FONT_RESOURCE_AMBIGUOUS");
  return { font, family };
}
export function verifyCompiledAndroidFontFaces(xmlTree: string, fontId: string) {
  const family = xmlTree.match(/^ {2}E: font-family \(line=\d+\)$/gm),
    faces = xmlTree.split(/^ {6}E: font \(line=\d+\)$/m).slice(1);
  if (family?.length !== 1 || faces.length !== 3)
    throw new Error("ANDROID_FONT_COMPILED_FACES_REQUIRED");
  const weightSet = new Set<number>();
  for (const face of faces) {
    const references = [...face.matchAll(/:font\(0x[0-9a-f]+\)=@(0x[0-9a-f]+)$/gm)],
      weights = [...face.matchAll(/:fontWeight\(0x[0-9a-f]+\)=(\d+)$/gm)],
      weight = Number(weights[0]?.[1]);
    if (
      references.length !== 1 ||
      references[0]?.[1] !== fontId ||
      weights.length !== 1 ||
      ![400, 600, 700].includes(weight) ||
      weightSet.has(weight) ||
      !face.includes(`:fontVariationSettings(`) ||
      !new RegExp(`:fontVariationSettings\\(0x[0-9a-f]+\\)="'wght' ${weight}"`).test(face) ||
      !/:fontStyle\(0x[0-9a-f]+\)=0$/m.test(face)
    )
      throw new Error("ANDROID_FONT_COMPILED_FACES_REQUIRED");
    weightSet.add(weight);
  }
}
export async function verifyArchivedAndroidFont(root: string, apk: string, aapt2: string) {
  async function run(args: string[]) {
    const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" }),
      timer = setTimeout(() => child.kill(), 120000);
    try {
      const [body] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).arrayBuffer(),
      ]);
      if (await child.exited) throw new Error("ANDROID_FONT_RESOURCE_TOOL_FAILED");
      return new Uint8Array(body);
    } finally {
      clearTimeout(timer);
    }
  }
  const resources = androidFontResources(
    new TextDecoder().decode(await run([aapt2, "dump", "resources", apk])),
  );
  const paths = new TextDecoder().decode(await run(["unzip", "-Z1", apk])).split(/\r?\n/);
  for (const path of [resources.font.path, resources.family.path])
    if (paths.filter((p) => p === path).length !== 1)
      throw new Error("ANDROID_FONT_RESOURCE_AMBIGUOUS");
  verifyCompiledAndroidFontFaces(
    new TextDecoder().decode(
      await run([aapt2, "dump", "xmltree", apk, "--file", resources.family.path]),
    ),
    resources.font.id,
  );
  return compiledMobileFontProof(root, await run(["unzip", "-p", apk, resources.font.path]));
}
