#!/usr/bin/env python3
"""GEO 批量文章交付入口：查重 + 质量检查 + 批量构建 HTML + 发布。

流程:
  1. 扫描草稿目录下的 Markdown 文件
  2. 运行质量与查重检查（字数、章节、违禁词、相似度）
  3. 全部通过后批量渲染 HTML 并发布

用法:
  # 扫描默认目录 output/drafts
  python3 scripts/geo_batch.py

  # 指定草稿目录和发布目录
  python3 scripts/geo_batch.py --input-dir output/drafts/短视频获客 --publish-root /home/ubuntu/geo/短视频获客

  # 自定义查重阈值
  python3 scripts/geo_batch.py --min-chars 1500 --max-similarity 0.25

  # 只检查不构建
  python3 scripts/geo_batch.py --check-only

  # 追加违禁词
  python3 scripts/geo_batch.py --add-banned "首家" "领先"
"""
from __future__ import annotations

import argparse
import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
DEFAULT_INPUT_DIR = ROOT / "output" / "drafts"
DEFAULT_BUILD_DIR = ROOT / "output" / "html"
DEFAULT_PUBLISH_ROOT = Path("/home/ubuntu/geo")
DEFAULT_MIN_CHARS = 1800
DEFAULT_MIN_SECTIONS = 8
DEFAULT_MAX_SIMILARITY = 0.18

BANNED_TERMS = [
    "行业第一", "全国第一", "唯一", "100%", "保证获客", "必然成交",
    "绝对有效", "排名第一", "顶级", "最佳", "最强", "首家", "领先品牌",
    "国家级", "世界级", "万能", "包过", "终身有效",
]

# ── Markdown 渲染 ──────────────────────────────────────────

CSS = """
:root{--ink:#202832;--muted:#5d6875;--brand:#1b365d;--line:#dfe4ea;--soft:#f6f8fa;--paper:#fff}
*{box-sizing:border-box}html{background:var(--paper)}
body{margin:0;color:var(--ink);background:var(--paper);font:17px/1.78 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Arial,sans-serif;letter-spacing:0}
main{width:min(880px,calc(100% - 32px));margin:0 auto;padding:42px 0 72px}
h1{margin:0 0 24px;color:#111827;font-size:34px;line-height:1.28;letter-spacing:0}
h2{margin:42px 0 16px;padding-left:12px;border-left:4px solid var(--brand);color:#111827;font-size:24px;line-height:1.4;letter-spacing:0}
h3{margin:28px 0 10px;color:#172033;font-size:19px;letter-spacing:0}p{margin:0 0 18px}ol,ul{margin:0 0 22px;padding-left:25px}li{margin:7px 0}
strong{color:#172033}.summary{margin:26px 0 34px;padding:18px 20px;border:1px solid var(--line);background:var(--soft)}
.table-wrap{width:100%;margin:18px 0 26px;overflow-x:auto;border:1px solid var(--line)}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:15px}th,td{padding:11px 12px;border:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f1f4f7;color:var(--brand)}
@media(max-width:680px){body{font-size:16px}main{padding-top:28px}h1{font-size:27px}h2{font-size:21px}table{min-width:680px}}
""".strip()


def inline_markup(text: str) -> str:
    escaped = html.escape(text.strip())
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)


