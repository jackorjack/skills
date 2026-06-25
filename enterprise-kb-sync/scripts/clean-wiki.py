#!/usr/bin/env python3
"""clean-wiki.py — 对同步后的 wiki/*.md 文件做自动清洗，提升 embedding 检索质量。

处理内容：
1. 自动加元数据头（front-matter），含 category/keywords 自动推断
2. 自动加一级标题（如缺失）
3. 按标题边界语义拆分超大文件（不在句子/段落中间断开）
4. 清理 docx 转换产生的乱码字符（含 tab 分隔符）
5. 调研表长表格单元格转结构化段落

拆分规则：
- 触发条件：文件超过 MAX_LINES（默认 300 行）
- 切割位置：只在 ## 或 ### 标题边界切，保证语义完整
- 若单个标题块本身超阈值，整块保留不硬切
- 产品内容：≤5个产品不拆，>10个按产品拆

用法:
    python3 clean-wiki.py              # 清洗默认 wiki 目录
    python3 clean-wiki.py <目录>        # 清洗指定目录
    python3 clean-wiki.py --dry-run     # 只打印不写入
"""

import os
import re
import sys
import argparse
from datetime import date
from pathlib import Path

DEFAULT_DIR = os.path.expanduser("~/.openclaw/workspace/wiki")
MAX_LINES = 300  # 超过此行数触发拆分
MIN_SPLIT_LINES = 15  # 拆分后单个文件最少行数，太小则合并到上一个


# ─── front-matter ────────────────────────────────────────────

def has_front_matter(text: str) -> bool:
    return text.lstrip().startswith("---")


def extract_front_matter(text: str) -> tuple[str, str]:
    """分离 front-matter 和正文，返回 (fm_text, body_text)。"""
    if not has_front_matter(text):
        return "", text
    lines = text.split("\n")
    dash_count = 0
    fm_end = 0
    for i, line in enumerate(lines):
        if line.strip() == "---":
            dash_count += 1
            if dash_count == 2:
                fm_end = i + 1
                break
    fm_text = "\n".join(lines[:fm_end])
    body_text = "\n".join(lines[fm_end:]).lstrip("\n")
    return fm_text, body_text


def infer_category(filepath: Path) -> str:
    """根据文件名/路径自动推断内容类型。"""
    name = filepath.stem.lower()
    path_str = str(filepath).lower()

    if "案例" in name or "case" in name:
        return "case_study"
    if "调研" in name or "survey" in name:
        return "survey"
    if "权威资料" in name or "资料库" in name:
        return "company_info"
    if "ip观点" in name or "观点" in name or "文案" in name:
        return "ip_content"
    if "产品" in name or "product" in name:
        return "product"
    if "团队" in name or "ip矩阵" in name:
        return "team_ip"
    # 路径里有子目录名
    if "客户案例" in path_str or "案例" in path_str:
        return "case_study"
    if "ip观点" in path_str:
        return "ip_content"
    return "other"


def ensure_front_matter(text: str, filepath: Path) -> str:
    """确保文件有 front-matter，并补充 category 字段。"""
    fm_text, body_text = extract_front_matter(text)
    title = filepath.stem
    today = date.today().isoformat()
    category = infer_category(filepath)

    if fm_text:
        # 已有 front-matter，检查是否需要补 category
        if "category:" not in fm_text.lower():
            # 在最后一个 --- 前插入 category
            fm_lines = fm_text.split("\n")
            # 找到第二个 ---
            insert_pos = len(fm_lines) - 1
            fm_lines.insert(insert_pos, f"category: {category}")
            fm_text = "\n".join(fm_lines)
        return fm_text + "\n\n" + body_text
    else:
        fm = f"""---
title: {title}
source: {filepath.name}
synced: {today}
category: {category}
---

"""
        return fm + body_text


# ─── 标题处理 ────────────────────────────────────────────────

def ensure_h1_title(text: str, filepath: Path) -> str:
    """如果文件没有一级标题，从文件名生成一个放到 front-matter 之后。"""
    fm_text, body_text = extract_front_matter(text)
    lines = body_text.split("\n")

    has_h1 = any(line.startswith("# ") for line in lines[:20])
    if has_h1:
        return text

    title = filepath.stem

    if fm_text:
        return fm_text + "\n\n" + f"# {title}\n\n" + body_text
    else:
        return f"# {title}\n\n" + body_text


