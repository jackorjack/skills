#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Profile Sync — workspace ↔ GitHub 双向同步
# ============================================================

WORKSPACE="${HOME}/.openclaw/workspace"
BACKUP_ROOT="${WORKSPACE}/.backup"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# GitHub 远程仓库
GITHUB_REPO="https://github.com/jackorjack/skills.git"
GITHUB_BRANCH="main"
REMOTE_DIR="profile-sync/assets"

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

ok()   { echo "  ✅  ${1}"; }
warn() { echo "  ⚠️  ${1}"; }
info() { echo "  ℹ️  ${1}"; }
fail() { echo "  ❌  ${1}" >&2; exit 1; }

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

# -- pull: 从 GitHub 下载配置 --------------------------------
do_pull() {
  banner "下载配置 (GitHub → Workspace)"

  # 1. 备份当前文件
  info "备份当前 workspace 配置..."
  do_backup "pull_${now_ts}"

  # 2. 克隆远程仓库到临时目录
  local tmp_dir
  tmp_dir=$(mktemp -d)
  info "克隆远程仓库..."
  if ! git clone --depth=1 -b "$GITHUB_BRANCH" "$GITHUB_REPO" "$tmp_dir" 2>/dev/null; then
    rm -rf "$tmp_dir"
    fail "克隆仓库失败，请检查网络或仓库地址"
  fi

  # 3. 检查远程目录是否存在
  local remote_assets="${tmp_dir}/${REMOTE_DIR}"
  if [[ ! -d "$remote_assets" ]]; then
    rm -rf "$tmp_dir"
    fail "远程仓库中不存在 ${REMOTE_DIR}/ 目录"
  fi

  # 4. 覆盖 workspace 文件
  echo
  local count=0
  local missing=0
  for f in "${FILES[@]}"; do
    local src="${remote_assets}/${f}"
    local dest="${WORKSPACE}/${f}"
    if [[ -f "$src" ]]; then
      cp "$src" "$dest"
      ok "下载: ${f}"
      count=$((count + 1))
    else
      warn "远程缺少: ${f}"
      missing=$((missing + 1))
    fi
  done

  # 5. 清理临时目录
  rm -rf "$tmp_dir"

  echo
  info "下载完成: ${count} 个文件已同步到 workspace"
  if [[ $missing -gt 0 ]]; then
    warn "${missing} 个文件在远程不存在，保留本地版本"
  fi
}

# -- push: 上传配置到 GitHub ---------------------------------
do_push() {
  banner "上传配置 (Workspace → GitHub)"

  # 1. 检查本地文件
  local local_count=0
  for f in "${FILES[@]}"; do
    if [[ -f "${WORKSPACE}/${f}" ]]; then
      local_count=$((local_count + 1))
    fi
  done

  if [[ $local_count -eq 0 ]]; then
    fail "workspace 中没有可上传的配置文件"
  fi

  # 2. 克隆远程仓库
  local tmp_dir
  tmp_dir=$(mktemp -d)
  info "克隆远程仓库..."
  if ! git clone --depth=1 -b "$GITHUB_BRANCH" "$GITHUB_REPO" "$tmp_dir" 2>/dev/null; then
    rm -rf "$tmp_dir"
    fail "克隆仓库失败，请检查网络或仓库地址"
  fi

  # 3. 确保目标目录存在
  local remote_assets="${tmp_dir}/${REMOTE_DIR}"
  mkdir -p "$remote_assets"

  # 4. 拷贝 workspace 文件到远程目录
  echo
  local count=0
  local changed=0
  for f in "${FILES[@]}"; do
    local src="${WORKSPACE}/${f}"
    local dest="${remote_assets}/${f}"
    if [[ -f "$src" ]]; then
      # 检查是否有变化
      if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
        info "无变化: ${f}"
      else
        cp "$src" "$dest"
        ok "更新: ${f}"
        changed=$((changed + 1))
      fi
      count=$((count + 1))
    fi
  done

  if [[ $changed -eq 0 ]]; then
    rm -rf "$tmp_dir"
    echo
    ok "所有文件已是最新，无需推送"
    return 0
  fi

  # 5. commit & push
  echo
  info "提交变更..."
  cd "$tmp_dir"
  git add -A
  git -c user.name="OpenClaw Bot" -c user.email="bot@openclaw.ai" \
    commit -m "profile-sync: 更新配置文件 (${changed} files, $(ts))" --quiet

  info "推送到 GitHub..."
  if git push origin "$GITHUB_BRANCH" 2>/dev/null; then
    ok "推送成功"
  else
    rm -rf "$tmp_dir"
    fail "推送失败，请检查 GitHub 认证"
  fi

  # 6. 清理
  rm -rf "$tmp_dir"

  echo
  info "上传完成: ${changed} 个文件已推送到 GitHub"
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
    echo "  📦 ${name}  (${count} 文件)"
  done
}

# -- usage ---------------------------------------------------
usage() {
  cat <<EOF
用法: sync.sh <command> [args]

核心命令:
  pull           从 GitHub 下载配置到 workspace（自动备份）
  push           将 workspace 配置上传到 GitHub

辅助命令:
  list           列出所有备份
  restore [ts]   从备份还原（默认最新；可指定时间戳）

示例:
  sync.sh pull
  sync.sh push
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
  push|upload|ul)
    do_push
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
