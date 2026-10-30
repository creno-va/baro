/** Part zero establishes the server's encryption envelope. Later ordinals may
 * overlap, but completion/reader cleanup must wait for every in-flight write. */
export async function uploadParts<T>(
  count: number,
  concurrency: number,
  upload: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  results[0] = await upload(0);
  let next = 1;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), 3, count - 1) }, async () => {
      while (!failed && next < count) {
        const index = next++;
        try {
          results[index] = await upload(index);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }),
  );
  if (failed) throw failure;
  return results;
}
