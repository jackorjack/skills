# TOOLS.md - Local Notes

## Stealth Reader（web_fetch 兜底）

当 `web_fetch` 读取文章失败时，用 Camoufox 隐身浏览器兜底：

```bash
cd /home/ubuntu/.openclaw/workspace-brand-marketing/services/stealth-reader

# 普通站点
/home/ubuntu/.openclaw/workspace-brand-marketing/.venv-stealth-reader/bin/python -m stealth_reader 'URL'

# SSL 证书无效的站点（如 nlypx.com）加 --ignore-ssl
/home/ubuntu/.openclaw/workspace-brand-marketing/.venv-stealth-reader/bin/python -m stealth_reader --ignore-ssl 'URL'
```

输出 JSON，关注 `status` 字段：`SUCCESS` / `RETRYABLE` / `EMPTY` / `NEED_VERIFY` / `UNSUPPORTED`。

## 单篇 Markdown 转 HTML（render_geo_markdown.mjs）

仿写文章（`yao-geo-article-friendly`）输出 Markdown，技能本身不含 HTML 渲染器。需要交付 HTML 链接时用此脚本转换：

```bash
node /home/ubuntu/.openclaw/workspace-brand-marketing/scripts/render_geo_markdown.mjs <输入.md> <输出.html>
```

示例：

```bash
node scripts/render_geo_markdown.mjs output/drafts/文章标题.md /home/ubuntu/geo/文章标题.html
```

内置响应式 CSS，支持标题、段落、列表、表格、引用块、行内代码。

## 批量文章交付（geo_batch.py）

多篇文章生成后，执行查重 + 质量检查 + 批量构建 HTML + 发布：

```bash
# 默认扫描 output/drafts/*.md
python3 /home/ubuntu/.openclaw/workspace-brand-marketing/scripts/geo_batch.py

# 指定草稿目录和发布目录
python3 scripts/geo_batch.py --input-dir output/drafts/短视频获客 --publish-root /home/ubuntu/geo/短视频获客

# 只检查不构建
python3 scripts/geo_batch.py --check-only

# 自定义阈值
python3 scripts/geo_batch.py --min-chars 1500 --max-similarity 0.25
```

检查项：字数、章节数、违禁词、两两相似度。全部通过后才渲染 HTML 并发布。

## HTML 交付

- 保存目录：`/home/ubuntu/geo`
- 访问地址：`http://101.34.200.247/geo/文件名称.html`

## GEO 文章交付格式（固定标准）

- 只交付 Markdown + HTML 两种格式，不交付 Word/PDF 及分析模块
- 内容只保留完整文章正文（标题 + 正文），不含技能元信息、分析结论、证据分级、来源账本等报告模块
- 流程：技能生成完整报告后 -> 提取文章正文部分写入 `.md` -> 用 `render_geo_markdown.mjs` 转为 `.html`
- 两个文件均保存到 `/home/ubuntu/geo/`，文件名一致，扩展名不同
- 交付时提供 HTML 访问链接
- 每次流程必须一致
