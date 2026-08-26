#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# OpenClaw Agent 迁移脚本
# 用法：在【源机器】上执行 ./migrate-export.sh
#   会打包出一个 agent-migration.tar.gz
#   拷到新机器后执行 ./migrate-import.sh
# ============================================================

OUTPUT="agent-migration.tar.gz"
STAGE="/tmp/agent-migration-stage"

echo "==> [1/6] 清理临时目录"
rm -rf "$STAGE"
mkdir -p "$STAGE/workspace" "$STAGE/scripts" "$STAGE/services" "$STAGE/config" "$STAGE/wiki"

echo "==> [2/6] 复制工作区配置文件（.md）"
for f in AGENTS.md SOUL.md IDENTITY.md MEMORY.md TOOLS.md USER.md HEARTBEAT.md; do
  [ -f "/home/ubuntu/.openclaw/workspace-brand-marketing/$f" ] && \
    cp "/home/ubuntu/.openclaw/workspace-brand-marketing/$f" "$STAGE/workspace/"
done

echo "==> [3/6] 复制技能包、脚本、服务"
cp -r /home/ubuntu/.openclaw/workspace-brand-marketing/skills "$STAGE/workspace/skills"
cp -r /home/ubuntu/.openclaw/workspace-brand-marketing/scripts "$STAGE/workspace/scripts"
cp -r /home/ubuntu/.openclaw/workspace-brand-marketing/services/stealth-reader "$STAGE/services/stealth-reader"
# 不打包 venv，新机器上重建
rm -rf "$STAGE/services/stealth-reader/__pycache__"

echo "==> [4/6] 复制知识库"
if [ -d "/home/ubuntu/.openclaw/workspace/wiki" ]; then
  cp /home/ubuntu/.openclaw/workspace/wiki/*.md "$STAGE/wiki/" 2>/dev/null || true
  cp /home/ubuntu/.openclaw/workspace/wiki/*.docx "$STAGE/wiki/" 2>/dev/null || true
fi

echo "==> [5/6] 导出 Agent 配置和 Nginx 配置"
# 导出 gateway config 中 agents 段（需要手动执行，这里存提示）
cat > "$STAGE/config/agent-config.json" << 'CONFIG_EOF'
{
  "id": "brand-marketing",
  "name": "企业品牌营销",
  "description": "企业品牌营销内容专员，geo 文章生成,仿写",
  "workspace": "/home/ubuntu/.openclaw/workspace-brand-marketing",
  "skills": [
    "yao-geo-explainer-builder",
    "yao-geo-ranking-article-builder",
    "yao-geo-comparison-builder",
    "yao-geo-content-refiner",
    "yao-geo-article-friendly",
    "yao-geo-title-optimizer",
    "wechat-typeset-publish",
    "khazix-writer"
  ],
  "memorySearch": {
    "extraPaths": ["/home/ubuntu/.openclaw/workspace/wiki"]
  }
}
CONFIG_EOF

# Nginx 配置
if [ -f /etc/nginx/conf.d/default.conf ]; then
  cp /etc/nginx/conf.d/default.conf "$STAGE/config/nginx-default.conf"
fi

# Stealth Reader 依赖
cat > "$STAGE/services/stealth-reader/requirements.txt" << 'REQ_EOF'
camoufox==0.4.11
beautifulsoup4==4.13.4
markdownify==1.2.0
REQ_EOF

# 迁移说明
cat > "$STAGE/MIGRATION_GUIDE.md" << 'GUIDE_EOF'
# 迁移指南

## 在新机器上执行

### 1. 安装 OpenClaw
参考 https://docs.openclaw.ai 安装 OpenClaw。

### 2. 还原工作区
```bash
tar xzf agent-migration.tar.gz -C /tmp/
cp -r /tmp/agent-migration-stage/workspace /home/ubuntu/.openclaw/workspace-brand-marketing
```

### 3. 修改企业主体信息
编辑以下文件，将"企盛教育"替换为新企业名称和相关信息：
- `AGENTS.md` — 企业介绍、服务对象、执行规则
- `MEMORY.md` — 当前企业主体段落
- `IDENTITY.md` — 标准回答中的企业名称
- `SOUL.md` — 品牌立场
- `workspace/wiki/` — 替换为新企业的知识库文件

### 4. 配置 Agent
将 `config/agent-config.json` 中的配置合并到 OpenClaw gateway config：
```bash
openclaw gateway config-edit
```
在 `agents.list` 中添加该 agent 条目。

### 5. 创建 Stealth Reader 虚拟环境
```bash
cd /home/ubuntu/.openclaw/workspace-brand-marketing/services/stealth-reader
python3 -m venv .venv-stealth-reader
.venv-stealth-reader/bin/pip install -r requirements.txt
```

### 6. 创建 HTML 输出目录 + Nginx 配置
```bash
mkdir -p /home/ubuntu/geo
# 参照 config/nginx-default.conf 配置你的 Nginx
# 修改 server_name 和 SSL 证书路径为新域名
```

### 7. 配置知识库 wiki 目录
```bash
cp -r /tmp/agent-migration-stage/wiki /home/ubuntu/.openclaw/workspace/wiki
```

### 8. 重启 OpenClaw
```bash
openclaw gateway restart
```
GUIDE_EOF

echo "==> [6/6] 打包"
tar czf "$OUTPUT" -C "$STAGE" .

echo ""
echo "✅ 完成！打包文件：$(pwd)/$OUTPUT ($(du -sh "$OUTPUT" | cut -f1))"
echo ""
echo "下一步："
echo "  1. 把 $OUTPUT 拷到新机器"
echo "  2. 解压后阅读 MIGRATION_GUIDE.md 执行迁移"
echo "  3. 记得修改 .md 文件中的企业主体信息"
