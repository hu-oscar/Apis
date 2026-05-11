"""One-shot mflux benchmark — Sprint 2.10 of Phase 1.5.

Generates a single Flux Schnell image with a canned prompt + seed,
times the run, and prints a parseable summary to stdout. The Tauri
provider app shells this in to suggest a per-job price based on
observed throughput.

Output (always last, single line):
    BENCHMARK_RESULT seconds_per_image=N.NN steps=N width=N height=N quantize=N

The first invocation on a fresh machine triggers a model download
from HuggingFace (~12 GB), which can take several minutes. After
that, mflux loads from the local cache and a benchmark run is the
same cost as a real inference (~5-15s on Apple Silicon).

Usage:
    python -m apis_worker.benchmark            # default 1024x1024
    python -m apis_worker.benchmark --quick     # 512x512 (faster sanity)
"""

from __future__ import annotations

import argparse
import sys
import time

from .inference import (
    DEFAULT_HEIGHT,
    DEFAULT_QUANTIZE,
    DEFAULT_STEPS,
    DEFAULT_WIDTH,
    run_inference,
)

# Deterministic prompt + seed → reproducible timing across runs on
# the same hardware. The seed is the canonical "Apis benchmark seed"
# so we can compare across machines too.
BENCHMARK_PROMPT = "a sunset over a city skyline, neon lights, ultra detailed"
BENCHMARK_SEED = 31415


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="apis_worker.benchmark",
        description="Time a single Flux Schnell generation.",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Use 512x512 instead of the default 1024 for a faster ~3-5s run.",
    )
    parser.add_argument(
        "--quantize",
        type=int,
        default=DEFAULT_QUANTIZE,
        choices=[4, 8],
        help="Quantization in bits (8 = 18 GB+ RAM, 4 = 8 GB RAM Macs).",
    )
    args = parser.parse_args()

    width = 512 if args.quick else DEFAULT_WIDTH
    height = 512 if args.quick else DEFAULT_HEIGHT
    steps = DEFAULT_STEPS

    print(
        f"running benchmark: prompt={BENCHMARK_PROMPT!r} "
        f"steps={steps} {width}x{height} quantize={args.quantize}-bit "
        f"seed={BENCHMARK_SEED}",
        flush=True,
    )

    started = time.monotonic()
    try:
        png = run_inference(
            BENCHMARK_PROMPT,
            seed=BENCHMARK_SEED,
            steps=steps,
            width=width,
            height=height,
            quantize=args.quantize,
        )
    except FileNotFoundError as exc:
        # mflux-generate isn't installed — likely venv mismatch.
        print(f"BENCHMARK_ERROR {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # broad-by-design: subprocess can fail many ways
        print(f"BENCHMARK_ERROR {exc}", file=sys.stderr)
        return 1
    elapsed = time.monotonic() - started

    # Sanity-check: a generation that returned but produced no bytes is
    # almost certainly a silent mflux failure. Surface it rather than
    # report a misleading "0.5s per image" number.
    if not png:
        print("BENCHMARK_ERROR empty output PNG", file=sys.stderr)
        return 1

    # The parsed line — always the last line of stdout — uses a stable
    # `KEY=value KEY=value` format so the Rust caller can grep one key.
    print(
        f"BENCHMARK_RESULT seconds_per_image={elapsed:.2f} "
        f"steps={steps} width={width} height={height} "
        f"quantize={args.quantize} bytes={len(png)}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
