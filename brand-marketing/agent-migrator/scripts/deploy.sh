#!/usr/bin/env bash
# Agent Migrator - DEPLOY 模式执行脚本
# 由 SKILL.md 触发时调用，从 payload/ 部署整个 agent
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
step() { echo -e "${GREEN}[$1]${NC} $2"; }
warn() { echo -e "${YELLOW}  ⚠${NC}  $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD="$SCRIPT_DIR/../payload"

if [ ! -d "$PAYLOAD" ]; then
  echo "错误: 未找到 payload/ 目录，请先在源机器上执行 BUILD 模式"
  exit 1
fi

# === 配置 ===
OPENCLAW_USER="${OPENCLAW_USER:-ubuntu}"
OPENCLAW_HOME="/home/${OPENCLAW_USER}"
WORKSPACE_DIR="${WORKSPACE_DIR:-${OPENCLAW_HOME}/.openclaw/workspace-brand-marketing}"
WIKI_DIR="${WIKI_DIR:-${OPENCLAW_HOME}/.openclaw/workspace/wiki}"
GEO_DIR="${GEO_DIR:-${OPENCLAW_HOME}/geo}"
AGENT_ID="${AGENT_ID:-brand-marketing}"

banner() {
  echo -e "${CYAN}"
  echo "  ╔═══════════════════════════════════════╗"
  echo "  ║   Agent Migrator - DEPLOY 模式        ║"
  echo "  ║   Agent: ${AGENT_ID}"
  echo "  ╚═══════════════════════════════════════╝"
  echo -e "${NC}"
}

banner

step 1 "创建工作区目录"
mkdir -p "$WORKSPACE_DIR"
mkdir -p "$WIKI_DIR"
mkdir -p "$GEO_DIR"

step 2 "部署配置文件"
for f in AGENTS.md SOUL.md IDENTITY.md MEMORY.md TOOLS.md USER.md HEARTBEAT.md; do
  if [ -f "$PAYLOAD/workspace/$f" ]; then
    cp "$PAYLOAD/workspace/$f" "$WORKSPACE_DIR/$f"
    echo "  ✓ $f"
  fi
done
[ -f "$PAYLOAD/workspace/openclaw-workspace-state.json" ] && \
  cp "$PAYLOAD/workspace/openclaw-workspace-state.json" "$WORKSPACE_DIR/"

step 3 "部署技能包"
if [ -d "$PAYLOAD/skills" ]; then
  mkdir -p "$WORKSPACE_DIR/skills"
  cp -r "$PAYLOAD/skills"/* "$WORKSPACE_DIR/skills/"
  echo "  ✓ $(ls -1 "$WORKSPACE_DIR/skills/" | wc -l) 个技能"
fi

step 4 "部署脚本"
if [ -d "$PAYLOAD/scripts" ] && [ "$(ls -A "$PAYLOAD/scripts" 2>/dev/null)" ]; then
  mkdir -p "$WORKSPACE_DIR/scripts"
  cp -r "$PAYLOAD/scripts"/* "$WORKSPACE_DIR/scripts/"
  echo "  ✓ $(find "$WORKSPACE_DIR/scripts" -type f | wc -l) 个文件"
fi

step 5 "部署服务"
if [ -d "$PAYLOAD/services" ] && [ "$(ls -A "$PAYLOAD/services" 2>/dev/null)" ]; then
  mkdir -p "$WORKSPACE_DIR/services"
  cp -r "$PAYLOAD/services"/* "$WORKSPACE_DIR/services/"

  SR="$WORKSPACE_DIR/services/stealth-reader"
  if [ -f "$SR/requirements.txt" ] && [ ! -d "$SR/.venv-stealth-reader" ]; then
    cd "$SR"
    python3 -m venv .venv-stealth-reader 2>/dev/null && \
      .venv-stealth-reader/bin/pip install -r requirements.txt -q && \
      echo "  ✓ stealth-reader venv" || warn "stealth-reader venv 创建失败"
  fi
fi

step 6 "部署知识库"
if [ -d "$PAYLOAD/wiki" ] && [ "$(ls -A "$PAYLOAD/wiki" 2>/dev/null)" ]; then
  cp -r "$PAYLOAD/wiki"/* "$WIKI_DIR/"
  echo "  ✓ $(find "$WIKI_DIR" -type f | wc -l) 个文件"
fi

step 7 "安装技能依赖"
find "$WORKSPACE_DIR/skills" -name requirements.txt 2>/dev/null | while read -r req; do
  name=$(basename "$(dirname "$req")")
  pip3 install -r "$req" -q 2>/dev/null && echo "  ✓ $name" || echo "  - $name (跳过)"
done

step 8 "设置权限"
chown -R "$OPENCLAW_USER:$OPENCLAW_USER" "$WORKSPACE_DIR" 2>/dev/null || true
chown -R "$OPENCLAW_USER:$OPENCLAW_USER" "$WIKI_DIR" 2>/dev/null || true
chown "$OPENCLAW_USER:$OPENCLAW_USER" "$GEO_DIR" 2>/dev/null || true
echo "  ✓ 完成"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           ✅ Agent 部署完成                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}━━━ 后续步骤 ━━━${NC}"
echo ""
echo "1. 修改企业信息:"
echo "   vi ${WORKSPACE_DIR}/MEMORY.md"
echo "   vi ${WORKSPACE_DIR}/AGENTS.md"
echo ""
echo "2. 注册 Agent 到 Gateway Config:"
echo "   openclaw gateway config-edit"
if [ -f "$PAYLOAD/config/agent-config.json" ]; then
  echo ""
  echo "   添加以下条目到 agents.list:"
  cat "$PAYLOAD/config/agent-config.json"
fi
echo ""
echo "3. 重启 OpenClaw:"
echo "   openclaw gateway restart"
echo ""
echo -e "${CYAN}部署完毕！${NC}"
