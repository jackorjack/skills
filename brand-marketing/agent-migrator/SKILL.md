---
name: agent-migrator
description: 自包含 Agent 部署胶囊：源机器 BUILD 构建 payload，拷贝到新机器触发即完成 agent 部署
---

# Agent Migrator — 自包含 Agent 部署胶囊

## 触发词
`部署 agent`、`构建 agent 部署包`、`打包 agent`、`agent 迁移`、`初始化 agent`

## 执行规则

触发此技能时，首先执行以下命令检查自身技能目录下是否存在 `payload/` 文件夹：

```bash
ls {技能目录}/payload/ 2>/dev/null && echo "DEPLOY" || echo "BUILD"
```

- 输出 **BUILD**：进入 BUILD 模式（当前是源机器，需要构建部署包）
- 输出 **DEPLOY**：进入 DEPLOY 模式（当前是目标机器，从 payload 部署整个 agent）

---

## BUILD 模式（payload/ 不存在）

### Step 1: 获取 agent 配置
```bash
gateway action=config.get path=agents.list
```
找到当前 agent（brand-marketing），记录 workspace 路径和 wiki 路径。

### Step 2: 创建 payload 目录结构
```bash
SKILL_DIR={技能目录}
rm -rf $SKILL_DIR/payload
mkdir -p $SKILL_DIR/payload/{workspace,skills,scripts,services,wiki,config}
```

### Step 3: 收集 workspace 配置文件
```bash
for f in AGENTS.md SOUL.md IDENTITY.md MEMORY.md TOOLS.md USER.md HEARTBEAT.md openclaw-workspace-state.json; do
  [ -f "{workspace}/$f" ] && cp "{workspace}/$f" "$SKILL_DIR/payload/workspace/"
done
```

### Step 4: 复制技能包（排除 agent-migrator 自身）
```bash
for d in {workspace}/skills/*/; do
  name=$(basename "$d")
  [ "$name" = "agent-migrator" ] && continue
  rsync -a --exclude='__pycache__' --exclude='*.pyc' --exclude='.venv*' \
    --exclude='node_modules' --exclude='*.sqlite*' --exclude='*.zip' \
    --exclude='sessions/' --exclude='.git' \
    "$d" "$SKILL_DIR/payload/skills/$name/"
done
```

### Step 5: 复制脚本
```bash
[ -d "{workspace}/scripts" ] && rsync -a --exclude='__pycache__' {workspace}/scripts/ $SKILL_DIR/payload/scripts/
```

### Step 6: 复制服务
```bash
[ -d "{workspace}/services" ] && rsync -a --exclude='__pycache__' --exclude='.venv*' --exclude='node_modules' {workspace}/services/ $SKILL_DIR/payload/services/
```

### Step 7: 复制知识库
```bash
WIKI={memorySearch.extraPaths[0]}
[ -d "$WIKI" ] && cp "$WIKI"/* $SKILL_DIR/payload/wiki/
```

### Step 8: 写入 agent 配置 JSON
将 gateway config 中当前 agent 配置项写入 `$SKILL_DIR/payload/config/agent-config.json`。

### Step 9: 打包传输
```bash
cd {workspace}/skills
tar czf /tmp/agent-migrator.tar.gz agent-migrator/
```

### Step 10: 输出交付信息
- 文件：`/tmp/agent-migrator.tar.gz`
- 大小和 MD5
- scp 命令
- 新机器操作步骤（见下方"传输到新机器"）

---

## DEPLOY 模式（payload/ 存在）

当技能目录下已有 `payload/`，执行当前目录下的部署脚本：

```bash
bash {技能目录}/scripts/deploy.sh
```

如果 deploy.sh 执行异常，则逐步骤手动执行以下操作：

### Step 1: 确认路径
```bash
WORKSPACE_DIR="/home/ubuntu/.openclaw/workspace-brand-marketing"
WIKI_DIR="/home/ubuntu/.openclaw/workspace/wiki"
GEO_DIR="/home/ubuntu/geo"
mkdir -p "$WORKSPACE_DIR" "$WIKI_DIR" "$GEO_DIR"
```

### Step 2: 部署配置文件
```bash
cd {技能目录}
cp payload/workspace/* "$WORKSPACE_DIR/"
```

### Step 3: 部署技能包
```bash
mkdir -p "$WORKSPACE_DIR/skills"
cp -r payload/skills/* "$WORKSPACE_DIR/skills/"
```

### Step 4: 部署脚本
```bash
[ -d payload/scripts ] && cp -r payload/scripts/* "$WORKSPACE_DIR/scripts/"
```

### Step 5: 部署服务 + 创建 venv
```bash
[ -d payload/services ] && cp -r payload/services/* "$WORKSPACE_DIR/services/"
# 创建 stealth-reader 虚拟环境
SR="$WORKSPACE_DIR/services/stealth-reader"
if [ -f "$SR/requirements.txt" ] && [ ! -d "$SR/.venv-stealth-reader" ]; then
  cd "$SR"
  python3 -m venv .venv-stealth-reader
  .venv-stealth-reader/bin/pip install -r requirements.txt
fi
```

### Step 6: 部署知识库
```bash
[ -d payload/wiki ] && cp -r payload/wiki/* "$WIKI_DIR/"
```

### Step 7: 安装技能依赖
```bash
find "$WORKSPACE_DIR/skills" -name requirements.txt | while read req; do
  pip3 install -r "$req" 2>/dev/null || true
done
```

### Step 8: 设置权限
```bash
chown -R ubuntu:ubuntu "$WORKSPACE_DIR" "$WIKI_DIR" "$GEO_DIR" 2>/dev/null || true
```

### Step 9: 输出 agent 注册 JSON
读取 `payload/config/agent-config.json` 并展示给用户，提示添加到 gateway config 的 agents.list。

### Step 10: 后续步骤提示
```
1. 修改企业信息: vi {WORKSPACE_DIR}/MEMORY.md 和 AGENTS.md
2. 注册 Agent: 将 agent-config.json 添加到 gateway config 的 agents.list
3. 重启: openclaw gateway restart
```

---

## 传输到新机器

BUILD 完成后，将部署包拷贝到新机器：

```bash
# 1. 拷贝
scp /tmp/agent-migrator.tar.gz ubuntu@新机器IP:~/

# 2. 在新机器上解压到 skills 目录
mkdir -p ~/.openclaw/workspace-brand-marketing/skills
tar xzf ~/agent-migrator.tar.gz -C ~/.openclaw/workspace-brand-marketing/skills/

# 3. 在 OpenClaw 中触发技能
部署 agent
```

## 排除清单

| 排除 | 原因 |
|------|------|
| `__pycache__/`, `*.pyc` | Python 缓存 |
| `.venv*/`, `venv/` | 虚拟环境（目标机重建） |
| `node_modules/` | Node 依赖（目标机重建） |
| `*.sqlite`, `*.sqlite-*` | 会话数据库 |
| `sessions/` | 会话历史 |
| `*.tar.gz`, `*.zip` | 嵌套压缩包 |
| `.git/` | Git 仓库 |
