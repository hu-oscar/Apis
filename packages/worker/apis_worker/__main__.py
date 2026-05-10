"""CLI entry point — `python -m apis_worker` runs the WebSocket loop."""

import asyncio
import logging

from .listener import listen_for_jobs


def run() -> None:
    """Start the worker; runs until Ctrl+C."""
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
