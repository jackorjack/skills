#!/usr/bin/env python3
"""Resumable, official-source installer for the pinned Camoufox browser."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shutil
import stat
import threading
import time
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

import requests
from camoufox.pkgman import CamoufoxFetcher, INSTALL_DIR, launch_path


REPOSITORY = "daijro/camoufox"
VERSION = "135.0.1"
RELEASE = "beta.24"
ASSET_NAME = f"camoufox-{VERSION}-{RELEASE}-lin.x86_64.zip"
EXPECTED_SIZE = 712_711_368
API_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/tags/v{VERSION}-{RELEASE}"
ACCEPT = "application/octet-stream"


class OfficialAsset:
    def __init__(self) -> None:
        response = requests.get(API_URL, timeout=30)
        response.raise_for_status()
        matches = [asset for asset in response.json()["assets"] if asset["name"] == ASSET_NAME]
        if len(matches) != 1:
            raise RuntimeError(f"Expected one official asset named {ASSET_NAME}, found {len(matches)}")
        self.data = matches[0]
        if self.data["size"] != EXPECTED_SIZE:
            raise RuntimeError(
                f"Official API size changed: {self.data['size']} != {EXPECTED_SIZE}"
            )
        self._lock = threading.Lock()
        self._signed_url: str | None = None
        self._signed_at = 0.0

    def signed_url(self, *, force: bool = False) -> str:
        with self._lock:
            if not force and self._signed_url and time.monotonic() - self._signed_at < 40 * 60:
                return self._signed_url
            response = requests.get(
                self.data["url"],
                headers={"Accept": ACCEPT},
                allow_redirects=False,
                timeout=30,
            )
            if response.status_code not in (301, 302, 303, 307, 308):
                raise RuntimeError(f"Official asset API returned HTTP {response.status_code}")
            location = response.headers.get("location")
            if not location or not location.startswith("https://release-assets.githubusercontent.com/"):
                raise RuntimeError("Official asset API returned an unexpected download host")
            self._signed_url = location
            self._signed_at = time.monotonic()
            return location


def download_part(
    asset: OfficialAsset,
    part_path: Path,
    start: int,
    end: int,
    attempts: int = 30,
) -> None:
    expected = end - start + 1
    if part_path.exists() and part_path.stat().st_size > expected:
        part_path.unlink()

    for attempt in range(1, attempts + 1):
        current = part_path.stat().st_size if part_path.exists() else 0
        if current == expected:
            return
        request_start = start + current
        try:
            response = requests.get(
                asset.signed_url(),
                headers={"Range": f"bytes={request_start}-{end}"},
                stream=True,
                timeout=(30, 180),
            )
            if response.status_code == 403:
                response.close()
                asset.signed_url(force=True)
                continue
            if response.status_code != 206:
                raise RuntimeError(f"Range request returned HTTP {response.status_code}")
            content_range = response.headers.get("content-range", "")
            if not content_range.startswith(f"bytes {request_start}-{end}/"):
                raise RuntimeError(f"Unexpected Content-Range: {content_range!r}")
            with part_path.open("ab") as output:
                for block in response.iter_content(256 * 1024):
                    if block:
                        output.write(block)
            response.close()
        except (OSError, requests.RequestException, RuntimeError) as exc:
            print(
                f"part {part_path.name} attempt {attempt}: {type(exc).__name__}: {exc}",
                flush=True,
            )
            time.sleep(min(attempt, 10))

    current = part_path.stat().st_size if part_path.exists() else 0
    raise RuntimeError(f"Part {part_path.name} incomplete: {current}/{expected}")


def download(asset: OfficialAsset, output: Path, workers: int) -> None:
    parts_dir = output.parent / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    chunk = (EXPECTED_SIZE + workers - 1) // workers
    jobs: list[tuple[Path, int, int]] = []
    for index in range(workers):
        start = index * chunk
        end = min(start + chunk - 1, EXPECTED_SIZE - 1)
        jobs.append((parts_dir / f"part.{index:03d}", start, end))

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(download_part, asset, path, start, end): path
            for path, start, end in jobs
        }
        for future in concurrent.futures.as_completed(futures):
            path = futures[future]
            future.result()
            print(f"{path.name} complete", flush=True)

    temporary = output.with_suffix(output.suffix + ".assembling")
    with temporary.open("wb") as assembled:
        for path, _, _ in jobs:
            with path.open("rb") as source:
                shutil.copyfileobj(source, assembled, length=1024 * 1024)
    if temporary.stat().st_size != EXPECTED_SIZE:
        raise RuntimeError(f"Assembled size is {temporary.stat().st_size}, expected {EXPECTED_SIZE}")
    temporary.replace(output)
    shutil.rmtree(parts_dir)


def validate_zip(archive: Path) -> int:
    if archive.stat().st_size != EXPECTED_SIZE:
        raise RuntimeError(f"Archive size is {archive.stat().st_size}, expected {EXPECTED_SIZE}")
    total_uncompressed = 0
    with ZipFile(archive) as package:
        for member in package.infolist():
            normalized = member.filename.replace("\\", "/")
            path = PurePosixPath(normalized)
            mode = member.external_attr >> 16
            if path.is_absolute() or ".." in path.parts or not path.parts:
                raise RuntimeError(f"Unsafe archive member path: {member.filename!r}")
            if stat.S_ISLNK(mode):
                raise RuntimeError(f"Archive contains a symbolic link: {member.filename!r}")
            total_uncompressed += member.file_size
        bad_member = package.testzip()
        if bad_member:
            raise RuntimeError(f"ZIP CRC failed for {bad_member}")
    return total_uncompressed


def install(archive: Path, uncompressed_size: int) -> None:
    free = shutil.disk_usage(INSTALL_DIR.parent).free
    if free < uncompressed_size + 256 * 1024 * 1024:
        raise RuntimeError(
            f"Insufficient space: {free} bytes free, need at least "
            f"{uncompressed_size + 256 * 1024 * 1024}"
        )
    fetcher = CamoufoxFetcher()
    if fetcher.version != VERSION or fetcher.release != RELEASE:
        raise RuntimeError(f"Package manager selected unexpected version {fetcher.verstr}")
    fetcher.cleanup()
    try:
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        with archive.open("rb") as package:
            fetcher.extract_zip(package)
        fetcher.set_version()
        for path in INSTALL_DIR.rglob("*"):
            path.chmod(path.stat().st_mode | stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    except Exception:
        fetcher.cleanup()
        raise
    executable = Path(launch_path())
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise RuntimeError(f"Camoufox executable is not usable: {executable}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument(
        "--download-dir", type=Path, default=Path.home() / ".cache" / "camoufox-download"
    )
    parser.add_argument("--keep-archive", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.workers <= 32:
        parser.error("--workers must be between 1 and 32")

    args.download_dir.mkdir(parents=True, exist_ok=True)
    archive = args.download_dir / ASSET_NAME
    asset = OfficialAsset()
    if not archive.exists() or archive.stat().st_size != EXPECTED_SIZE:
        download(asset, archive, args.workers)
    uncompressed_size = validate_zip(archive)
    print(json.dumps({"archive_bytes": EXPECTED_SIZE, "uncompressed_bytes": uncompressed_size}))
    install(archive, uncompressed_size)
    if not args.keep_archive:
        archive.unlink()
    print(json.dumps({"installed": str(INSTALL_DIR), "version": f"{VERSION}-{RELEASE}"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
