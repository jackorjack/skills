#!/usr/bin/env python3
"""Resumable, official-source installer for the Camoufox browser.

No browser version is hard-coded. The installed ``camoufox`` package decides which build to
install, exactly as ``python -m camoufox fetch`` would, so the browser always matches the
library. This script only replaces that command's single-connection download with a
resumable, multi-connection one from GitHub's release CDN, validates the archive, and hands
it to the library's own installer (layout, checksum, metadata).

If the GitHub API rate limit (HTTP 403) is hit while the release is looked up, retry later or
set GITHUB_TOKEN.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import stat
import tempfile
import threading
import time
from pathlib import Path, PurePosixPath
from typing import IO
from urllib.parse import urljoin, urlsplit
from zipfile import ZipFile

import requests
from camoufox.pkgman import INSTALL_DIR, CamoufoxFetcher, launch_path


ALLOWED_SCHEMES = ("https",)
# github.com hands release downloads to a signed URL on one of these hosts; follow no other.
REDIRECT_HOSTS = ("github.com",)
DOWNLOAD_HOSTS = ("release-assets.githubusercontent.com", "objects.githubusercontent.com")
ARCHIVE_NAME = re.compile(r"[A-Za-z0-9._-]+\.zip")
MAX_REDIRECTS = 3
SPACE_MARGIN = 256 * 1024 * 1024


class OfficialAsset:
    """One release archive; hands out short-lived signed URLs on GitHub's download host."""

    def __init__(self, url: str) -> None:
        self.url = url
        self._lock = threading.Lock()
        self._signed_url: str | None = None
        self._signed_at = 0.0

    def signed_url(self, *, force: bool = False) -> str:
        with self._lock:
            if not force and self._signed_url and time.monotonic() - self._signed_at < 40 * 60:
                return self._signed_url
            self._signed_url = self._resolve()
            self._signed_at = time.monotonic()
            return self._signed_url

    def _resolve(self) -> str:
        current = self.url
        for _ in range(MAX_REDIRECTS):
            parts = urlsplit(current)
            if parts.scheme not in ALLOWED_SCHEMES:
                raise RuntimeError(f"Refusing non-HTTPS release URL (host {parts.hostname})")
            if parts.hostname in DOWNLOAD_HOSTS:
                return current
            if parts.hostname not in REDIRECT_HOSTS:
                raise RuntimeError(f"Release URL points at an unexpected host: {parts.hostname}")
            response = requests.get(current, allow_redirects=False, stream=True, timeout=30)
            response.close()
            location = response.headers.get("location")
            if response.status_code not in (301, 302, 303, 307, 308) or not location:
                raise RuntimeError(
                    f"Release URL did not redirect to a download host (HTTP {response.status_code})"
                )
            current = urljoin(current, location)
        raise RuntimeError("Release URL redirected too many times")


def probe_size(asset: OfficialAsset) -> int:
    """Archive size as reported by the download host itself (also proves it honours Range)."""
    response = requests.get(
        asset.signed_url(), headers={"Range": "bytes=0-0"}, stream=True, timeout=30
    )
    try:
        if response.status_code != 206:
            raise RuntimeError(f"Download host ignores Range requests (HTTP {response.status_code})")
        match = re.fullmatch(r"bytes 0-0/(\d+)", response.headers.get("content-range", ""))
        if not match:
            raise RuntimeError("Download host sent no usable Content-Range")
        return int(match.group(1))
    finally:
        response.close()


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


def download(asset: OfficialAsset, output: Path, total: int, workers: int) -> None:
    # Keyed by archive name and size, so leftovers of another release are never resumed into this one.
    parts_dir = output.parent / f"{output.name}.{total}.parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    chunk = (total + workers - 1) // workers
    jobs: list[tuple[Path, int, int]] = []
    for index in range(workers):
        start = index * chunk
        if start >= total:
            break
        end = min(start + chunk - 1, total - 1)
        jobs.append((parts_dir / f"part.{index:03d}", start, end))

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as executor:
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
    if temporary.stat().st_size != total:
        raise RuntimeError(f"Assembled size is {temporary.stat().st_size}, expected {total}")
    temporary.replace(output)
    shutil.rmtree(parts_dir)


def validate_zip(archive: Path, expected_size: int) -> int:
    if archive.stat().st_size != expected_size:
        raise RuntimeError(f"Archive size is {archive.stat().st_size}, expected {expected_size}")
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


