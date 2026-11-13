import type { APIRoute } from "astro";

// Test-only, same-origin HTTP bytes. Media engines must perform real range I/O.
const pcm = new Uint8Array(640044);
const header = new DataView(pcm.buffer);
const text = new TextEncoder();
pcm.set(text.encode("RIFF"), 0);
header.setUint32(4, pcm.length - 8, true);
pcm.set(text.encode("WAVEfmt "), 8);
header.setUint32(16, 16, true);
header.setUint16(20, 1, true);
header.setUint16(22, 1, true);
header.setUint32(24, 16000, true);
header.setUint32(28, 32000, true);
header.setUint16(32, 2, true);
header.setUint16(34, 16, true);
pcm.set(text.encode("data"), 36);
header.setUint32(40, 640000, true);
let available = true;
let reads = 0;
export const GET: APIRoute = ({ request, url }) => {
  if (url.pathname.endsWith("media-control")) return Response.json({ available, reads });
  reads++;
  if (!available)
    return new Response("Synthetic media unavailable", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "");
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2] ? Math.min(Number(match[2]), pcm.length - 1) : pcm.length - 1;
  if (start > end || start >= pcm.length)
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${pcm.length}` },
    });
  return new Response(pcm.slice(start, end + 1), {
    status: match ? 206 : 200,
    headers: {
      "content-type": "audio/wav",
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "content-length": String(end - start + 1),
      ...(match ? { "content-range": `bytes ${start}-${end}/${pcm.length}` } : {}),
    },
  });
};
export const POST: APIRoute = async ({ request, url }) => {
  if (!url.pathname.endsWith("media-control")) return new Response(null, { status: 405 });
  const value = (await request.json()) as { available?: unknown; reset?: unknown };
  if (typeof value.available !== "boolean") return new Response(null, { status: 400 });
  available = value.available;
  if (value.reset === true) reads = 0;
  return Response.json({ available, reads });
};