# ─── 清洗 ────────────────────────────────────────────────────

def clean_garbage(text: str) -> str:
    """清理 docx 转换产生的常见垃圾字符。"""
    # 清理连续的空行（超过2个压缩为2个）
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    # 清理行尾空格（保留行首缩进）
    lines = text.split("\n")
    cleaned = [line.rstrip() for line in lines]
    return "\n".join(cleaned)


def clean_tab_separated(text: str) -> str:
    """检测并清洗 tab 分隔的多列内容（docx 转换常见格式）。

    将 tab 分隔的行转为结构化 Markdown：
    - 第一列短文本（≤30字，无句号/感叹号结尾）作为 ## 标题
    - 第一列长文本（>30字）视为正文，tab 后的内容追加为段落
    """
    lines = text.split("\n")
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # 检测 tab 分隔行（至少1个 tab）
        if "\t" in line and line.count("\t") >= 1:
            # 收集连续的 tab 分隔行
            tab_block = []
            while i < len(lines) and "\t" in lines[i] and lines[i].count("\t") >= 1:
                tab_block.append(lines[i])
                i += 1

            for tab_line in tab_block:
                parts = tab_line.split("\t")
                # 清理引号和首尾空格
                parts = [p.strip().strip('"').strip("'").strip() for p in parts]
                parts = [p for p in parts if p]
                if not parts:
                    continue

                heading_candidate = parts[0]
                content_parts = parts[1:]
                content = "\n".join(content_parts) if content_parts else ""

                # 判断第一列是否适合做标题：≤30字、不以句号/感叹号结尾
                is_heading = (
                    len(heading_candidate) <= 30
                    and not heading_candidate.endswith(("。", "！", "？", ".", "!", "?"))
                    and not heading_candidate.startswith(("1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9."))
                )

                if is_heading:
                    result.append(f"\n## {heading_candidate}\n")
                    if content:
                        result.append(content)
                        result.append("")
                else:
                    # 不是标题，拼接为正文
                    full_text = heading_candidate
                    if content:
                        full_text += "\n" + content
                    result.append(full_text)
                    result.append("")
            continue
        else:
            result.append(line)
            i += 1

    return "\n".join(result)


def convert_long_table_cells(text: str) -> str:
    """检测 Markdown 表格，如果单元格内容过长，转为标题+段落格式。

    只处理"长表格"（单元格内超过 80 字符），短表格保留原样。
    """
    lines = text.split("\n")
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]

        # 检测表格起始（含 | 的行，下一行是分隔线）
        if "|" in line and i + 1 < len(lines) and re.match(
            r"^\|[\s\-:|]+\|?\s*$", lines[i + 1]
        ):
            # 收集整个表格块
            table_lines = [line]
            i += 1
            table_lines.append(lines[i])  # 分隔线
            i += 1
            while i < len(lines) and "|" in lines[i] and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1

            # 解析表格
            header = [c.strip() for c in table_lines[0].split("|")[1:-1]]
            data_rows = []
            for tl in table_lines[2:]:
                cells = [c.strip() for c in tl.split("|")[1:-1]]
                data_rows.append(cells)

            # 判断是否有长单元格
            max_cell_len = 0
            for row in data_rows:
                for cell in row:
                    max_cell_len = max(max_cell_len, len(cell))

            if max_cell_len <= 80:
                # 短表格保留原样
                result.extend(table_lines)
                continue

            # 长表格转结构化段落
            for row_idx, row in enumerate(data_rows):
                for col_idx, cell in enumerate(row):
                    col_name = header[col_idx] if col_idx < len(header) else f"字段{col_idx + 1}"
                    if cell:
                        result.append(f"### {col_name}")
                        result.append(cell)
                        result.append("")
                result.append("---")
                result.append("")

            continue
        else:
            result.append(line)
            i += 1

    return "\n".join(result)


# ─── 语义拆分 ────────────────────────────────────────────────

