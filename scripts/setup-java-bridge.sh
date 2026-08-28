#!/usr/bin/env bash
#
# setup-java-bridge.sh — enable the in-process java-bridge for the InterPSS DSH plugin.
#
# Why this is needed
# ------------------
# The dynamic (per-session) plugin runs in DSH's `vm` sandbox, which disables
# `require`/`process`, so it cannot load the native `java-bridge` module itself.
# Instead the PERSISTENT plugin (`@deepseek-ai/dsh-interpss`) — a full-Node ESM
# host row — loads `java-bridge`, boots one embedded JVM, and publishes it as the
# `javaBridge` Cordis service (`ctx.provide`). The dynamic plugin then consumes it
# via `ctx.get('javaBridge')` and stops shelling out to `IpssCmd`.
#
# This script:
#   1. Builds the Java Uber JAR (bundles org.interpss.agent.bridge.IpssAgentBridge).
#   2. Re-packs the persistent plugin tarball (its package.json now declares
#      the `java-bridge` dependency).
#   3. Installs it into the DSH profile with `dsh plugin` so pnpm pulls the
#      java-bridge native binaries.
#   4. Reminds you to restart DSH.
#
# Prerequisites
# -------------
#   - JDK 21, Node.js, pnpm, and `dsh` on PATH.
#   - `./mvnw` (Maven wrapper) in the repo root.
#
# Usage
# -----
#   ./scripts/setup-java-bridge.sh            # default profile: web
#   DSH_PROFILE=tui ./scripts/setup-java-bridge.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${DSH_PROFILE:-web}"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
note() { printf '\033[1;33mnote:\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

for bin in java node pnpm dsh; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin not found on PATH"
done

# 1. Build the Java Uber JAR (must contain IpssAgentBridge on the classpath).
say "Building Java Uber JAR (IpssAgentBridge + InterPSS runtime)"
(cd "$ROOT" && ./mvnw -q clean package)
[ -f "$ROOT/target/ipss-agent-cmd-1.0.0-uber.jar" ] \
  || die "uber JAR not produced at target/ipss-agent-cmd-1.0.0-uber.jar"

# 2. Re-pack the persistent plugin tarball so it includes the java-bridge dep.
say "Packing @deepseek-ai/dsh-interpss"
(cd "$ROOT/interpss-persistent" && npm pack --quiet)
TARBALL="$(ls -1 "$ROOT"/interpss-persistent/deepseek-ai-dsh-interpss-*.tgz | sort | tail -1)"
[ -n "$TARBALL" ] || die "npm pack produced no tarball"
say "Tarball: $TARBALL"

# 3. Install into the DSH profile. pnpm resolves the new `java-bridge` dependency
#    and downloads/installs its prebuilt native binary for this platform.
say "Installing plugin into the DSH '$PROFILE' profile (pnpm installs java-bridge)"
dsh plugin --profile "$PROFILE" add "$TARBALL"

note "If pnpm prints an 'allowBuilds' prompt for java-bridge, add that exact key to"
note "  \$DSH_HOME/profiles/$PROFILE/pnpm-workspace.yaml  under  onlyBuiltDependencies:"
note "and re-run this script (the install step) once more."

# 4. Restart reminder (do NOT restart from inside the script — it would kill the
#    running session; the operator restarts the web server next).
say "Install complete. Restart the web server to boot the embedded JVM:"
say "  dsh web"
say "Then hard-reload the browser. The dynamic plugin's runAclf will use the"
say "in-process bridge (no more `java -cp … IpssCmd` shell-out)."
