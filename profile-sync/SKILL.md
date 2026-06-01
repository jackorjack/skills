---
name: profile-sync
description: "备份工作区配置文件并将技能内置版本部署到本地，支持 AGENTS.md / SOUL.md / USER.md / IDENTITY.md / TOOLS.md / HEARTBEAT.md 等文件的跨环境同步。"
---

# Profile Sync

用于 OpenClaw 工作区配置文件（AGENTS.md, SOUL.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md）的备份、替换、跨环境同步。

## 核心能力

1. **备份**：将当前工作区中的目标文件备份到 `~/.openclaw/workspace/.backup/`，按时间戳归档
2. **替换**：将技能内置 `assets/` 目录下的配置文件拷贝到工作区，覆盖现有文件
3. **还原**：从备份中恢复最近一次备份的文件

## 文件清单

| 文件 | 用途 | 可选 |
|------|------|------|
| AGENTS.md | 主 Agent 行为指令 | 否 |
| SOUL.md | 人格/语调定义 | 否 |
| USER.md | 用户偏好 | 是 |
| IDENTITY.md | Agent 身份信息 | 是 |
| TOOLS.md | 工具使用说明 | 是 |
| HEARTBEAT.md | 心跳任务 | 是 |

## 操作流程

### 备份 + 替换

```bash
# 一键备份当前配置并替换为技能内置版本
bash skills/profile-sync/scripts/sync.sh apply
```

脚本行为：
1. 检查目标文件是否存在于工作区与 `assets/`
2. 创建工作区 `.backup/YYYY-MM-DD_HHmmss/` 目录
3. 将本地现有文件拷贝到备份目录
4. 将 `assets/` 中对应文件覆盖到工作区
5. 输出操作摘要

### 仅备份

```bash
bash skills/profile-sync/scripts/sync.sh backup
```

### 从备份还原

```bash
# 还原最近一次备份
bash skills/profile-sync/scripts/sync.sh restore

# 还原指定备份
bash skills/profile-sync/scripts/sync.sh restore 2026-01-01_120000
```

### 预览差异

```bash
bash skills/profile-sync/scripts/sync.sh diff
```

## 工作区路径

- 工作区根目录: `~/.openclaw/workspace/`
- 备份目录: `~/.openclaw/workspace/.backup/`
- 技能内置配置: `skills/profile-sync/assets/`

## 更新技能内置配置

如需更新 `assets/` 中的配置文件（当前版本与工作区同步），执行：

```bash
bash skills/profile-sync/scripts/sync.sh update-assets
```

这会将工作区当前配置同步到技能 `assets/` 目录，下次提交即可分发。

## 安全约束

- 备份操作永不删除，只会追加新备份
- 覆盖前自动备份，不会丢失数据
- 还原操作同样会先备份当前文件
- 所有操作都有 dry-run 预览