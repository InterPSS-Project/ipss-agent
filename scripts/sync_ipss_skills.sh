#!/usr/bin/env sh
# Sync the canonical .agents/skills tree to the agent-specific installs used here.
#
#   .agents/skills/<name>/SKILL.md      canonical. DSH discovers it as /<name> when the session
#                                       workspace is this repo (project root rank 200)
#   <DSH_HOME>/skills/<name>/SKILL.md   user-level DSH root (rank 400), so /<name> appears in the
#                                       composer's "/" menu in EVERY DSH session, whatever the
#                                       workspace -- SYNC_DSH_SKILLS=1
#   <CODEX_HOME>/prompts/<name>.md      Codex custom prompt (Codex slash command) carrying the full
#                                       skill text -- SYNC_CODEX_PROMPTS=1. An existing prompt is
#                                       kept unless SYNC_CODEX_PROMPTS_FORCE=1: some Codex prompts
#                                       are hand-written (prompts/ipss-sim.md drives the python/CLI
#                                       workflow and is not the skill).
#
# Usage: SYNC_DSH_SKILLS=1 scripts/sync_ipss_skills.sh
#        SYNC_CODEX_PROMPTS=1 scripts/sync_ipss_skills.sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SRC="$ROOT/.agents/skills"

if [ ! -d "$SRC" ]; then
  echo "error: canonical skills not found: $SRC" >&2
  exit 1
fi

if [ "${SYNC_DSH_SKILLS:-0}" != "1" ] && [ "${SYNC_CODEX_PROMPTS:-0}" != "1" ]; then
  echo "nothing to do: set SYNC_DSH_SKILLS=1 and/or SYNC_CODEX_PROMPTS=1" >&2
  echo "  SYNC_DSH_SKILLS=1     install every skill under ${DSH_HOME:-$HOME/.dsh}/skills" >&2
  echo "  SYNC_CODEX_PROMPTS=1  install every skill as a prompt under ${CODEX_HOME:-$HOME/.codex}/prompts" >&2
  exit 2
fi

# body only: drop the leading YAML frontmatter block (a prompt file's frontmatter is read as its
# own metadata, not as skill metadata)
body() {
  awk 'n < 2 && /^---[[:space:]]*$/ { n++; next } n >= 2 { print }' "$1"
}

# one-line description for a prompt file: metadata.short-description, else the first sentence
# of the skill description, else the folder name
describe() {
  desc="$(sed -n 's/^[[:space:]]*short-description:[[:space:]]*//p' "$1" | head -1)"
  if [ -z "$desc" ]; then
    desc="$(sed -n 's/^description:[[:space:]]*//p' "$1" | head -1 | sed 's/\. Use when.*$//; s/\.$//')"
  fi
  [ -n "$desc" ] || desc="$2"
  printf '%s' "$desc" | tr -d '"'
}

# ---- Codex custom prompts (the Codex slash commands) ------------------------
if [ "${SYNC_CODEX_PROMPTS:-0}" = "1" ]; then
  prompts="${CODEX_HOME:-$HOME/.codex}/prompts"
  mkdir -p "$prompts"
  for dir in "$SRC"/*/; do
    name="$(basename "$dir")"
    skill="$dir/SKILL.md"
    [ -f "$skill" ] || continue

    dest="$prompts/$name.md"
    if [ -f "$dest" ] && [ "${SYNC_CODEX_PROMPTS_FORCE:-0}" != "1" ] &&
       ! grep -q 'Generated from .agents/skills' "$dest"; then
      echo "prompt  -> $dest (hand-written, kept; SYNC_CODEX_PROMPTS_FORCE=1 overwrites)"
      continue
    fi

    {
      printf -- '---\ndescription: %s\n---\n' "$(describe "$skill" "$name")"
      printf '<!-- Generated from .agents/skills/%s/SKILL.md (canonical).\n' "$name"
      printf '     Regenerate with: SYNC_CODEX_PROMPTS=1 scripts/sync_ipss_skills.sh -->\n\n'
      body "$skill"
      printf '\n---\n\n**This invocation:** $ARGUMENTS\n'
    } > "$dest"

    if [ -s "$dest" ]; then
      echo "prompt  -> $dest"
    else
      echo "error: could not write $dest (outside the write sandbox?)" >&2
    fi
  done
fi

# ---- DSH user-level skills --------------------------------------------------
# DSH scans <projectRoot>/.agents/skills for sessions opened in this repo, and the user root
# <DSH_HOME>/skills (default ~/.dsh/skills) for every session. Copying each skill bundle there
# makes /<name> available from the composer's "/" menu everywhere, not just inside this repo.
if [ "${SYNC_DSH_SKILLS:-0}" = "1" ]; then
  dsh_skills="${DSH_HOME:-$HOME/.dsh}/skills"
  mkdir -p "$dsh_skills"
  for dir in "$SRC"/*/; do
    name="$(basename "$dir")"
    skill="$dir/SKILL.md"
    [ -f "$skill" ] || continue

    dest="$dsh_skills/$name/SKILL.md"
    mkdir -p "$(dirname "$dest")"
    cp "$skill" "$dest"

    if [ -s "$dest" ]; then
      echo "dsh     -> $dest"
    else
      echo "error: could not write $dest (outside the write sandbox?)" >&2
    fi
  done
fi

# ---- Codex skill copy (ipss-sim only) ---------------------------------------
if [ "${SYNC_CODEX:-0}" = "1" ] && [ -d "$HOME/.codex/skills/ipss-sim" ]; then
  dest="$HOME/.codex/skills/ipss-sim/SKILL.md"
  cp "$SRC/ipss-sim/SKILL.md" "$dest"
  echo "skill   -> $dest"
fi
