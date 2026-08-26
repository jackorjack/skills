from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from markdownify import markdownify


class ReadStatus(StrEnum):
    SUCCESS = "SUCCESS"
    RETRYABLE = "RETRYABLE"
    NEED_VERIFY = "NEED_VERIFY"
    EMPTY = "EMPTY"
    UNSUPPORTED = "UNSUPPORTED"


VERIFY_MARKERS = (
    "当前环境异常",
    "环境异常",
    "完成验证",
    "安全验证",
    "拖动下方滑块",
    "访问过于频繁",
    "操作频繁",
    "请进行验证",
)

# Ordered: try specific article containers first, fall back to body
CONTENT_SELECTORS = (
    "#js_content",                          # WeChat
    "article",
    ".article-content",
    ".post-content",
    ".article-body",
    ".rich_media_content",
    ".content",
    "main",
    ".main-content",
    ".post-body",
    ".entry-content",
    ".detail-content",
    "#content",
    "body",
)

TITLE_SELECTORS = (
    "#activity-name",
    "h1.rich_media_title",
    "h1.article-title",
    "h1.post-title",
    "h1.entry-title",
    "h1",
    "h2",
)


@dataclass
class ReadResult:
    status: ReadStatus
    requested_url: str
    final_url: str | None = None
    title: str | None = None
    account: str | None = None
    author: str | None = None
    published_at: str | None = None
    content_html: str | None = None
    content_markdown: str | None = None
    artifact_dir: str | None = None
    screenshot: str | None = None
    message: str | None = None
    observed_markers: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["status"] = self.status.value
        return data


def validate_url(url: str) -> tuple[bool, str | None]:
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        return False, f"Invalid URL: {exc}"

    if parsed.scheme not in ("http", "https"):
        return False, "Only HTTP/HTTPS URLs are supported"
    if parsed.username or parsed.password or port not in (None, 80, 443):
        return False, "Credentials and non-standard ports are not supported"
    return True, None


def _first_text(soup: BeautifulSoup, selectors: tuple[str, ...]) -> str | None:
    for selector in selectors:
        node = soup.select_one(selector)
        if node:
            value = " ".join(node.get_text(" ", strip=True).split())
            if value and len(value) > 2:
                return value
    return None


def _meta(soup: BeautifulSoup, *keys: tuple[str, str]) -> str | None:
    for attr, value in keys:
        node = soup.find("meta", attrs={attr: value})
        if node and node.get("content"):
            return str(node["content"]).strip() or None
    return None


