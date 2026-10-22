/** Keep domain state across API failures; retry only a failed module/factory load. */
export function cacheClient<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