def find_heading_boundaries(lines: list[str]) -> list[tuple[int, int]]:
    """找到每个 ## 或 ### 标题的起止行范围。

    返回 [(start_line, end_line), ...]，end_line 是下一个同级/更高级标题的前一行。
    """
    boundaries = []
    heading_indices = []
    for i, line in enumerate(lines):
        # 匹配 ## 或 ### 但不匹配 #（一级标题不作为拆分点）
        if re.match(r"^#{2,3}\s+", line):
            heading_indices.append(i)

    if not heading_indices:
        return [(0, len(lines))]

    # 计算每个标题块的结束位置
    for idx, start in enumerate(heading_indices):
        if idx + 1 < len(heading_indices):
            end = heading_indices[idx + 1] - 1
        else:
            end = len(lines) - 1
        # 标题块包含标题前的空行（如果有）
        actual_start = start
        boundaries.append((actual_start, end))

    # 补充第一个标题之前的内容
    if heading_indices[0] > 0:
        boundaries.insert(0, (0, heading_indices[0] - 1))

    return boundaries


def split_by_headings(
    lines: list[str],
    max_lines: int = MAX_LINES,
    min_lines: int = MIN_SPLIT_LINES,
) -> list[list[str]]:
    """按标题边界拆分，保证语义完整。

    规则：
    1. 在 ## 或 ### 标题处切分
    2. 单个标题块即使超阈值也不硬切（保证语义完整）
    3. 拆出的块小于 min_lines 则合并到上一个块
    """
    boundaries = find_heading_boundaries(lines)

    # 如果没有标题或只有一块，不拆
    if len(boundaries) <= 1:
        return [lines]

    # 按边界切块
    raw_blocks = []
    for start, end in boundaries:
        block = lines[start : end + 1]
        raw_blocks.append(block)

    # 合并过小的块到前一个，但不超 max_lines 太多
    merged = []
    for block in raw_blocks:
        if merged and len(block) < min_lines:
            # 只有合并后不超阈值 1.5 倍才合并
            if len(merged[-1]) + len(block) <= max_lines * 1.5:
                merged[-1].extend(block)
            else:
                merged.append(block)
        else:
            merged.append(block)

    # 如果合并后只有一块，不需要拆
    if len(merged) <= 1:
        return [lines]

    return merged


def split_large_file(
    text: str, filepath: Path, output_dir: Path, dry_run: bool
) -> list[tuple[str, str]]:
    """按标题边界拆分大文件。返回 (文件名, 内容) 列表。"""
    fm_text, body_text = extract_front_matter(text)
    body_lines = body_text.split("\n")

    blocks = split_by_headings(body_lines)
    if len(blocks) <= 1:
        # 无法按标题拆分，保持原样
        return [(filepath.name, text)]

    base_name = filepath.stem
    ext = filepath.suffix
    results = []

    for idx, block in enumerate(blocks, 1):
        # 清理块首尾空行
        while block and not block[0].strip():
            block.pop(0)
        while block and not block[-1].strip():
            block.pop()
        if not block:
            continue

        # 从块的第一个标题提取子标题名
        first_heading = ""
        for line in block:
            m = re.match(r"^#{1,3}\s+(.+)$", line)
            if m:
                first_heading = m.group(1).strip()
                break

        # 生成文件名：原始名-序号-首标题（清理特殊字符）
        safe_heading = re.sub(r'[\\/:*?"<>|]', "", first_heading)[:30] if first_heading else ""
        if safe_heading:
            part_name = f"{base_name}-{idx:02d}-{safe_heading}{ext}"
        else:
            part_name = f"{base_name}-{idx:02d}{ext}"

        part_text = fm_text + "\n\n" + "\n".join(block) + "\n"
        results.append((part_name, part_text))

    return results


def should_split(text: str) -> bool:
    """文件拆分已禁用：只做格式清洗，不拆分文件。
    chunk 切分由 OpenClaw 索引引擎在标题边界处理，无需文件层面拆分。
    """
    return False


# ─── 主流程 ──────────────────────────────────────────────────

