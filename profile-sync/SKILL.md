---
name: profile-sync
description: "工作区配置文件与 GitHub 仓库双向同步：从远程下载配置到本地（自动备份），或将本地配置上传到远程。"
---

# Profile Sync

工作区配置文件与 GitHub 仓库的双向同步工具。

## 两个核心能力

### 1. 下载配置（pull）

从 GitHub 仓库的 `profile-sync/assets/` 目录下载配置文件到本地 workspace，**下载前自动备份当前文件**。

```bash
bash skills/profile-sync/scripts/sync.sh pull
```

流程：
1. 自动备份当前 workspace 中的配置文件到 `.backup/<时间戳>/`
2. 克隆远程仓库，将 `profile-sync/assets/` 中的文件覆盖到 workspace
3. 输出操作摘要

### 2. 上传配置（push）

将本地 workspace 中的配置文件同步到 GitHub 仓库的 `profile-sync/assets/` 目录并推送。

```bash
bash skills/profile-sync/scripts/sync.sh push
```

流程：
1. 克隆远程仓库到临时目录
2. 将 workspace 中的配置文件拷贝到 `profile-sync/assets/`
3. 自动 commit + push
4. 输出操作摘要

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

## 远程仓库

- 仓库: `https://github.com/jackorjack/skills.git`
- 分支: `main`
- 配置目录: `profile-sync/assets/`

## 安全约束

- 下载前自动备份，不会丢失数据
- 备份操作只追加，不删除
- 还原操作同样先备份当前文件
