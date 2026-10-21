/** The version proves that every native step uses the retained attempt name.
 * Older random Container IDs cannot be recovered from Workflow IDs. */
export function nativeJobId(kind: "file" | "asset" | "probe") {
  return `native-v1-${kind}-${crypto.randomUUID()}`;
}

export function isNamedNativeRuntime(id: string) {
  return /^(?:native-v1-(?:file|asset|probe|report)|probe)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-[1-9][0-9]*$/.test(
    id,
  );
}

/** Reusing the attempt name makes native work reachable after Workflow deletion.
 * Normal unit cleanup is reusable; deletion permanently revokes the attempt. */
export function namedProcessorPort(binding: Env["FILE_PROCESSOR"], runtimeId: string) {
  const native = binding.get(binding.idFromName(runtimeId));
  return {
    fetch: (request: Request) => native.fetch(request),
    stop: () => native.stopProcessing(),
  };
}
