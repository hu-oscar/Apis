"""Sprint 1.7 — verify `_job_lock` serializes concurrent _process_job calls.

Three jobs are fired in parallel through `_process_job` with every
side-effect mocked out and replaced with a timestamped trace entry +
small sleep. We then assert that each job's pipeline phases run
contiguously (no interleaving with other jobs) — i.e. the lock holds.

Run from the worker package:
    .venv/bin/python -m unittest tests.test_listener_lock
"""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch
from typing import Any

from solders.keypair import Keypair
from solders.pubkey import Pubkey


# Each pipeline runs 4 phases (accept_job → inference → upload_png →
# submit_completion). We sleep this long inside each one to make
# interleaving visible if it happens.
PHASE_SLEEP = 0.05  # 50 ms


class WorkerLockTest(unittest.IsolatedAsyncioTestCase):
    async def test_parallel_jobs_serialize(self) -> None:
        # Lazy import so the patch decorators below see the module.
        from apis_worker import listener

        trace: list[tuple[str, str]] = []  # (job_short, phase)
        worker_kp = Keypair()

        async def fake_accept_job(job_pda: Pubkey, _kp: Keypair) -> str:
            trace.append((str(job_pda)[:6], "accept"))
            await asyncio.sleep(PHASE_SLEEP)
            return "sig-accept"

        async def fake_submit_completion(
            job_pda: Pubkey, _proof: bytes, _kp: Keypair
        ) -> str:
            trace.append((str(job_pda)[:6], "submit"))
            await asyncio.sleep(PHASE_SLEEP)
            return "sig-submit"

        def fake_run_inference(prompt: str, **_kwargs: Any) -> bytes:
            trace.append((prompt.split()[0][:6], "infer"))
            return b"FAKE_PNG_BYTES_" + prompt.encode()[:8]

        async def fake_upload_png(png_bytes: bytes, name: str) -> str:
            trace.append((name[4:10], "upload"))
            await asyncio.sleep(PHASE_SLEEP)
            return "bafyfakecid"

        def fake_store_result(job_pda_str: str, _cid: str, _proof: bytes) -> str:
            trace.append((job_pda_str[:6], "store"))
            return "/dev/null"

        def fake_lookup_spec(_hash: bytes) -> dict:
            return {
                "prompt": "test-prompt one",
                "model": "flux-schnell",
                "seed": 42,
                "steps": 4,
                "width": 32,
                "height": 32,
            }

        # Build 3 distinct JobCreated payloads.
        jobs = [
            {
                "job": bytes(Pubkey.new_unique()),
                "spec_hash": b"\x00" * 32,
            }
            for _ in range(3)
        ]

        with (
            patch.object(listener, "accept_job", new=fake_accept_job),
            patch.object(listener, "submit_completion", new=fake_submit_completion),
            patch.object(listener, "run_inference", new=fake_run_inference),
            patch.object(listener, "upload_png", new=fake_upload_png),
            patch.object(listener, "store_result", new=fake_store_result),
            patch.object(listener, "lookup_spec", new=fake_lookup_spec),
            patch.object(listener, "public_url", new=lambda cid: f"https://gw/{cid}"),
        ):
            # Fire all three in parallel — order of acquisition is by
            # arrival into _job_lock.
            await asyncio.gather(
                *(listener._process_job(j, worker_kp) for j in jobs)
            )

        # Each job goes through (accept, infer, upload, store, submit).
        # `infer` and `store` use a different short-key than accept/submit
        # (the inference one uses the spec.prompt's first word; store
        # uses job-pda-prefix). For ordering we only need to check that
        # no two pipelines' accept/submit interleave.
        accepts_and_submits = [
            (job_short, phase)
            for (job_short, phase) in trace
            if phase in ("accept", "submit")
        ]
        # Sequence must be: A accept, A submit, B accept, B submit, …
        self.assertEqual(
            len(accepts_and_submits),
            6,
            f"expected 6 accept+submit events, got {accepts_and_submits}",
        )
        for i in range(0, 6, 2):
            self.assertEqual(
                accepts_and_submits[i][1],
                "accept",
                f"expected accept at index {i}, got {accepts_and_submits[i]}",
            )
            self.assertEqual(
                accepts_and_submits[i + 1][1],
                "submit",
                f"expected submit at index {i + 1}, got {accepts_and_submits[i + 1]}",
            )
            self.assertEqual(
                accepts_and_submits[i][0],
                accepts_and_submits[i + 1][0],
                f"accept/submit pair {i // 2} job ids don't match: "
                f"{accepts_and_submits[i]} vs {accepts_and_submits[i + 1]}",
            )


if __name__ == "__main__":
    unittest.main()
