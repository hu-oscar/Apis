"""CLI entry point — `python -m apis_worker` runs the WebSocket loop."""

import asyncio
import logging

from dotenv import load_dotenv

from .listener import listen_for_jobs


def run() -> None:
    """Start the worker; runs until Ctrl+C."""
    # Auto-load packages/worker/.env (PINATA_JWT, HF_TOKEN, etc.).
    load_dotenv()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    try:
        asyncio.run(listen_for_jobs())
    except KeyboardInterrupt:
        # Clean exit on Ctrl+C; asyncio raises this through the gather.
        print("\n[apis-worker] shutting down")


if __name__ == "__main__":
    run()
