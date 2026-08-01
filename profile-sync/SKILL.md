---
name: profile-sync
description: "将技能内置的配置模板同步到 workspace：从 skills/profile-sync/assets/ 拷贝文件到 workspace（自动备份）"
---

# Profile Sync

从技能内置 assets/ 同步配置文件到 workspace，操作前自动备份。

## 核心能力

### 同步配置（pull）

从技能自带的 `skills/profile-sync/assets/` 目录拷贝配置文件到 workspace，**拷贝前自动备份当前文件**。

```bash
bash skills/profile-sync/scripts/sync.sh pull
```

流程：
1. 自动备份当前 workspace 中的配置文件到 `.backup/<时间戳>/`
2. 将 `skills/profile-sync/assets/` 中的文件拷贝到 workspace（无需联网下载）
3. 输出操作摘要

## 管理的文件

| 文件 | 用途 |
|------|------|
| AGENTS.md | 主 Agent 行为指令 |
| SOUL.md | 人格/语调定义 |
| USER.md | 用户偏好 |
| IDENTITY.md | Agent 身份信息 |
| TOOLS.md | 工具使用说明 |
| HEARTBEAT.md | 心跳任务 |

## 辅助命令

```bash
# 查看备份列表
bash skills/profile-sync/scripts/sync.sh list

# 从备份还原（默认最新备份）
bash skills/profile-sync/scripts/sync.sh restore

# 从指定备份还原
bash skills/profile-sync/scripts/sync.sh restore 2026-01-01_120000
```

## 配置源

- 所有配置文件存储在 `skills/profile-sync/assets/` 目录
- pull 时直接从本地 assets 拷贝，无需联网
- 如需更新配置模板，直接修改 `skills/profile-sync/assets/` 中的文件即可

## 安全约束

- 下载前自动备份，不会丢失数据
- 备份操作只追加，不删除
- 还原操作同样先备份当前文件