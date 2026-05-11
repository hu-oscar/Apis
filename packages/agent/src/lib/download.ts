// Download a result PNG from IPFS — Sprint 4.0e.
//
// Pulls the PNG via the public Pinata gateway (no auth needed; the
// content is already pinned and public) and writes it to a local
// `./out/{timestamp}-{cid}.png`. The buyer can open it directly or
// pipe it to whatever downstream tool wanted the image.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PINATA_GATEWAY } from "./rpc.js";

export type DownloadedResult = {
  cid: string;
  ipfsUrl: string;
  localPath: string;
  bytes: number;
};

/** Fetch an IPFS-pinned image and save it under `./out/`. Returns
 *  the local path so callers can announce it. */
export async function downloadResult(
  cid: string,
  outDir = "./out",
): Promise<DownloadedResult> {
  const ipfsUrl = `${PINATA_GATEWAY}/${cid}`;
  const r = await fetch(ipfsUrl);
  if (!r.ok) {
    throw new Error(`GET ${ipfsUrl} returned ${r.status}`);
  }
  const buf = new Uint8Array(await r.arrayBuffer());
  // ISO timestamp without colons (filesystem-safe).
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const cidShort = cid.slice(0, 12);
  const localPath = resolve(outDir, `${stamp}-${cidShort}.png`);
  if (!existsSync(dirname(localPath))) {
    mkdirSync(dirname(localPath), { recursive: true });
  }
  writeFileSync(localPath, buf);
  return { cid, ipfsUrl, localPath, bytes: buf.byteLength };
}
