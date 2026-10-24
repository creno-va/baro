/** Deletes only the temporary isolated probe credential. No product secret name. */
export async function deleteSyntheticLawCredential(
  input: { accountId: string; token: string },
  network: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
) {
  if (!/^[a-f0-9]{32}$/.test(input.accountId) || !input.token.trim())
    throw new Error("PROBE_SECRET_CLEANUP_INVALID");
  const response = await network(
    `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/workers/scripts/baro-synthetic-ai-readiness/secrets/LAW_API_OC?url_encoded=true`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${input.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (response.status === 404) return;
  const body = (await response.json().catch(() => null)) as { success?: boolean } | null;
  if (!response.ok || body?.success !== true) throw new Error("PROBE_SECRET_CLEANUP_FAILED");
}
