/** Isolated browser backend. Persist bytes instead of IDB Blob serialization;
 * the unchanged file mock still verifies each chunk, complete hash and readback. */
export async function byteOriginalStore(key: string, value?: Blob | null): Promise<Blob | null> {
  const packed =
    value instanceof Blob ? { bytes: await value.arrayBuffer(), type: value.type } : value;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("baro-c-byte-originals-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("originals");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("SYNTHETIC_ORIGINAL_DATABASE_UNAVAILABLE"));
  });
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction("originals", value === undefined ? "readonly" : "readwrite");
      const store = tx.objectStore("originals");
      const request =
        packed === undefined
          ? store.get(key)
          : packed === null
            ? store.delete(key)
            : store.put(packed, key);
      let result: Blob | null = null;
      request.onsuccess = () => {
        const record = request.result as { bytes?: ArrayBuffer; type?: string } | undefined;
        if (record?.bytes instanceof ArrayBuffer && typeof record.type === "string")
          result = new Blob([record.bytes], { type: record.type });
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(new Error("SYNTHETIC_ORIGINAL_WRITE_FAILED"));
      tx.onabort = () => reject(new Error("SYNTHETIC_ORIGINAL_WRITE_ABORTED"));
    });
  } finally {
    db.close();
  }
}
