#!/usr/bin/env sh
# Sync canonical ipss-sim skill to agent-specific copies.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CANONICAL="$ROOT/.agents/skills/ipss-sim/SKILL.md"

if [ ! -f "$CANONICAL" ]; then
  echo "error: canonical skill not found: $CANONICAL" >&2
  exit 1
fi

copy() {
  dest="$1"
  mkdir -p "$(dirname "$dest")"
  cp "$CANONICAL" "$dest"
  echo "synced -> $dest"
}

copy "$ROOT/.claude/skills/ipss-sim/SKILL.md"

if [ "${SYNC_CODEX:-0}" = "1" ] && [ -d "$HOME/.codex/skills/ipss-sim" ]; then
  copy "$HOME/.codex/skills/ipss-sim/SKILL.md"
fi

echo "done (canonical: .agents/skills/ipss-sim/SKILL.md)"
