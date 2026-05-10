"""First-run mflux sanity test.

Loads Flux Schnell at 8-bit quantization (good fit for M3 Pro 18 GB),
generates a single 512x512 image, saves it to /tmp/apis_test_mflux.png.

The first run downloads ~12 GB of Flux weights from HuggingFace into
~/.cache/huggingface/. Subsequent runs are fast (model is cached).
"""

import os
import time
import sys

# Speed up HuggingFace downloads (uses hf-transfer for parallel downloading).
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")

from mflux import Flux1, Config

PROMPT = "a hex-shaped neon bee, cyberpunk swarm aesthetic, on pitch black"
OUT = "/tmp/apis_test_mflux.png"

print("[apis-worker] Loading Flux Schnell (model_name='schnell', 8-bit quant)…")
print("[apis-worker] First run downloads ~12 GB to ~/.cache/huggingface/.")
sys.stdout.flush()

t0 = time.time()
flux = Flux1.from_name(model_name="schnell", quantize=8)
print(f"[apis-worker] Model loaded in {time.time() - t0:.1f}s")
sys.stdout.flush()

print(f"[apis-worker] Generating: '{PROMPT}'")
print("[apis-worker] 512x512 · 4 inference steps · seed=42")
sys.stdout.flush()

t1 = time.time()
image = flux.generate_image(
    seed=42,
    prompt=PROMPT,
    config=Config(
        num_inference_steps=4,
        height=512,
        width=512,
    ),
)
print(f"[apis-worker] Generated in {time.time() - t1:.1f}s")

image.save(path=OUT)
print(f"[apis-worker] ✓ Saved to {OUT}")
print(f"[apis-worker] Total time: {time.time() - t0:.1f}s")
