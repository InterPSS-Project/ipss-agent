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
renaming the repository requires reinstalling (see Troubleshooting).

## Distribution artifacts

| Artifact | Description |
| --- | --- |
| `interpss-persistent/deepseek-ai-dsh-interpss-<version>.tgz` | npm-pack tarball of the plugin package — the primary distributable. Current: **0.5.0** (older 0.2.3 … 0.4.14 tarballs are kept alongside it). |
| `interpss-persistent/` (the unpacked package source) | Point an install at this directory instead of the tarball. |
| `InstallDSHPlugin.md` | This file. |

The package declares `dsh.bundle.patch`, so installing it adds the package as a profile layer and
its `cordis.patch.yml` inserts the `interpss` row automatically — no manual patch editing. It also
declares `java-bridge` and `@deepseek-ai/dsh-typert-protocol` as dependencies, which come in with
it.

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
install the bundle at /Users/<you>/Documents/wspace/gitRepo/ipss-agent/interpss-persistent/deepseek-ai-dsh-interpss-0.5.0.tgz
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

## Finish

| Deployment | Restart |
| --- | --- |
| DSH Desktop | quit and reopen the app (profile and bridge JVM are composed at launch) |
| `dsh web` | restart the server (`dsh web`), then hard-reload the browser page |

Either way, open an **iPSS Agent** workspace; the **InterPSS** tab appears next to Chat (the tab
shows "InterPSS is not available in this workspace" otherwise).

## Troubleshooting

- **`profile "desktop" is managed exclusively by the Electron application`** — expected for *any*
  `dsh` CLI command aimed at the app's profile, including `dsh plugin`. Use Method 1.
- **The plugin stops loading after the repository moves or is renamed** — each profile pins an
  absolute `file:` path (e.g. `file:/…/ipss-agent/interpss-persistent/deepseek-ai-dsh-interpss-0.5.0.tgz`).
  Reinstall from the new location after `git clone` to a different directory.
- **Version skew between the two profiles** — the `desktop` profile currently pins 0.5.0 while
  `web` still pins `…-0.4.12.tgz`, a tarball that no longer ships in `interpss-persistent/`. An
  install into `web` fails until that dependency is re-pointed at an existing tarball (or the
  registry), e.g. `dsh plugin --profile web add /path/to/deepseek-ai-dsh-interpss-0.5.0.tgz`.
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
