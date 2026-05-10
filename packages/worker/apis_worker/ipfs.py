"""Pinata v3 file upload (returns IPFS CID).

Uses the v3 endpoint authorised by the `Files: Write` scope of the
PINATA_JWT. Tech Design §3 chose Pinata's free tier (1 GB / 100K
file ops per month — comfortably under our hackathon-scope volume).
"""

from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger("apis_worker.ipfs")

PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files"
PUBLIC_GATEWAY = "https://gateway.pinata.cloud/ipfs"


def _jwt() -> str:
    jwt = os.environ.get("PINATA_JWT")
    if not jwt:
        raise RuntimeError(
            "PINATA_JWT not set. Add it to packages/worker/.env "
            "(see Tech Design §3 for the Pinata setup)."
        )
    return jwt


async def upload_png(
    png_bytes: bytes, name: str = "apis-result.png"
) -> str:
    """Upload a PNG to Pinata; return the IPFS CID."""
    headers = {"Authorization": f"Bearer {_jwt()}"}
    files = {"file": (name, png_bytes, "image/png")}
    log.info("uploading %d bytes to Pinata as %s", len(png_bytes), name)

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(PINATA_UPLOAD_URL, headers=headers, files=files)
    resp.raise_for_status()

    body = resp.json()
    cid = body.get("data", {}).get("cid")
    if not cid:
        raise RuntimeError(f"Pinata response missing data.cid: {body!r}")
    log.info("pinned: cid=%s url=%s", cid, public_url(cid))
    return cid


def public_url(cid: str) -> str:
    """Public IPFS gateway URL for a CID."""
    return f"{PUBLIC_GATEWAY}/{cid}"
