---
name: enterprise-kb-sync
description: "同步企业知识库到 workspace/wiki/。从飞书或企业微信读取文档，转为 Markdown 保存。"
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

## 飞书（`ENTERPRISE_DOC_PLATFORM=feishu`）

### `/docx/TOKEN` 单文档

用 `exec` 执行，命令无需带 `--as`，agent 逐级重试：

```bash
lark-cli docs +fetch --api-version v2 --doc TOKEN --doc-format markdown --format json --as bot
```

失败则依次降级 `--as user` → shared。拿到 `content` 后用 `write` 保存。

### `/wiki/TOKEN` 知识库

1. `lark-cli wiki spaces get_node --params '{"token":"TOKEN"}' --as bot --format json` → 得 `space_id`
2. `lark-cli wiki nodes list --params '{"space_id":"X","parent_node_token":"TOKEN"}' --as bot --page-all --format json` → 得子节点
3. 对每个 `docx` 节点按单文档方式拉取保存

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

### 读取

直接用 `mcp-------__get_doc_content` 工具：

- 传 `url` + `type: 2`
- 若 `task_done=false`，用返回的 `task_id` 继续调用直到 `task_done=true`
- 提取 `content` 即 Markdown，用 `write` 保存

## 输出

`workspace/wiki/<原文档的名称>.md`