def detect_verification(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    markers = [marker for marker in VERIFY_MARKERS if marker in text]
    challenge_selectors = (
        "#tcaptcha_iframe_dy",
        "iframe[src*='captcha']",
        ".tcaptcha-transform",
        "#verify_container",
    )
    if any(soup.select_one(selector) for selector in challenge_selectors):
        markers.append("captcha_element")
    return list(dict.fromkeys(markers))


def parse_article(html: str) -> dict[str, str | None]:
    """Generic article parser that works across platforms."""
    soup = BeautifulSoup(html, "html.parser")

    # Extract title
    title = _first_text(soup, TITLE_SELECTORS) or _meta(
        soup,
        ("property", "og:title"),
        ("name", "twitter:title"),
        ("name", "title"),
    )

    # Extract meta info
    author = _first_text(soup, ("#js_author_name", ".rich_media_meta_text", ".author", ".byline")) or _meta(
        soup, ("name", "author"), ("property", "article:author")
    )
    published_at = _first_text(soup, ("#publish_time", "em.rich_media_meta_text", "time", ".publish-time")) or _meta(
        soup, ("property", "article:published_time"), ("name", "pubdate")
    )

    # Extract content using ordered selectors
    content = None
    for selector in CONTENT_SELECTORS:
        content = soup.select_one(selector)
        if content:
            break

    if content is None:
        content = soup

    # Remove nav, footer, sidebar, scripts, styles from content
    for tag in content.select(
        "script, style, noscript, iframe, nav, footer, .sidebar, .nav, .navigation, "
        ".header, .footer, .recommend, .related, .comment, .comments, .ad, .advertisement"
    ):
        tag.decompose()

    content_html = str(content)
    content_markdown = markdownify(
        content_html,
        heading_style="ATX",
        bullets="-",
        strip=["script", "style", "noscript"],
    ).strip()

    return {
        "title": title,
        "account": None,  # kept for backward compat
        "author": author,
        "published_at": published_at,
        "content_html": content_html,
        "content_markdown": content_markdown,
    }


def _slug(value: str) -> str:
    value = re.sub(r"[^0-9A-Za-z._-]+", "-", value).strip("-.")
    return value[:80] or "article"


def _artifact_directory(root: Path, title: str | None) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    path = root / f"{timestamp}-{_slug(title or 'article')}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def _write_artifacts(
    root: Path,
    result: ReadResult,
    raw_html: str | None,
    page: Any | None = None,
) -> None:
    artifact_dir = _artifact_directory(root, result.title)
    result.artifact_dir = str(artifact_dir.resolve())
    if raw_html is not None:
        (artifact_dir / "raw.html").write_text(raw_html, encoding="utf-8")
    if result.content_html is not None:
        (artifact_dir / "content.html").write_text(result.content_html, encoding="utf-8")
    if result.content_markdown is not None:
        (artifact_dir / "article.md").write_text(result.content_markdown, encoding="utf-8")
    if result.status == ReadStatus.NEED_VERIFY and page is not None:
        screenshot = artifact_dir / "verification.png"
        try:
            page.screenshot(path=str(screenshot), full_page=True)
            result.screenshot = str(screenshot.resolve())
        except Exception as exc:
            result.message = f"{result.message or 'Verification required'}; screenshot failed: {exc}"
    (artifact_dir / "result.json").write_text(
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
    )


def read_article(
    url: str,
    *,
    profile_dir: Path,
    archive_root: Path,
    timeout_ms: int = 45_000,
    headless: bool = True,
    ignore_ssl: bool = False,
) -> ReadResult:
    valid, reason = validate_url(url)
    if not valid:
        return ReadResult(status=ReadStatus.UNSUPPORTED, requested_url=url, message=reason)

    profile_dir.mkdir(parents=True, exist_ok=True)
    archive_root.mkdir(parents=True, exist_ok=True)
    page = None
    raw_html = None
    result = ReadResult(status=ReadStatus.RETRYABLE, requested_url=url)

    try:
        from camoufox.addons import DefaultAddons
        from camoufox.sync_api import Camoufox

        with Camoufox(
            headless=headless,
            persistent_context=True,
            user_data_dir=str(profile_dir.resolve()),
            locale="zh-CN",
            humanize=True,
            enable_cache=True,
            exclude_addons=[DefaultAddons.UBO],
            ignore_https_errors=ignore_ssl,
        ) as browser:
            page = browser.new_page()
            page.set_default_timeout(timeout_ms)
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(1_500)
            result.final_url = page.url
            raw_html = page.content()

            markers = detect_verification(raw_html)
            verification_redirect = "/mp/wappoc_appmsgcaptcha" in result.final_url

            if verification_redirect or (markers and "captcha_element" in markers):
                result.status = ReadStatus.NEED_VERIFY
                result.observed_markers = markers
                if verification_redirect:
                    result.observed_markers.append("verification_redirect")
                result.message = "Verification required; no bypass was attempted"
            else:
                parsed = parse_article(raw_html)
                if parsed.get("content_markdown") and len(parsed["content_markdown"]) > 100:
                    result.status = ReadStatus.SUCCESS
                    for key, value in parsed.items():
                        setattr(result, key, value)
                else:
                    result.status = ReadStatus.EMPTY
                    result.message = "Page loaded but extracted content is too short or empty"

            _write_artifacts(archive_root, result, raw_html, page)
    except Exception as exc:
        result.status = ReadStatus.RETRYABLE
        result.message = f"{type(exc).__name__}: {exc}"
        print(result.message, file=sys.stderr)
        try:
            _write_artifacts(archive_root, result, raw_html, page)
        except Exception as archive_exc:
            print(f"Could not archive failed attempt: {archive_exc}", file=sys.stderr)
    return result