/** Isolated Bun browser bundle cannot evaluate Astro import.meta.glob. Tests inject their explicit HTTP client. */
const unexpected = async (): Promise<never> => {
  throw Error("Unexpected default API use in isolated fixture");
};
export const api = {
  session: { get: unexpected },
  files: { list: unexpected },
  reports: { get: unexpected },
};
