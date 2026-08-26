from __future__ import annotations

import argparse
import json
from pathlib import Path

from .reader import ReadStatus, read_article


def build_parser() -> argparse.ArgumentParser:
    service_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Read any web article using Camoufox stealth browser (multi-platform fallback)"
    )
    parser.add_argument("url", help="Article URL to read")
    parser.add_argument(
        "--profile-dir",
        type=Path,
        default=Path.home() / ".cache" / "stealth-reader" / "profile",
        help="persistent Camoufox profile directory",
    )
    parser.add_argument(
        "--archive-dir",
        type=Path,
        default=service_root / "data" / "articles",
        help="directory for raw HTML, Markdown, screenshots, and status",
    )
    parser.add_argument("--timeout-ms", type=int, default=45_000)
    parser.add_argument(
        "--headed",
        action="store_true",
        help="show the browser (requires an existing graphical display)",
    )
    parser.add_argument(
        "--ignore-ssl",
        action="store_true",
        help="ignore SSL certificate errors (for sites with invalid certs)",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    result = read_article(
        args.url,
        profile_dir=args.profile_dir,
        archive_root=args.archive_dir,
        timeout_ms=args.timeout_ms,
        headless=not args.headed,
        ignore_ssl=args.ignore_ssl,
    )
    print(json.dumps(result.to_dict(), ensure_ascii=False))
    return 0 if result.status == ReadStatus.SUCCESS else 2


if __name__ == "__main__":
    raise SystemExit(main())