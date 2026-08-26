from __future__ import annotations

import argparse
import concurrent.futures
import os
import shutil
import time
import zipfile
from pathlib import Path

import requests


DEFAULT_URL = (
    "https://github.com/daijro/camoufox/releases/download/"
    "v135.0.1-beta.24/camoufox-135.0.1-beta.24-lin.x86_64.zip"
)
EXPECTED_SIZE = 712_711_368


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
            "User-Agent": "Mozilla/5.0 CamoufoxInstaller/1.0",
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--connections", type=int, default=16)
    args = parser.parse_args()

    output = args.output.resolve()
    parts = output.parent / f"{output.name}.parts"
    parts.mkdir(parents=True, exist_ok=True)
    chunk_size = (EXPECTED_SIZE + args.connections - 1) // args.connections

    jobs: list[tuple[Path, int, int]] = []
    for index in range(args.connections):
        start = index * chunk_size
        if start >= EXPECTED_SIZE:
            break
        end = min(EXPECTED_SIZE - 1, start + chunk_size - 1)
        jobs.append((parts / f"part-{index:03d}", start, end))

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = [pool.submit(download_part, args.url, path, start, end) for path, start, end in jobs]
        for future in concurrent.futures.as_completed(futures):
            future.result()

    assembling = output.with_suffix(output.suffix + ".assembling")
    with assembling.open("wb") as target:
        for path, _, _ in jobs:
            with path.open("rb") as source:
                shutil.copyfileobj(source, target, length=1024 * 1024)
    if assembling.stat().st_size != EXPECTED_SIZE:
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
