"""Flux Schnell inference via the mflux CLI.

mflux 0.17 publishes its primary surface as console scripts
(`mflux-generate`, etc.) rather than a stable Python API. We shell out
to the binary in our venv. Subprocess overhead is ~0.5s on top of the
~3-8s of generation, acceptable for the W2 demo throughput.

Flux Schnell hard-coded constraints (per the model card / Research §5):
- `--steps 4` (the model is distilled to 4 steps; more is wasted compute)
- `--guidance` is always 0 for Schnell (mflux's default for this model)
- `--quantize 8` fits ~10 GB on M3 Pro 18 GB; use 4 for 8 GB Macs
- max prompt length: 256 tokens
"""

from __future__ import annotations

import logging
import subprocess
import sys
import tempfile
from pathlib import Path

log = logging.getLogger("apis_worker.inference")

# Defaults tuned for M3 Pro 18 GB. Override via env vars in worker config.
DEFAULT_STEPS = 4
DEFAULT_QUANTIZE = 8
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024
MAX_PROMPT_CHARS = 1024  # mflux clips internally; we sanity-check before exec

# Pinned to the venv's binary so we don't accidentally pick up a system mflux.
MFLUX_BIN: Path = Path(sys.executable).parent / "mflux-generate"


def run_inference(
    prompt: str,
    seed: int = 42,
    steps: int = DEFAULT_STEPS,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    quantize: int = DEFAULT_QUANTIZE,
) -> bytes:
    """Generate a Flux Schnell image; return raw PNG bytes.

    Blocks for the duration of the inference (~5-15s on M3 Pro 8-bit).
    """
    if not MFLUX_BIN.exists():
        raise FileNotFoundError(
            f"mflux-generate not found at {MFLUX_BIN}. "
            "Re-run `pip install mflux` in the worker venv."
        )
    if len(prompt) > MAX_PROMPT_CHARS:
        raise ValueError(
            f"Prompt too long ({len(prompt)} chars > {MAX_PROMPT_CHARS})"
        )

    out_path = Path(tempfile.mktemp(suffix=".png"))
    cmd = [
        str(MFLUX_BIN),
        "--model", "schnell",
        "--quantize", str(quantize),
        "--prompt", prompt,
        "--steps", str(steps),
        "--width", str(width),
        "--height", str(height),
        "--seed", str(seed),
        "--output", str(out_path),
    ]
    log.info(
        "running mflux: steps=%d %dx%d quantize=%d-bit seed=%d prompt=%r",
        steps,
        width,
        height,
        quantize,
        seed,
        prompt[:60] + ("…" if len(prompt) > 60 else ""),
    )

    try:
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
        if proc.stderr:
            log.debug("mflux stderr: %s", proc.stderr.strip()[-500:])
        return out_path.read_bytes()
    except subprocess.CalledProcessError as exc:
        log.error("mflux failed (exit %d): %s", exc.returncode, exc.stderr)
        raise
    finally:
        out_path.unlink(missing_ok=True)
