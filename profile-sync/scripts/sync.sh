#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Profile Sync — 从技能 assets/ 同步配置到 workspace
# ============================================================

WORKSPACE="${HOME}/.openclaw/workspace"
BACKUP_ROOT="${WORKSPACE}/.backup"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS_DIR="${SKILL_DIR}/assets"

# 配置文件列表
FILES=(
  "AGENTS.md"
  "SOUL.md"
  "USER.md"
  "IDENTITY.md"
  "TOOLS.md"
  "HEARTBEAT.md"
)

# -- helpers -------------------------------------------------
ts() { date +"%Y-%m-%d_%H%M%S"; }
now_ts=$(ts)

banner() {
  echo
  echo "═══════════════════════════════════════════"
  echo "  Profile Sync — ${1}"
  echo "═══════════════════════════════════════════"
  echo
}

ok()   { echo "  ✅   ${1}"; }
warn() { echo "  ⚠️  ${1}"; }
info() { echo "  ℹ️  ${1}"; }
fail() { echo "  ❌   ${1}" >&2; exit 1; }

# -- backup --------------------------------------------------
do_backup() {
  local target_ts="${1:-$now_ts}"
  local dir="${BACKUP_ROOT}/${target_ts}"

  if [[ -d "$dir" ]]; then
    warn "备份已存在: ${dir}，跳过"
    return 0
  fi

  mkdir -p "$dir"

  local count=0
  for f in "${FILES[@]}"; do
    local src="${WORKSPACE}/${f}"
    if [[ -f "$src" ]]; then
      cp "$src" "${dir}/${f}"
      count=$((count + 1))
    fi
  done

  # 更新 latest 符号链接
  local latest="${BACKUP_ROOT}/latest"
  rm -f "$latest"
  ln -sfn "$dir" "$latest"

  if [[ $count -eq 0 ]]; then
    warn "没有文件需要备份"
  else
    ok "备份 ${count} 个文件 → ${dir}"
  fi
}

# -- pull: 从技能 assets/ 同步配置到 workspace -------------
do_pull() {
  banner "同步配置 (技能 assets/ → Workspace)"

  # 1. 检查 assets 目录
  if [[ ! -d "$ASSETS_DIR" ]]; then
    fail "技能 assets 目录不存在: ${ASSETS_DIR}"
  fi

  # 2. 备份当前文件
  info "备份当前 workspace 配置..."
  do_backup "pull_${now_ts}"

  # 3. 从 assets/ 拷贝文件到 workspace
  echo
  local count=0
  local missing=0
  for f in "${FILES[@]}"; do
    local src="${ASSETS_DIR}/${f}"
    local dest="${WORKSPACE}/${f}"
    if [[ -f "$src" ]]; then
      cp "$src" "$dest"
      ok "同步: ${f}"
      count=$((count + 1))
    else
      warn "assets 中缺少: ${f}"
      missing=$((missing + 1))
    fi
  done

  echo
  info "同步完成: ${count} 个文件已拷贝到 workspace"
  if [[ $missing -gt 0 ]]; then
    warn "${missing} 个文件在 assets 中不存在，保留本地版本"
  fi
}
 # -- restore -------------------------------------------------
 do_restore() {
   local target="${1:-latest}"
   local dir

   if [[ "$target" == "latest" ]]; then
     dir="${BACKUP_ROOT}/latest"
     if [[ ! -d "$dir" ]]; then
       fail "没有可用备份 (${dir} 不存在)"
     fi
     target=$(readlink "$dir" 2>/dev/null || echo "latest")
     target=$(basename "$target")
   else
     dir="${BACKUP_ROOT}/${target}"
     if [[ ! -d "$dir" ]]; then
       fail "备份不存在: ${dir}"
     fi
   fi

   banner "还原备份: ${target}"

   # 还原前先备份
   do_backup "pre_restore_${now_ts}"

   echo
   local count=0
   for f in "${FILES[@]}"; do
     local src="${dir}/${f}"
     local dest="${WORKSPACE}/${f}"
     if [[ -f "$src" ]]; then
       cp "$src" "$dest"
       ok "还原: ${f}"
       count=$((count + 1))
     fi
   done

   echo
   info "还原完成: ${count} 个文件"
 }
# -- list backups --------------------------------------------
do_list() {
  banner "备份列表"

  if [[ ! -d "$BACKUP_ROOT" ]]; then
    info "暂无备份"
    return
  fi

  local entries=()
  for d in "$BACKUP_ROOT"/*/; do
    [[ -d "$d" ]] || continue
    local name
    name=$(basename "$d")
    [[ "$name" == "latest" ]] && continue
    entries+=("$name")
  done

  if [[ ${#entries[@]} -eq 0 ]]; then
    info "暂无备份"
    return
  fi

  IFS=$'\n' sorted=($(sort -r <<<"${entries[*]}")); unset IFS
  for name in "${sorted[@]}"; do
    local dir="${BACKUP_ROOT}/${name}"
    local count
    count=$(ls -1 "$dir" 2>/dev/null | wc -l)
    echo "  📦  ${name}  (${count} 文件)"
  done
}

# -- usage ---------------------------------------------------
usage() {
  cat <<EOF
用法: sync.sh <command> [args]

命令:
  pull           从技能 assets/ 同步配置到 workspace（自动备份）
  list           列出所有备份
  restore [ts]   从备份还原（默认最新；可指定时间戳）

示例:
  sync.sh pull
  sync.sh list
  sync.sh restore
  sync.sh restore 2026-01-01_120000
EOF
  exit 0
}

# -- main ----------------------------------------------------
case "${1:-}" in
  pull|download|dl)
    do_pull
    ;;
  list|ls)
    do_list
    ;;
  restore)
    do_restore "${2:-latest}"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "错误: 未知命令 '${1}'" >&2
    usage
    ;;
esac
                                                                                                                                                                 219,1         Bot