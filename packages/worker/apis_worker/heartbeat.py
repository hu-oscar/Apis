"""Worker liveness heartbeat — Sprint 1.5.

Every HEARTBEAT_INTERVAL_S, post `{at, version, capacity}` to
`${APIS_API_BASE}/api/heartbeat/{provider_pda_str}`. The Vercel route
writes the record into KV (Pinata-by-name in prod, /tmp in local dev).
The buyer UI's /network and home pages read the most-recent heartbeat
and consider a provider "online" iff `at` is within the last 90 s.

Why a heartbeat rather than just checking on-chain Provider existence:
Provider PDAs persist after registration forever (no `deregister`
instruction yet), so on-chain presence ≠ "the worker process is up
right now." The heartbeat is the missing liveness signal.

Disabled (no-op) when APIS_API_BASE is unset — local-only dev runs
don't need it, and the absence stops dev runs from spamming a
nonexistent endpoint.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time

import httpx

log = logging.getLogger("apis_worker.heartbeat")

HEARTBEAT_INTERVAL_S = 30
# Loosely tracks `apis_worker` package version; surfaced in the UI's
# provider details panel so debugging "which worker version is this"
# is a glance away.
WORKER_VERSION = "0.2.0"


def _api_base() -> str | None:
    base = os.environ.get("APIS_API_BASE")
    return base.rstrip("/") if base else None


async def heartbeat_loop(provider_pda_str: str) -> None:
    """Long-running task: post a heartbeat every HEARTBEAT_INTERVAL_S.

    Runs alongside the listener in `listen_for_jobs`. Survives transient
    HTTP failures — single missed heartbeats are logged at WARNING and
    the loop continues. Cancel via `asyncio.CancelledError` to stop.
    """
    base = _api_base()
    if not base:
        log.info(
            "heartbeat disabled (APIS_API_BASE not set) — running local-only",
        )
        return

    url = f"{base}/api/heartbeat/{provider_pda_str}"
    log.info("starting heartbeat loop → %s (every %ds)", url, HEARTBEAT_INTERVAL_S)

    while True:
        payload = {
            "at": int(time.time() * 1000),
            "version": WORKER_VERSION,
            # Capacity = how many jobs the worker can run concurrently.
            # Today we serialize to 1 (see listener._job_lock) — future
            # multi-GPU support (Sprint 6 / Phase 2) bumps this.
            "capacity": 1,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(url, json=payload)
                if r.status_code != 200:
                    log.warning(
                        "heartbeat POST %s returned %d: %s",
                        url,
                        r.status_code,
                        r.text[:200],
                    )
        except (httpx.HTTPError, OSError) as exc:
            log.warning("heartbeat POST %s failed: %s", url, exc)
        await asyncio.sleep(HEARTBEAT_INTERVAL_S)