def check_free_space(needs: list[tuple[Path, int]]) -> None:
    """Each entry is (directory, bytes needed there); directories on one device are summed."""
    per_device: dict[int, list] = {}
    for directory, needed in needs:
        entry = per_device.setdefault(directory.stat().st_dev, [directory, 0])
        entry[1] += needed
    for directory, needed in per_device.values():
        free = shutil.disk_usage(directory).free
        if free < needed + SPACE_MARGIN:
            raise RuntimeError(
                f"Insufficient space under {directory}: {free} bytes free, "
                f"need at least {needed + SPACE_MARGIN}"
            )


class AcceleratedFetcher(CamoufoxFetcher):
    """CamoufoxFetcher whose package download is resumable and multi-connection.

    Every library generation calls ``download_file(temp_file, url)`` and then verifies,
    extracts and records the install itself, so replacing just that step keeps the library's
    own layout, checksum and metadata handling.
    """

    def __init__(self, download_dir: Path, workers: int) -> None:
        self.download_dir = download_dir
        self.workers = workers
        self.archive: Path | None = None
        super().__init__()

    def download_file(self, file: IO[bytes], url: str) -> IO[bytes]:  # type: ignore[override]
        name = Path(urlsplit(url).path).name
        if not ARCHIVE_NAME.fullmatch(name):
            raise RuntimeError(f"Unexpected archive name in release URL: {name!r}")
        archive = self.download_dir / name
        asset = OfficialAsset(url)
        total = probe_size(asset)
        if not archive.exists() or archive.stat().st_size != total:
            download(asset, archive, total, self.workers)
        try:
            uncompressed = validate_zip(archive, total)
        except Exception:
            # A bad archive must not be picked up again by the next run.
            archive.unlink(missing_ok=True)
            raise
        print(json.dumps({"archive_bytes": total, "uncompressed_bytes": uncompressed}))
        # The library stages the archive in a temporary file before extracting it.
        check_free_space([(self.download_dir, total), (INSTALL_DIR.parent, uncompressed)])
        self.archive = archive
        with archive.open("rb") as package:
            shutil.copyfileobj(package, file, length=1024 * 1024)
        file.flush()
        file.seek(0)
        return file


def resolve_fetcher(download_dir: Path, workers: int, attempts: int = 3) -> AcceleratedFetcher:
    """Let the library pick the build; retry transient failures of its GitHub lookup.

    The library tries a fallback repo after a failure and reports only the last error, so a
    network hiccup on the first repo can surface as an unrelated 404.
    """
    for attempt in range(1, attempts + 1):
        try:
            return AcceleratedFetcher(download_dir, workers)
        except requests.RequestException as exc:
            if exc.response is not None and exc.response.status_code == 403:
                raise SystemExit(
                    "GitHub API rate limit exceeded while looking up the release; "
                    "retry later or set GITHUB_TOKEN."
                ) from exc
            if attempt == attempts:
                raise
            print(f"release lookup attempt {attempt} failed ({type(exc).__name__}); retrying", flush=True)
            time.sleep(2 * attempt)
    raise AssertionError("unreachable")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument(
        "--download-dir", type=Path, default=Path.home() / ".cache" / "camoufox-download"
    )
    parser.add_argument("--keep-archive", action="store_true")
    parser.add_argument(
        "--dry-run", action="store_true", help="show which build would be installed, then exit"
    )
    args = parser.parse_args()
    if not 1 <= args.workers <= 32:
        parser.error("--workers must be between 1 and 32")

    args.download_dir.mkdir(parents=True, exist_ok=True)
    INSTALL_DIR.parent.mkdir(parents=True, exist_ok=True)
    # The library stages the archive in a NamedTemporaryFile; keep it off a small tmpfs /tmp.
    tempfile.tempdir = str(args.download_dir.resolve())

    fetcher = resolve_fetcher(args.download_dir, args.workers)
    if args.dry_run:
        size = probe_size(OfficialAsset(fetcher.url))
        print(json.dumps({"version": fetcher.verstr, "url": fetcher.url, "archive_bytes": size}))
        return 0

    fetcher.install()
    if fetcher.archive is not None and not args.keep_archive:
        fetcher.archive.unlink(missing_ok=True)
    executable = Path(launch_path())
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise RuntimeError(f"Camoufox executable is not usable: {executable}")
    print(
        json.dumps(
            {
                "installed": str(INSTALL_DIR),
                "executable": str(executable),
                "version": fetcher.verstr,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
