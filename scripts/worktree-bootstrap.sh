#!/usr/bin/env bash
# Create a parallel OpenCode ship-prep worktree from opencode/integration.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

usage() {
  cat <<'EOF'
Usage: scripts/worktree-bootstrap.sh <slug> [allowed-glob ...]

Creates:
  branch   opencode/<slug>
  path     .worktrees/<slug>
  base     opencode/integration

Runs `sfw npm ci` in phodex-bridge/ and relay/ when package.json exists.
EOF
  exit 1
}

[[ $# -ge 1 ]] || usage

slug="$1"
shift
allowed_globs=("$@")

if [[ "${slug}" != "${slug//\//}" ]]; then
  echo "error: slug must not contain '/'" >&2
  exit 1
fi

branch="opencode/${slug}"
worktree_path="${REPO_ROOT}/.worktrees/${slug}"

if ! git show-ref --verify --quiet refs/heads/opencode/integration; then
  echo "error: branch opencode/integration does not exist. Create it from multi-agents/opencode first." >&2
  exit 1
fi

if [[ -d "${worktree_path}" ]]; then
  echo "worktree already exists: ${worktree_path}"
else
  mkdir -p "${REPO_ROOT}/.worktrees"
  git worktree add -b "${branch}" "${worktree_path}" opencode/integration
fi

run_npm_ci() {
  local dir="$1"
  if [[ -f "${dir}/package.json" ]]; then
    echo "==> npm ci in ${dir}"
    (cd "${dir}" && sfw npm ci)
  fi
}

run_npm_ci "${worktree_path}/phodex-bridge"
run_npm_ci "${worktree_path}/relay"

case "${slug}" in
  wt-0-upstream-sync)
    default_globs=("phodex-bridge/" "relay/" "package.json" "package-lock.json")
    ;;
  wt-transport-p1)
    default_globs=("phodex-bridge/src/opencode-transport.js" "phodex-bridge/test/*opencode*" "phodex-bridge/test/*transport*")
    ;;
  wt-bridge-p1)
    default_globs=("phodex-bridge/src/bridge.js" "phodex-bridge/test/*bridge*" "phodex-bridge/test/t1-8*")
    ;;
  wt-ios-fixes)
    default_globs=("CodexMobile/**/*.swift")
    ;;
  wt-ios-runtime)
    default_globs=("CodexMobile/**/*.swift")
    ;;
  wt-sim-infra)
    default_globs=("scripts/opencode-*" ".xcodebuildmcp/" "Docs/plans/opencode-sim-qa-runbook.md" "CodexMobile/**/RemodexApp*.swift")
    ;;
  *)
    default_globs=()
    ;;
esac

if [[ ${#allowed_globs[@]} -eq 0 ]]; then
  allowed_globs=("${default_globs[@]}")
fi

echo ""
echo "=== worktree bootstrap ==="
echo "branch:         ${branch}"
echo "cwd:            ${worktree_path}"
echo "integration:    opencode/integration"
if [[ ${#allowed_globs[@]} -gt 0 ]]; then
  echo "allowed globs:"
  for g in "${allowed_globs[@]}"; do
    echo "  - ${g}"
  done
else
  echo "allowed globs:  (none — coordinate with integrator)"
fi
echo "=========================="
