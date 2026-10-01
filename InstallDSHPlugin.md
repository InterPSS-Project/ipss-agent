# Installing the InterPSS DSH Plugin (persistent)

The InterPSS capability is distributed as a **persistent** Cordis plugin
(`@deepseek-ai/dsh-interpss`): a real composition row mounted through a DSH profile's
`cordis.patch.yml`, so the InterPSS tab survives restarts.

This workspace is used from two DSH deployments, and **the install path differs**:

| Deployment | Profile | How plugins get in |
| --- | --- | --- |
| **DSH Desktop** (Electron app) | `desktop` | the app's **plugin manager** — the `dsh` CLI refuses this profile |
| **DSH web / CLI** (`dsh web`) | `web` | `dsh plugin --profile web …`, or a manual copy |

Both profiles reference the plugin by an **absolute path into this repository**, so moving or
renaming the repository requires reinstalling (see Troubleshooting). Both deployments share
`$DSH_HOME` (default `~/.dsh`), so one profile's plugin copy and the user-level skills below are
visible to the other.

> The plugin registers **no** slash command. The `/ipss-case-*` entries in the composer's `/` menu
> are **skills** this repository ships under `.agents/skills/`, installed separately — see
> [Slash commands](#slash-commands-skills).

## Distribution artifacts

| Artifact | Description |
| --- | --- |
| `interpss-persistent/deepseek-ai-dsh-interpss-<version>.tgz` | npm-pack tarball of the plugin package — the primary distributable. Current: **0.6.18** (older 0.2.3 … 0.6.17 tarballs are kept alongside it). |
| `interpss-persistent/` (the unpacked package source) | Point an install at this directory instead of the tarball. |
| `InstallDSHPlugin.md` | This file. |

The package declares `dsh.bundle.patch`, so installing it adds the package as a profile layer and
its `cordis.patch.yml` inserts the `interpss` row automatically — no manual patch editing. It also
declares `java-bridge` and `@deepseek-ai/dsh-typert-protocol` as dependencies, which come in with
it.

Verified in this repository on **DSH Desktop 0.1.7-rc.2** (nightly, macOS arm64; the harness is
bundled at `…/DeepSeek Harness.app/Contents/Resources/app.asar/dsh`) with `@deepseek-ai/dsh-interpss`
**0.6.18**, installed into `~/.dsh/profiles/desktop` — the profile the Desktop app serves the GUI
from. **The Desktop profile is the only supported target at this stage.** The `dsh web` surface
runs its harness from `$DSH_HOME/profiles/node_modules` with its own, older profile, so a UI
difference seen there is not a plugin bug.

## Prerequisites

- **DSH Desktop** installed, or a `dsh` CLI on `PATH` (with `pnpm` on `PATH` for the CLI methods).
- An **iPSS Agent** workspace (the InterPSS tab activates only when the workspace `README.md`'s
  first `# H1` is exactly `iPSS Agent`), including:
  - **Java JDK 21** on `PATH`
  - Built CLI: `target/ipss-agent-cmd-1.0.0-uber.jar` (run `./mvnw -q clean package` from the project root; see [Setup.md](Setup.md))
  - `src/`, `wspace/data/**`, and `config/` (including `config/aclf_run.json`)
- The in-process Java bridge for the tab: run `scripts/setup-java-bridge.sh`, then restart the
  deployment (see [Setup.md](Setup.md) for the `-Xmx8g` bridge heap guidance).

## Method 1 — DSH Desktop (the app's plugin manager)

The Desktop app owns the `desktop` profile, and the CLI will not touch it:

```text
$ dsh plugin --profile desktop --version
error: profile "desktop" is managed exclusively by the Electron application
```

So install through the app's plugin manager. In any DSH Desktop chat, ask the agent to do it —
that is the `plugin_manager` tool (`list_bundles`, `install_bundle`, `remove_bundle`,
`list_plugins`, `set_bundle`):

```text
list the plugin bundles in this profile
```

```text
install the bundle at /Users/<you>/Documents/wspace/gitRepo/ipss-agent/interpss-persistent/deepseek-ai-dsh-interpss-0.5.1.tgz
```

The tool requires the full-access permission mode and asks for approval before it changes the
profile. Behind the scenes it runs `pnpm add` inside `$DSH_HOME/profiles/desktop`, then appends
`@deepseek-ai/dsh-interpss` to `dsh.profile.bundles` in that profile's `package.json`; the pnpm
transcript is kept at `$DSH_HOME/profiles/desktop/.plugin-manager/logs/operation-*/pnpm.log`.

Verify the install landed:

```sh
python3 -c "import json;d=json.load(open('$HOME/.dsh/profiles/desktop/package.json'));print(d['dsh']['profile']['bundles'])"
ls "$HOME/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-interpss"
```

The bundle list should name `@deepseek-ai/dsh-interpss` next to `@deepseek-ai/dsh-base` and
`@deepseek-ai/dsh-web-app`, and the package directory should exist.

Then **quit and reopen the app**: the `desktop` profile is composed at launch, and the InterPSS
tab plus its bridge JVM start with it.

## Method 2 — `dsh plugin` (web profile)

From any directory:

```sh
dsh plugin --profile web add /path/to/deepseek-ai-dsh-interpss-<version>.tgz
```

or, pointing at the unpacked package directory:

```sh
dsh plugin --profile web add /path/to/dsh-interpss
```

`dsh plugin` forwards to pnpm in the profile directory, then reconciles
`dsh.profile.bundles`: because the package declares `dsh.bundle.patch`, it is
added as a profile layer, and its `cordis.patch.yml` inserts the `interpss`
row automatically — no manual patch editing.

> If you install from a git-hosted URL, pnpm may block its `prepare` script;
> allow the exact key pnpm prints under `allowBuilds` in
> `$DSH_HOME/profiles/<name>/pnpm-workspace.yaml`, then re-run.

## Method 3 — manual copy (either profile, no pnpm)

```sh
PROFILE=web        # or: PROFILE=desktop
mkdir -p "$DSH_HOME/profiles/$PROFILE/node_modules/@deepseek-ai"
cp -R /path/to/interpss-persistent "$DSH_HOME/profiles/$PROFILE/node_modules/@deepseek-ai/dsh-interpss"
```

Then add one row to `$DSH_HOME/profiles/$PROFILE/cordis.patch.yml`:

```yaml
- insert:
    - id: interpss
      name: '@deepseek-ai/dsh-interpss'
```

For `desktop`, prefer Method 1: the app keeps its own profile metadata, and a hand-copied package
with no matching `dsh.profile.bundles` entry is not composed into the app.

## Slash commands (skills)

The plugin registers **no** slash command. Every `/ipss-case-*` entry in the composer's `/` menu is a
**skill** this repository ships under `.agents/skills/`: `/ipss-case-load`, `/ipss-case-aclf`,
`/ipss-case-aclf-adjust`, `/ipss-case-info`, `/ipss-case-ca`, `/ipss-case-script`,
`/ipss-case-summary`, `/ipss-sim`, `/nerc-report-html`, `/nerc-report-slides`. DSH discovers them;
`@deepseek-ai/dsh-interpss` has no part in it, so a working InterPSS tab does not imply working
commands (or the other way round).

DSH reads skills from these roots:

| Root | Rank | Seen by |
| --- | --- | --- |
| `<projectRoot>/.agents/skills/<name>/SKILL.md` | project (200) | sessions whose workspace is this repo |
| `$DSH_HOME/skills/<name>/SKILL.md` (default `~/.dsh/skills`) | user (400) | every session, every workspace |
| `~/.agents/skills/<name>/SKILL.md` | user | every session, every workspace |

`<projectRoot>` is the nearest ancestor of the session workspace that holds `.git`. Both deployments
read the same `$DSH_HOME`, so one user-level sync covers DSH Desktop and `dsh web`:

```sh
SYNC_DSH_SKILLS=1 scripts/sync_ipss_skills.sh     # .agents/skills -> $DSH_HOME/skills
```

Verify: type `/` in the composer and look for `ipss-case-load`, or ask the agent to load one (the
`skill` tool with `ipss-case-load`). A skill appears only when its `SKILL.md` parses (`name` and
`description` frontmatter) and stays user-invocable: `user-invocable: false` hides it from `/`, and
`disable-model-invocation: true` keeps it out of the model's catalog while leaving the command.

### DSH Desktop: the `cordis` preset can lose every skill

Verified on **DSH Desktop 0.1.7-rc.2**: the `cordis` Agent preset mounts `skill-filesystem` with
`customSkillDirs` pointing at `@deepseek-ai/dsh-agent-preset/skills`, which in a packaged Desktop
resolves **inside `app.asar`**. The Host fs service cannot stat asar paths — its `bigint` stat mixes
with Electron's asar stats and throws `Cannot mix BigInt and other types, use explicit conversions` —
so the provider's `list()` aborts and the registry drops that provider **whole**: no skill from any
root reaches the catalog, and `/ipss-case-*` never appears in the menu.

Nothing falls back to it either: the `dsh-web-app` bundle disables the host-plane `skill-filesystem`
row ("presets own local discovery"), leaving each preset's row as the only provider. Re-enable the
host-plane row in the profile patch — the registry's global layer is read by every preset's scope
chain, and this config names no asar path:

`$DSH_HOME/profiles/desktop/cordis.patch.yml`

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  disabled: false
  config:
    dshHome: !!js dshHomePath()
    includeDefaultRoots: true
    customSkillDirs: []
```

The profile patch is picked up live (the row goes from `inactive` to a mounted schema with no
restart); refresh the window (⌘R) afterwards, because the client caches the catalog it fetched for
the session. Never point `customSkillDirs` or `bundledSkillDir` at an `app.asar` path — that
reintroduces the failure.

## Finish

| Deployment | Restart |
| --- | --- |
| DSH Desktop | quit and reopen the app (profile and bridge JVM are composed at launch) |
| `dsh web` | restart the server (`dsh web`), then hard-reload the browser page |

Either way, open an **iPSS Agent** workspace; the **InterPSS** tab appears next to Chat (the tab
shows "InterPSS is not available in this workspace" otherwise). Then confirm the commands — `/` in
the composer lists the `ipss-case-*` skills ([Slash commands](#slash-commands-skills)); on Desktop,
refresh the window first.

## Troubleshooting

- **`/ipss-case-*` missing from the composer's `/` menu** — the commands are skills, not plugin
  commands ([Slash commands](#slash-commands-skills)). On Desktop, apply the `skill-filesystem`
  profile patch there first, then refresh the window; otherwise sync the user root
  (`SYNC_DSH_SKILLS=1 scripts/sync_ipss_skills.sh`) when the workspace is not this repo. A `SKILL.md`
  that fails to parse is skipped silently, and `user-invocable: false` hides one by design.
- **InterPSS tool cards not visible in Chat** — the chat folds a completed turn's tool steps into a
  collapsible **Process / Steps** line; the cards are inside it. Keep them inline with
  **Settings → General → Work details → Verbose** (`ui-chat.transcriptView: verbose` in the profile
  patch — only `verbose` sets `foldCompletedTurns: false`).
- **`profile "desktop" is managed exclusively by the Electron application`** — expected for *any*
  `dsh` CLI command aimed at the app's profile, including `dsh plugin`. Use Method 1.
- **The plugin stops loading after the repository moves or is renamed** — each profile pins an
  absolute `file:` path (e.g. `file:/…/ipss-agent/interpss-persistent/deepseek-ai-dsh-interpss-0.6.18.tgz`).
  Reinstall from the new location after `git clone` to a different directory.
- **Version skew between the two profiles** — the `desktop` profile pins 0.6.18. The `web`
  profile is on **0.5.1** and is deliberately **out of scope at this stage**: it has no Diagram
  tab and no sortable result tables, so do not read a difference there as a regression.
  Bringing it forward needs its dependency re-pointed at an existing tarball, e.g.
  `dsh plugin --profile web add /path/to/deepseek-ai-dsh-interpss-0.6.18.tgz`.
- **Tab does not appear** — confirm the `interpss` row is present in
  `$DSH_HOME/profiles/<profile>/cordis.patch.yml` (or in `dsh.profile.bundles` in that profile's
  `package.json` after Method 1/2) and that the package files exist under
  `$DSH_HOME/profiles/<profile>/node_modules/@deepseek-ai/dsh-interpss/`.
- **RPC errors in the browser console** — make sure the package is under the
  profile's `node_modules` so its ESM imports resolve against the harness
  module fallback at `$DSH_HOME/profiles/node_modules`.
- **Activation gate** — the workspace root's `README.md` must have exactly
  `# iPSS Agent` as its first H1.
- **Bundle refused for a version mismatch** — the plugin manager blocks bundles whose DSH peer
  dependency does not match the runtime. It can list and grant a **version exemption** for an exact
  `package@version` pair; only grant one after accepting that a mismatched plugin can crash the
  session or corrupt profile data.

## Uninstall

| Deployment | Remove |
| --- | --- |
| DSH Desktop | ask the agent to remove the bundle (plugin manager `remove_bundle`), then reopen the app |
| `dsh web` (Method 2) | `dsh plugin --profile web remove @deepseek-ai/dsh-interpss`, then restart `dsh web` |
| Manual copy (Method 3) | `rm -rf "$DSH_HOME/profiles/<profile>/node_modules/@deepseek-ai/dsh-interpss"`, delete the `interpss` row from that profile's `cordis.patch.yml`, then restart that deployment |
| Skills (either deployment) | `rm -rf "$DSH_HOME/skills/<name>"` per skill, and delete the `skill-filesystem` entry this doc adds to the Desktop profile patch |
