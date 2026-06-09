#!/bin/bash
set -euo pipefail

WIKI_DIR="${HOME}/.openclaw/workspace/wiki"
LOCK_FILE="/tmp/sync-wiki.lock"

# 防止并发
exec 200>"${LOCK_FILE}"
flock -n 200 || { echo "sync-wiki is already running."; exit 0; }

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始同步 wiki 目录..."

converted=0

for docx in "${WIKI_DIR}"/*.docx; do
  [ -f "$docx" ] || continue

  md="${docx%.docx}.md"
  if [ -f "$md" ] && [ "$md" -nt "$docx" ]; then
    echo "  ⏭  跳过 (md 已是最新): $(basename "$docx")"
    continue
  fi

  echo "  🔄 转换: $(basename "$docx") → $(basename "$md")"

  python3 -c "
import sys, os
from docx import Document

docx_path = '$docx'
md_path = '$md'

doc = Document(docx_path)
lines = []

for para in doc.paragraphs:
    text = para.text.strip()
    if not text:
        lines.append('')
        continue
    style_name = para.style.name if para.style else ''
    if style_name.startswith('Heading'):
        level = int(style_name.split()[-1]) if ' ' in style_name else 1
        level = min(level, 6)
        lines.append('#' * level + ' ' + text)
    elif para.style.name == 'List Bullet' or para.style.name.startswith('List'):
        lines.append('- ' + text)
    else:
        lines.append(text)

for table in doc.tables:
    lines.append('')
    for i, row in enumerate(table.rows):
        cells = [cell.text.strip().replace('\n', ' ') for cell in row.cells]
        lines.append('| ' + ' | '.join(cells) + ' |')
        if i == 0:
            lines.append('|' + '|'.join([' --- '] * len(cells)) + '|')
    lines.append('')

with open(md_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

size = os.path.getsize(md_path)
print(f'  ✅ 完成 {os.path.basename(md_path)} ({len(lines)} 行, {size:,} 字节)')
"

  converted=$((converted + 1))
done

if [ "$converted" -gt 0 ]; then
  echo ""
  echo "  📇 重建记忆索引(含元数据修复)..."
  openclaw memory status --index --agent main 2>&1 | tail -3
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 同步完成, 转换 ${converted} 个文件."
