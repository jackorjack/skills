---
name: "enterprise-kb-sync"
description: "同步企业知识库到 workspace/wiki/。从飞书或企业微信读取文档，转为 Markdown 保存，同时下载原文件。"
metadata:
  required:
    bins: []
    env:
      - ENTERPRISE_DOC_PLATFORM
      - ENTERPRISE_DOC_URL
---

# 企业知识库同步

## 流程

读取 `.env` 的 `ENTERPRISE_DOC_PLATFORM` 和 `ENTERPRISE_DOC_URL`（逗号分隔多 URL），逐个拉取保存到 `workspace/wiki/`。

对每个文档：
1. 拉取 Markdown 版本，保存为 `workspace/wiki/<文档名>.md`
2. 下载原文件，保存为 `workspace/wiki/<文档名>.<原始扩展名>`

## 飞书（`ENTERPRISE_DOC_PLATFORM=feishu`）

### `/docx/TOKEN` 单文档

用 `exec` 执行，命令无需带 `--as`，agent 逐级重试：

**获取 Markdown：**

```bash
lark-cli docs +fetch --api-version v2 --doc TOKEN --doc-format markdown --format json --as bot
```

失败则依次降级 `--as user` → shared。拿到 `content` 后用 `write` 保存为 `.md`。

**下载原文件：**

```bash
lark-cli drive +export --token TOKEN --doc-type docx --file-extension docx --output-dir workspace/wiki --overwrite --as bot
```

同样降级策略 bot → user → shared。`--doc-type` 根据文档类型设为 `docx`、`sheet`、`bitable` 或 `slides`。失败则跳过，不影响 Markdown 同步。

### `/wiki/TOKEN` 知识库

1. `lark-cli wiki spaces get_node --params '{"token":"TOKEN"}' --as bot --format json` → 得 `space_id`
2. `lark-cli wiki nodes list --params '{"space_id":"X","parent_node_token":"TOKEN"}' --as bot --page-all --format json` → 得子节点
3. 对每个 `docx` 节点按单文档方式拉取 Markdown + 原文件

### shared 兜底

```bash
lark-cli drive files shared --as user --page-all --format json
```

从共享文件列表中读取。

## 企业微信（`ENTERPRISE_DOC_PLATFORM=wecom`）

### 前置

```bash
openclaw mcp add 企业微信文档 --transport streamable-http --url <MCP_URL>
```

### 获取 Markdown

直接用 `mcp-------__get_doc_content` 工具：

- 传 `url` + `type: 2`
- 若 `task_done=false`，用返回的 `task_id` 继续调用直到 `task_done=true`
- 提取 `content` 即 Markdown，用 `write` 保存为 `.md`

### 下载原文件

- **智能文档（smart page）**：调用 `mcp-------__smartpage_export_task` 传入 `url` + `content_type: 1`，轮询 `mcp-------__smartpage_get_export_result` 直到 `task_done=true`，保存返
  回内容为原文件格式
- **普通文档/表格**：尝试 `mcp-------__get_doc_content` 传入对应原始格式 type，保存为对应扩展名

失败则跳过原文件下载，不影响 Markdown 同步。

## 输出

- `workspace/wiki/<文档名>.md` — Markdown 版本
- `workspace/wiki/<文档名>.<原始扩展名>` — 原文件（下载失败则无此文件）
