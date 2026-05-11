// Pinata-as-key-value: small JSON pinned by name on IPFS.
//
// Replaces Upstash Redis for the buyer→worker spec channel and
// worker→buyer result channel. The trick: Pinata v3 lets us tag every
// upload with a `name` field, and the list endpoint supports filtering
// by exact name. So `kvSet("spec", hash, payload)` becomes
// "upload this JSON with name='spec:<hash>'", and `kvGet("spec", hash)`
// becomes "find the most-recent upload named 'spec:<hash>' and fetch
// its content via the public gateway".
//
// Why use this instead of Upstash:
//   - Zero new services — we already have PINATA_JWT for the worker
//     uploading result PNGs.
//   - Free Pinata tier covers our hackathon volume easily.
//   - Self-cleaning: the same spec uploaded twice dedupes by content
//     CID; our `name` index tracks the latest pin.
//
// Trade-off: Pinata public files are world-readable. That's fine for
// devnet test prompts (no PII), but a privacy regression vs. Upstash
// for production buyers — flagged in MEMORY.md.
//
// Latency budget: ~200-500 ms per get/set vs. ~10 ms Upstash. Acceptable
// for the 3-second poll cadence on /job/[id]; not acceptable for hot
// paths.

const PINATA_API_BASE = "https://api.pinata.cloud";
const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

function jwt(): string | null {
  // Defensive trim — copy-pasting JWTs into Vercel's env-var input
  // sometimes drags a trailing newline, which then breaks
  // Headers.append("Authorization", `Bearer ${jwt}`) with
  // `TypeError: invalid newline character`. The JWT itself never
  // contains whitespace, so trimming is always safe.
  const raw = process.env.PINATA_JWT;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Upload `value` (any JSON-serialisable thing) as a Pinata-pinned file
 * with `name` as the metadata. Returns the CID.
 *
 * Re-uploading with the same name creates a new pin pointing at the
 * new content. Old pins linger but `pinataGetByName` returns newest
 * first so the latest write wins.
 */
export async function pinataPutJson(
  name: string,
  value: unknown,
): Promise<{ cid: string }> {
  const token = jwt();
  if (!token) {
    throw new Error("PINATA_JWT not set");
  }

  const json = JSON.stringify(value);
  const blob = new Blob([json], { type: "application/json" });
  const form = new FormData();
  // Mirror what the worker's apis_worker/ipfs.py does for PNGs: the
  // first multipart part is the file content. Pinata uses the file's
  // own filename if `name` form-field is absent — but we want full
  // control, so pass `name` explicitly.
  form.append("file", blob, `${name}.json`);
  form.append("name", name);
  form.append("network", "public");

  const r = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Pinata upload ${r.status}: ${text}`);
  }
  const body = (await r.json()) as { data?: { cid?: string } };
  const cid = body.data?.cid;
  if (!cid) {
    throw new Error(`Pinata response missing data.cid: ${JSON.stringify(body)}`);
  }
  return { cid };
}

type PinataFileRow = {
  id: string;
  name: string | null;
  cid: string;
  created_at: string;
};

/**
 * Look up the most-recent file named `name`, fetch its content from the
 * public gateway, and parse it as JSON. Returns null on any miss
 * (no match, gateway error, malformed JSON).
 */
export async function pinataGetByName<T = unknown>(
  name: string,
): Promise<T | null> {
  const token = jwt();
  if (!token) return null;

  // 1. Find the pin by name (most-recent first; we only need 1).
  const url =
    `${PINATA_API_BASE}/v3/files/public?` +
    new URLSearchParams({ name, order: "DESC", limit: "1" }).toString();
  let listResp: Response;
  try {
    listResp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      // Pinata's list endpoint can be slow; allow extra time but cap.
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!listResp.ok) return null;
  const listBody = (await listResp.json().catch(() => null)) as
    | { data?: { files?: PinataFileRow[] } }
    | null;
  const cid = listBody?.data?.files?.[0]?.cid;
  if (!cid) return null;

  // 2. Fetch the content from the public gateway. Gateways are CDN-
  // backed, no JWT required for public CIDs.
  let contentResp: Response;
  try {
    contentResp = await fetch(`${PINATA_GATEWAY}/${cid}`, {
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!contentResp.ok) return null;
  try {
    return (await contentResp.json()) as T;
  } catch {
    return null;
  }
}

/** Whether the Pinata-backed store is configured (vs FS fallback). */
export function pinataIsConfigured(): boolean {
  return jwt() !== null;
}
