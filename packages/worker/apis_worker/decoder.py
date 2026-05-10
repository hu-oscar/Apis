"""Borsh decoders for apis_program events.

Anchor 1.0 emits events via the `emit!` macro, which produces log lines of
the form `Program data: <base64>`. The decoded base64 starts with an 8-byte
discriminator (sha256("event:<EventName>")[:8]) followed by the
borsh-serialized event payload.

The Anchor IDL JSON ships the discriminator bytes precomputed under
`events[].discriminator`, so we read them from the IDL at startup rather
than recomputing the sha256 ourselves. Field shapes are still hard-coded
here (matching the IDL `types[].fields`); see `decoder.py` tests in W2 if
the schema ever drifts.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from borsh_construct import I64, U64
from construct import Bytes, Struct

from .config import IDL_PATH


# ──────────────────────────────────────────────────────────────────────
# Borsh layouts (must match programs/apis_program/src/events.rs).
# Pubkey = 32 raw bytes (no length prefix). [u8; 32] also = 32 raw bytes.
# ──────────────────────────────────────────────────────────────────────

_JOB_CREATED_LAYOUT = Struct(
    "job" / Bytes(32),
    "buyer" / Bytes(32),
    "provider" / Bytes(32),
    "spec_hash" / Bytes(32),
    "price_lamports_usdc" / U64,
    "funded_at" / I64,
    "deadline" / I64,
)

_PROVIDER_REGISTERED_LAYOUT = Struct(
    "provider" / Bytes(32),
    "authority" / Bytes(32),
    "gpu_specs_hash" / Bytes(32),
    "endpoint_uri_hash" / Bytes(32),
    "registered_at" / I64,
)


@dataclass(frozen=True)
class EventDecoder:
    """Maps an Anchor event discriminator to a name + parser."""

    name: str
    discriminator: bytes  # 8 bytes
    parse: Callable[[bytes], dict]


def _to_dict(parsed) -> dict:
    """construct returns a Container; convert to a plain dict (drop _io)."""
    return {k: v for k, v in parsed.items() if not k.startswith("_")}


def load_event_decoders(idl_path: Path = IDL_PATH) -> list[EventDecoder]:
    """Load discriminators from the IDL and pair them with the static layouts.

    Raises FileNotFoundError with a hint if the IDL is missing — the most
    common cause is forgetting to run `anchor build` in packages/program.
    """
    if not idl_path.exists():
        raise FileNotFoundError(
            f"IDL not found at {idl_path}. "
            "Run `cd packages/program && anchor build` first."
        )
    with idl_path.open("r", encoding="utf-8") as f:
        idl = json.load(f)

    layouts_by_name = {
        "JobCreated": _JOB_CREATED_LAYOUT,
        "ProviderRegistered": _PROVIDER_REGISTERED_LAYOUT,
    }
    decoders: list[EventDecoder] = []
    for event in idl.get("events", []):
        name = event["name"]
        layout = layouts_by_name.get(name)
        if layout is None:
            # Unknown event type — skip rather than crash so future events
            # added to the IDL don't break the worker until we update it.
            continue
        disc = bytes(event["discriminator"])
        decoders.append(
            EventDecoder(
                name=name,
                discriminator=disc,
                parse=lambda payload, _layout=layout: _to_dict(_layout.parse(payload)),
            )
        )
    return decoders


def try_decode_event(
    payload: bytes, decoders: list[EventDecoder]
) -> tuple[str, dict] | None:
    """Decode an Anchor event payload (discriminator + body) if recognised.

    Returns `(event_name, fields)` on success, `None` if the discriminator
    doesn't match any known event.
    """
    if len(payload) < 8:
        return None
    disc, body = payload[:8], payload[8:]
    for d in decoders:
        if d.discriminator == disc:
            try:
                return d.name, d.parse(body)
            except Exception as exc:  # malformed payload — surface but don't crash
                return d.name, {"_decode_error": repr(exc)}
    return None