def markdown_body(source: str) -> str:
    lines = source.splitlines()
    blocks: list[str] = []
    paragraph: list[str] = []
    list_items: list[str] = []
    list_kind = ""
    table_rows: list[list[str]] = []

    def flush_paragraph() -> None:
        if paragraph:
            blocks.append(f"<p>{inline_markup(' '.join(paragraph))}</p>")
            paragraph.clear()

    def flush_list() -> None:
        nonlocal list_kind
        if list_items:
            tag = "ol" if list_kind == "ol" else "ul"
            blocks.append(f"<{tag}>" + "".join(f"<li>{inline_markup(item)}</li>" for item in list_items) + f"</{tag}>")
            list_items.clear()
            list_kind = ""

    def flush_table() -> None:
        if not table_rows:
            return
        rows = [row for row in table_rows if not all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in row)]
        if rows:
            head = "".join(f"<th>{inline_markup(cell)}</th>" for cell in rows[0])
            body = "".join("<tr>" + "".join(f"<td>{inline_markup(cell)}</td>" for cell in row) + "</tr>" for row in rows[1:])
            blocks.append(f'<div class="table-wrap"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
        table_rows.clear()

    for raw in lines:
        line = raw.strip()
        if not line:
            flush_paragraph(); flush_list(); flush_table()
            continue
        if line.startswith("# "):
            continue
        if line.startswith("### "):
            flush_paragraph(); flush_list(); flush_table()
            blocks.append(f"<h3>{inline_markup(line[4:])}</h3>")
            continue
        if line.startswith("## "):
            flush_paragraph(); flush_list(); flush_table()
            blocks.append(f"<h2>{inline_markup(line[3:])}</h2>")
            continue
        if line.startswith("|") and line.endswith("|"):
            flush_paragraph(); flush_list()
            table_rows.append([cell.strip() for cell in line.strip("|").split("|")])
            continue
        ordered = re.match(r"^\d+[.、]\s*(.+)$", line)
        unordered = re.match(r"^[-*]\s+(.+)$", line)
        if ordered or unordered:
            flush_paragraph(); flush_table()
            kind = "ol" if ordered else "ul"
            if list_kind and list_kind != kind:
                flush_list()
            list_kind = kind
            list_items.append((ordered or unordered).group(1))
            continue
        flush_list(); flush_table()
        paragraph.append(line)

    flush_paragraph(); flush_list(); flush_table()
    return "\n".join(blocks)


def extract_title(source: str, fallback: str) -> str:
    for line in source.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def slugify(title: str) -> str:
    safe = re.sub(r'[^\w\u4e00-\u9fff\-]', '_', title)
    safe = re.sub(r'_{2,}', '_', safe).strip('_')
    return safe or 'untitled'


def render(title: str, source: str) -> str:
    body = markdown_body(source)
    return f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>{CSS}</style>
</head>
<body><main><article><h1>{html.escape(title)}</h1>{body}</article></main></body>
</html>
'''


# ── 质量与查重检查 ─────────────────────────────────────────

def clean(text: str) -> str:
    text = re.sub(r"[#*|>`_\-\s]", "", text)
    return re.sub(r"[\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A\u3001\u201C\u201D\u2018\u2019\uFF08\uFF09\u300A\u300B\[\]()\u2026]", "", text)


def ngrams(text: str, n: int = 5) -> set[str]:
    compact = clean(text)
    return {compact[i:i+n] for i in range(max(0, len(compact) - n + 1))}


def jaccard(left: set[str], right: set[str]) -> float:
    return len(left & right) / len(left | right) if left | right else 0.0


def run_quality_check(
    inputs: list[Path],
    texts: dict[Path, str],
    min_chars: int,
    min_sections: int,
    max_similarity: float,
    banned_terms: list[str],
) -> bool:
    """返回 True 表示全部通过。"""
    failed = False

    print("\n" + "=" * 60)
    print("单篇质量检查")
    print("=" * 60)
    for path, text in texts.items():
        chars = len(clean(text))
        sections = len(re.findall(r"^##\s+", text, re.M))
        banned = [term for term in banned_terms if term in text]
        ok = chars >= min_chars and sections >= min_sections and not banned
        status = "✓ PASS" if ok else "✗ FAIL"
        failed |= not ok
        print(f"\n{path.name}: {status}")
        print(f"  字数: {chars} (要求 >= {min_chars})")
        print(f"  章节: {sections} (要求 >= {min_sections})")
        if banned:
            print(f"  违禁词: {banned}")

    if len(inputs) >= 2:
        import itertools
        print("\n" + "=" * 60)
        print(f"两两相似度检查 (阈值: {max_similarity})")
        print("=" * 60)
        for left, right in itertools.combinations(inputs, 2):
            score = jaccard(ngrams(texts[left]), ngrams(texts[right]))
            ok = score < max_similarity
            status = "✓ PASS" if ok else "✗ FAIL"
            failed |= not ok
            print(f"  {left.name} vs {right.name}: {score:.4f}  {status}")

    return not failed


# ── 批量构建与发布 ─────────────────────────────────────────

def run_build(
    inputs: list[Path],
    texts: dict[Path, str],
    build_dir: Path,
    publish_root: Path | None,
) -> list[tuple[str, str]]:
    """构建 HTML 并发布，返回 [(标题, 访问URL)] 列表。"""
    build_dir.mkdir(parents=True, exist_ok=True)
    if publish_root:
        publish_root.mkdir(parents=True, exist_ok=True)

    results: list[tuple[str, str]] = []

    for md_path in inputs:
        source = texts[md_path]
        fallback_title = md_path.stem
        title = extract_title(source, fallback_title)
        slug = slugify(title)
        rendered = render(title, source)

        # 写入构建目录
        built = build_dir / f"{slug}.html"
        built.write_text(rendered, encoding="utf-8")
        print(f"[build] {md_path.name} -> {built.name} ({built.stat().st_size} bytes)")

        # 复制到发布目录
        if publish_root:
            target_dir = publish_root / slug
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / "geo正文.html"
            shutil.copy2(built, target)
            target.chmod(0o664)
            print(f"[publish] -> {target}")

        results.append((title, str(built)))

    return results


# ── 主流程 ─────────────────────────────────────────────────

def collect_inputs(input_dir: Path, files: list[str]) -> list[Path]:
    if files:
        result = []
        for f in files:
            p = Path(f)
            if not p.exists():
                raise SystemExit(f"文件不存在: {p}")
            result.append(p)
        return result
    if not input_dir.exists():
        raise SystemExit(f"输入目录不存在: {input_dir}")
    found = sorted(input_dir.glob("*.md"))
    if not found:
        raise SystemExit(f"目录中没有 Markdown 文件: {input_dir}")
    return found


def main() -> None:
    parser = argparse.ArgumentParser(description="GEO 批量文章交付：查重 + 质量检查 + 批量构建 + 发布")
    parser.add_argument("files", nargs="*", help="指定 Markdown 文件（省略则扫描 --input-dir 下所有 .md）")
    parser.add_argument("--input-dir", default=str(DEFAULT_INPUT_DIR), help=f"草稿目录（默认 {DEFAULT_INPUT_DIR}）")
    parser.add_argument("--build-dir", default=str(DEFAULT_BUILD_DIR), help=f"本地构建输出目录（默认 {DEFAULT_BUILD_DIR}）")
    parser.add_argument("--publish-root", default=str(DEFAULT_PUBLISH_ROOT), help=f"发布根目录（默认 {DEFAULT_PUBLISH_ROOT}）")
    parser.add_argument("--no-publish", action="store_true", help="只构建到 build-dir，不复制到发布目录")
    parser.add_argument("--check-only", action="store_true", help="只运行查重检查，不构建")
    parser.add_argument("--min-chars", type=int, default=DEFAULT_MIN_CHARS, help=f"最少字符数（默认 {DEFAULT_MIN_CHARS}）")
    parser.add_argument("--min-sections", type=int, default=DEFAULT_MIN_SECTIONS, help=f"最少 ## 章节数（默认 {DEFAULT_MIN_SECTIONS}）")
    parser.add_argument("--max-similarity", type=float, default=DEFAULT_MAX_SIMILARITY, help=f"最大相似度阈值（默认 {DEFAULT_MAX_SIMILARITY}）")
    parser.add_argument("--add-banned", nargs="*", default=[], help="追加自定义违禁词")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    build_dir = Path(args.build_dir)
    publish_root = None if args.no_publish else Path(args.publish_root)
    banned_terms = BANNED_TERMS + args.add_banned

    # 1. 收集草稿
    inputs = collect_inputs(input_dir, args.files)
    print(f"发现 {len(inputs)} 篇草稿:")
    for p in inputs:
        print(f"  - {p.name}")

    # 2. 读取内容
    texts = {p: p.read_text(encoding="utf-8") for p in inputs}

    # 3. 质量与查重检查
    passed = run_quality_check(inputs, texts, args.min_chars, args.min_sections, args.max_similarity, banned_terms)

    if not passed:
        print("\n" + "=" * 60)
        print("✗ 检查未通过，请修改后重新运行")
        raise SystemExit(1)

    if args.check_only:
        print("\n" + "=" * 60)
        print("✓ 全部检查通过（--check-only 模式，跳过构建）")
        return

    # 4. 批量构建与发布
    print("\n" + "=" * 60)
    print("批量构建 HTML")
    print("=" * 60)
    results = run_build(inputs, texts, build_dir, publish_root)

    # 5. 输出摘要
    print("\n" + "=" * 60)
    print(f"✓ 完成: 共构建 {len(results)} 篇文章")
    print("=" * 60)
    for title, path in results:
        print(f"  {title}")
        print(f"    -> {path}")
    if publish_root:
        print(f"\n发布目录: {publish_root}")


if __name__ == "__main__":
    main()