def process_file(filepath: Path, dry_run: bool) -> tuple[int, int]:
    """处理单个文件。返回 (处理数, 拆分数)。"""
    if not filepath.is_file() or filepath.suffix != ".md":
        return 0, 0

    original = filepath.read_text(encoding="utf-8")
    filename = filepath.name

    # 不处理已经是清洗过的子文件（有 front-matter + h1 + category）
    fm_text, _ = extract_front_matter(original)
    is_already_cleaned = (
        has_front_matter(original)
        and "category:" in fm_text.lower()
        and any(line.startswith("# ") for line in original.split("\n")[:15])
    )

    if is_already_cleaned:
        # 已清洗过的文件，只做轻度垃圾清理
        cleaned = clean_garbage(original)
        if cleaned != original and not dry_run:
            filepath.write_text(cleaned, encoding="utf-8")
            print(f"  🧹 轻度清理: {filename}")
        return 0, 0

    text = original

    # 1. 清理垃圾字符
    text = clean_garbage(text)

    # 2. 清理 tab 分隔符
    text = clean_tab_separated(text)

    # 3. 长表格单元格转段落
    text = convert_long_table_cells(text)

    # 4. 加 front-matter（含 category 推断）
    text = ensure_front_matter(text, filepath)

    # 5. 加一级标题
    text = ensure_h1_title(text, filepath)

    # 6. 判断是否需要拆分
    if should_split(text):
        subdir_name = filepath.stem
        subdir = filepath.parent / subdir_name
        if not dry_run:
            subdir.mkdir(exist_ok=True)

        parts = split_large_file(text, filepath, subdir, dry_run)
        for part_name, part_text in parts:
            part_path = subdir / part_name
            if not dry_run:
                part_path.write_text(part_text, encoding="utf-8")
                line_count = len(part_text.splitlines())
                print(f"  📄 拆分: {subdir_name}/{part_name} ({line_count} 行)")
            else:
                line_count = len(part_text.splitlines())
                print(f"  [DRY-RUN] 会拆分: {subdir_name}/{part_name} ({line_count} 行)")

        if len(parts) > 1:
            if not dry_run:
                filepath.unlink()
                print(f"  🗑  原文件已删除: {filename}")
            else:
                print(f"  [DRY-RUN] 原文件保留: {filename}")
            return 1, len(parts)
        else:
            # 拆分失败（没有足够标题边界），写回清洗后的整文件
            if text != original:
                if not dry_run:
                    filepath.write_text(text, encoding="utf-8")
                    print(f"  ✅ 清洗(未拆分): {filename} (无标题边界，仅清洗)")
                else:
                    print(f"  [DRY-RUN] 会清洗(未拆分): {filename}")
                return 1, 0
            return 0, 0

    # 不需要拆分，直接写回
    if text != original:
        if not dry_run:
            filepath.write_text(text, encoding="utf-8")
            print(f"  ✅ 清洗: {filename} (加元数据+标题+格式清洗)")
        else:
            print(f"  [DRY-RUN] 会清洗: {filename}")
        return 1, 0

    return 0, 0


def main():
    parser = argparse.ArgumentParser(description="wiki Markdown 自动清洗工具")
    parser.add_argument(
        "input", nargs="?", default=DEFAULT_DIR, help=f"目录或文件路径（默认: {DEFAULT_DIR}）"
    )
    parser.add_argument("--dry-run", action="store_true", help="只打印不写入")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser()
    if not input_path.exists():
        print(f"路径不存在: {input_path}", file=sys.stderr)
        sys.exit(1)

    # 单文件模式
    if input_path.is_file():
        if input_path.suffix != ".md":
            print(f"非 md 文件，跳过: {input_path}")
            return
        c, s = process_file(input_path, args.dry_run)
        if c or s:
            print("\n💡 建议运行 `openclaw memory index --force` 重建索引")
        return

    # 目录模式（递归处理子目录下的 md 文件）
    dir_path = input_path
    md_files = sorted(dir_path.rglob("*.md"))
    if not md_files:
        print(f"目录下无 md 文件: {dir_path}")
        return

    print(f"📂 {dir_path} ({len(md_files)} 个 md 文件)")

    cleaned = 0
    split_count = 0
    for md_file in md_files:
        c, s = process_file(md_file, args.dry_run)
        cleaned += c
        split_count += s

    if split_count:
        print(f"\n📊 清洗 {cleaned} 个文件, 拆分出 {split_count} 个子文件")
    else:
        print(f"\n📊 清洗 {cleaned} 个文件")

    if cleaned > 0 or split_count > 0:
        print("\n💡 建议运行 `openclaw memory index --force` 重建索引")


if __name__ == "__main__":
    main()
