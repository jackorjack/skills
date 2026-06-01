#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Profile Sync — OpenCLaw workspace config backup & deploy
# ============================================================

WORKSPACE="${HOME}/.openclaw/workspace"
BACKUP_ROOT="${WORKSPACE}/.backup"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS_DIR="${SKILL_DIR}/assets"

# Config files managed by this skill (order matters for display)
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

# -- backup --------------------------------------------------
do_backup() {
  local target_ts="${1:-$now_ts}"
  local dir="${BACKUP_ROOT}/${target_ts}"

  if [[ -d "$dir" ]]; then
    warn "备份已存在: ${dir}，跳过备份"
    return 0
  fi

  mkdir -p "$dir"

  local count=0
  for f in "${FILES[@]}"; do
    local src="${WORKSPACE}/${f}"
    if [[ -f "$src" ]]; then
      cp "$src" "${dir}/${f}"
      ok "备份: ${f}"
      count=$((count + 1))
    fi
  done

  local latest="${BACKUP_ROOT}/latest"
  rm -f "$latest"
  ln -sfn "$dir" "$latest"

  if [[ $count -eq 0 ]]; then
    warn "没有文件需要备份"
  else
    info "备份完成: ${count} 个文件 → ${dir}"
  fi
}

# -- apply (backup + replace from assets) --------------------
do_apply() {
  banner "备份 → 替换"

  # 1. backup current
  do_backup "$now_ts"

  # 2. overwrite from assets
  echo
  local count=0
  for f in "${FILES[@]}"; do
    local asset="${ASSETS_DIR}/${f}"
    local dest="${WORKSPACE}/${f}"
    if [[ -f "$asset" ]]; then
      cp "$asset" "$dest"
      ok "替换: ${f}"
      count=$((count + 1))
    fi
  done

  echo
  info "替换完成: ${count} 个文件已从技能 assets 部署到工作区"
}

# -- diff (preview changes) ----------------------------------
do_diff() {
  banner "预览差异 (assets → workspace)"

  local any=0
  for f in "${FILES[@]}"; do
    local asset="${ASSETS_DIR}/${f}"
    local dest="${WORKSPACE}/${f}"

    if [[ ! -f "$asset" ]]; then
      continue
    fi

    if [[ ! -f "$dest" ]]; then
      warn "${f}: 工作区中不存在，将被新建"
      any=1
      continue
    fi

    if ! cmp -s "$asset" "$dest"; then
      echo "  ── ${f} ──"
      diff -u "$dest" "$asset" || true
      echo
      any=1
    fi
  done

  if [[ $any -eq 0 ]]; then
    ok "没有差异，工作区与 assets 一致"
  fi
}

# -- restore -------------------------------------------------
do_restore() {
  local target="${1:-latest}"
  local dir

  if [[ "$target" == "latest" ]]; then
    dir="${BACKUP_ROOT}/latest"
    if [[ ! -d "$dir" ]]; then
      echo "错误: 没有可用备份 (${dir} 不存在)" >&2
      exit 1
    fi
    # resolve symlink for display
    target=$(readlink "$dir" 2>/dev/null || echo "latest")
    target=$(basename "$target")
  else
    dir="${BACKUP_ROOT}/${target}"
    if [[ ! -d "$dir" ]]; then
      echo "错误: 备份不存在: ${dir}" >&2
      echo "可用备份:" >&2
      do_list >&2
      exit 1
    fi
  fi

  banner "还原备份: ${target}"

  # safety: backup current state first
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
    # skip "latest" symlink target confusion
    if [[ "$name" == "latest" ]]; then continue; fi
    if [[ "$name" == pre_restore_* ]]; then continue; fi
    entries+=("$name")
  done

  # sort descending (newest first)
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

# -- update assets from workspace ----------------------------
do_update_assets() {
  banner "更新技能 assets (workspace → assets)"

  local count=0
  for f in "${FILES[@]}"; do
    local src="${WORKSPACE}/${f}"
    local dest="${ASSETS_DIR}/${f}"
    if [[ -f "$src" ]]; then
      cp "$src" "$dest"
      ok "更新: ${f}"
      count=$((count + 1))
    fi
  done

  echo
  info "已从工作区同步 ${count} 个文件到 ${ASSETS_DIR}"
  info "如需发布，请将变更提交到 Git 仓库"
}

# -- usage ---------------------------------------------------
usage() {
  cat <<EOF
用法: sync.sh <command> [args]

命令:
  apply          备份当前配置 → 用技能 assets 覆盖工作区
  backup         仅备份当前工作区配置
  restore [ts]   还原备份（默认 latest；可指定时间戳）
  diff           预览 assets 与工作区的差异
  list           列出所有备份
  update-assets  用工作区当前配置更新技能 assets（发布前使用）

示例:
  sync.sh apply
  sync.sh restore
  sync.sh restore 2026-01-01_120000
  sync.sh diff
EOF
  exit 0
}

# -- main ----------------------------------------------------
case "${1:-}" in
  apply)
    do_apply
    ;;
  backup)
    banner "备份"
    do_backup "$now_ts"
    ;;
  restore)
    do_restore "${2:-latest}"
    ;;
  diff)
    do_diff
    ;;
  list|ls)
    do_list
    ;;
  update-assets|update_assets)
    do_update_assets
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "错误: 未知命令 '${1}'" >&2
    usage
    ;;
esac