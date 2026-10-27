"""Parallel, resumable download of a Camoufox release archive.

No version is hard-coded. Without --url it downloads the build the installed camoufox library
pairs with (what ``python -m camoufox fetch`` installs); if the library cannot be imported it
falls back to the newest stable official Linux x86_64 release. The archive size is read from
the download host, not assumed.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import re
import shutil
import time
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

import requests


RELEASES_API = "https://api.github.com/repos/daijro/camoufox/releases"
LINUX_ASSET = re.compile(r"camoufox-.+-lin\.x86_64\.zip")
USER_AGENT = "Mozilla/5.0 CamoufoxInstaller/1.0"


def newest_stable_url() -> str:
    token = os.environ.get("GITHUB_TOKEN")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = requests.get(RELEASES_API, headers=headers, timeout=30)
    response.raise_for_status()
    for release in response.json():  # newest first
        if release.get("draft") or release.get("prerelease"):
            continue
        for asset in release["assets"]:
            if LINUX_ASSET.fullmatch(asset["name"]):
                return asset["browser_download_url"]
    raise RuntimeError("no stable Linux x86_64 Camoufox release found")


def default_url() -> str:
    try:
        from camoufox.pkgman import CamoufoxFetcher
    except ImportError:
        return newest_stable_url()
    return CamoufoxFetcher().url


def probe_size(url: str) -> int:
    """Archive size as reported by the download host (also proves it honours Range)."""
    headers = {"Range": "bytes=0-0", "User-Agent": USER_AGENT}
    with requests.get(url, headers=headers, stream=True, timeout=(20, 60)) as response:
        response.raise_for_status()
        match = re.fullmatch(r"bytes 0-0/(\d+)", response.headers.get("Content-Range", ""))
        if response.status_code != 206 or not match:
            raise RuntimeError(f"download host does not support Range requests (HTTP {response.status_code})")
        return int(match.group(1))


def download_part(url: str, path: Path, start: int, end: int) -> None:
    expected = end - start + 1
    for attempt in range(30):
        current = path.stat().st_size if path.exists() else 0
        if current == expected:
            return
        if current > expected:
            path.unlink()
            current = 0

        request_start = start + current
        headers = {
            "Range": f"bytes={request_start}-{end}",
            "User-Agent": USER_AGENT,
            "Accept": "application/octet-stream",
        }
        try:
            with requests.get(url, headers=headers, stream=True, timeout=(20, 90)) as response:
                response.raise_for_status()
                if response.status_code != 206:
                    raise RuntimeError(f"range request returned HTTP {response.status_code}")
                content_range = response.headers.get("Content-Range", "")
                if not content_range.startswith(f"bytes {request_start}-"):
                    raise RuntimeError(f"unexpected Content-Range: {content_range}")
                with path.open("ab") as handle:
                    for chunk in response.iter_content(1024 * 1024):
                        if chunk:
                            handle.write(chunk)
            if path.stat().st_size == expected:
                return
        except (OSError, requests.RequestException, RuntimeError) as exc:
            if attempt == 29:
                raise RuntimeError(f"part {path.name} failed: {exc}") from exc
            time.sleep(min(2 + attempt, 20))
    raise RuntimeError(f"part {path.name} did not complete")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--url", help="archive URL (default: the build matching the installed camoufox library)"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--connections", type=int, default=16)
    args = parser.parse_args()

    url = args.url or default_url()
    total = probe_size(url)
    shown = urlsplit(url)
    print(f"downloading {shown.netloc}{shown.path} ({total} bytes)", flush=True)

    output = args.output.resolve()
    # Keyed by size, so leftovers of another release are never resumed into this one.
    parts = output.parent / f"{output.name}.{total}.parts"
    parts.mkdir(parents=True, exist_ok=True)
    chunk_size = (total + args.connections - 1) // args.connections

    jobs: list[tuple[Path, int, int]] = []
    for index in range(args.connections):
        start = index * chunk_size
        if start >= total:
            break
        end = min(total - 1, start + chunk_size - 1)
        jobs.append((parts / f"part-{index:03d}", start, end))

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = [pool.submit(download_part, url, path, start, end) for path, start, end in jobs]
        for future in concurrent.futures.as_completed(futures):
            future.result()

    assembling = output.with_suffix(output.suffix + ".assembling")
    with assembling.open("wb") as target:
        for path, _, _ in jobs:
            with path.open("rb") as source:
                shutil.copyfileobj(source, target, length=1024 * 1024)
    if assembling.stat().st_size != total:
        raise RuntimeError("assembled file size does not match the GitHub release asset")
    with zipfile.ZipFile(assembling) as archive:
        bad_file = archive.testzip()
        if bad_file:
            raise RuntimeError(f"ZIP integrity check failed at {bad_file}")
    os.replace(assembling, output)
    shutil.rmtree(parts)
    print(f"complete: {output} ({output.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
