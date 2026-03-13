"""Simple static server for the Online version.

Why: the Online build is easiest to distribute as a normal website URL.
This server also avoids browser limitations around `file://` (CORS, module loading, etc.).

Run:
  python server.py --port 5177

Then open:
  http://localhost:5177/
"""

from __future__ import annotations

import argparse
import http.server
import os
import socketserver
from pathlib import Path


class NoCacheRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        # Make iteration easier while developing.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="Dev Cabin Image Cleaner static server")
    parser.add_argument("--port", type=int, default=5177)
    parser.add_argument(
        "--root",
        type=str,
        default=str(Path(__file__).resolve().parents[1] / "online"),
        help="Root folder to serve (default: ./online)",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"Root folder does not exist: {root}")

    os.chdir(root)
    with socketserver.TCPServer(("", args.port), NoCacheRequestHandler) as httpd:
        print(f"Serving {root} at http://localhost:{args.port}/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
