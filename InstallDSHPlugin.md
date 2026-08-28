# Installing the InterPSS DSH Plugin (persistent)

The InterPSS capability is distributed as a **persistent** Cordis plugin
(`@deepseek-ai/dsh-interpss`): a real composition row mounted through the web
profile's `cordis.patch.yml`, so the InterPSS tab survives restarts.

## Distribution artifacts

| Artifact | Description |
| --- | --- |
| `deepseek-ai-dsh-interpss-<version>.tgz` | npm-pack tarball of the plugin package — the primary distributable. |
| `dsh-interpss/` (or the package source in `interpss-persistent/`) | The unpacked plugin package — copy it under the profile's `node_modules/@deepseek-ai/` (Method 2) or point `dsh plugin` at it (Method 1). |
| `InstallDSHPlugin.md` | This file. |

## Prerequisites

- DeepSeek Harness installed (`dsh` on `PATH`, `pnpm` on `PATH` for Method 1).
- An **iPSS Agent** workspace (the InterPSS tab activates only when the
  workspace `README.md`'s first `# H1` is exactly `iPSS Agent`), including:
  - **Java JDK 21** on `PATH`
  - Built CLI: `target/ipss-agent-cmd-1.0.0-uber.jar` (run `./mvnw -q clean package` from the project root; see [Setup.md](Setup.md))
  - `src/`, `wspace/data/**`, and `config/` (including `config/aclf_run.json`)

## Method 1 — `dsh plugin` (automatic, recommended)

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

## Method 2 — manual copy (no pnpm needed)

```sh
mkdir -p "$DSH_HOME/profiles/web/node_modules/@deepseek-ai"
cp -R /path/to/dsh-interpss "$DSH_HOME/profiles/web/node_modules/@deepseek-ai/"
```

Then add one row to `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: interpss
      name: '@deepseek-ai/dsh-interpss'
```

## Finish

1. Restart the web server: `dsh web`.
2. Hard-reload the browser page.
3. Open an **iPSS Agent** workspace; the **InterPSS** tab appears next to Chat
   (the tab shows "InterPSS is not available in this workspace" otherwise).

## Troubleshooting

- **Tab does not appear** — confirm the `interpss` row is present in
  `$DSH_HOME/profiles/web/cordis.patch.yml` (or in `dsh.profile.bundles` in
  `$DSH_HOME/profiles/web/package.json` after Method 1) and that the package
  files exist under `$DSH_HOME/profiles/web/node_modules/@deepseek-ai/dsh-interpss/`.
- **RPC errors in the browser console** — make sure the package is under the
  profile's `node_modules` so its ESM imports resolve against the harness
  module fallback at `$DSH_HOME/profiles/node_modules`.
- **Activation gate** — the workspace root's `README.md` must have exactly
  `# iPSS Agent` as its first H1.

## Uninstall

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-interpss   # Method 1
rm -rf "$DSH_HOME/profiles/web/node_modules/@deepseek-ai/dsh-interpss"   # Method 2
```

Then delete the `interpss` row from `cordis.patch.yml` (Method 2 only) and
restart `dsh web`.
