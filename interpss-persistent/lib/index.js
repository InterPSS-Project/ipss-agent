// InterPSS persistent dual-face plugin — Host half.
//
// This is the host plane of `@deepseek-ai/dsh-interpss`. It provides the
// `interpss` Cordis service and exports its methods through the Typert Remote
// gateway (SRC mode: plain-JSON parameters and results, no build-time
// compiler). The browser Client half (`lib/client.js`) calls these methods as
// `/api` RPC endpoints `interpss/<method>`.
//
// The activation gate is unchanged from the dynamic plugin: the tab only
// offers the tool when the workspace README.md's first H1 is exactly
// "iPSS Agent".

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

// Diagnostic sink (portable, in the OS temp dir) so the agent can read, after a
// restart, whether this plugin's apply() ran and what it did — without access
// to the dsh web process stderr. Cleared on module load, then appended.
const DIAG = tmpdir() + '/dsh-interpss-diagnostic.log'
try { writeFileSync(DIAG, '', 'utf8') } catch {}
function diag(line) {
  try { appendFileSync(DIAG, line + '\n', 'utf8') } catch {}
}

// Persist a run-config JSON the ACLF/CA dialogs own. The DSH `fs` service fences every
// mutation against the deployment's writable roots, and in an app-hosted profile that
// root can be narrower than the workspace this plugin resolved — the dialog then fails
// with FS_SANDBOX_DENIED for a path that is inside the session's own workspace (the
// bash/fs tools, bound to the session, still write there). Both callers build the target
// from that resolved root and the case folder, never from caller text, so a fenced write
// falls back to node:fs — the same unfenced mechanism this plugin already uses for its
// diagnostic log and its JDK probe.
async function writeConfigText(fs, target, text, directPath) {
  try {
    await fs.writeText(target, text)
    return { ok: true, via: 'fs' }
  } catch (e) {
    const message = e && e.message ? e.message : String(e)
    if (!/file access denied|FS_SANDBOX_DENIED|sandbox mode/i.test(message)) return { ok: false, error: message }
    // `fs.resolve()` hands back an opaque handle, which node:fs cannot open: the direct
    // write needs the absolute path string the caller built.
    const direct = typeof directPath === 'string' && directPath !== ''
      ? directPath
      : (typeof target === 'string' ? target : (target && typeof target.path === 'string' ? target.path : ''))
    if (direct === '') {
      return { ok: false, error: message + '; no filesystem path was available for a direct write' }
    }
    try {
      writeFileSync(direct, text, 'utf8')
      diag('fenced fs write, persisted via node:fs: ' + direct)
      return { ok: true, via: 'node:fs' }
    } catch (e2) {
      return {
        ok: false,
        error: message + '; direct write of ' + direct + ' failed: ' + (e2 && e2.message ? e2.message : String(e2)),
      }
    }
  }
}

const NAMESPACE = 'interpss'
const PACKAGE = '@deepseek-ai/dsh-interpss'
const METHODS = ['isActivated', 'checkResult', 'checkResultFiles', 'listCases', 'readCsv', 'busConnections', 'runAclf', 'runCa', 'runReport', 'getAclfOptions', 'saveAclfOptions', 'listCaFiles', 'getCaOptions', 'saveCaOptions', 'loadCase', 'summarizeResult', 'getNetworkInfo', 'getBridgeCase', 'listDrawioFiles', 'readDrawio', 'openDrawio']

function jsonParam(name, wire) {
  return { name, wire, source: 'json', codec: { mode: 'src-json' } }
}

function shellQuote(value) {
  return "'" + String(value) + "'"
}

// --- Windows/java-bridge JVM discovery -------------------------------------
// java-bridge locates the embedded JVM exclusively through process.env.JAVA_HOME
// at ensureJvm() time. On Windows that variable is frequently missing from the
// harness environment (it inherits the launching shell), so before starting the
// JVM we self-discover a JDK and set JAVA_HOME. The same discovery feeds the
// `java` launcher used by the CLI shell fallback.

function javaHomeValid(home) {
  if (typeof home !== 'string' || home === '') return false
  const bin = home + '/bin'
  return existsSync(bin + (process.platform === 'win32' ? '/java.exe' : '/java'))
}

function discoverJavaHome() {
  if (javaHomeValid(process.env.JAVA_HOME)) return process.env.JAVA_HOME
  const roots = []
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    roots.push(pf + '\\Java', pf + '\\Eclipse Adoptium')
  } else if (process.platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines', '/System/Library/Java/JavaVirtualMachines')
  } else {
    roots.push('/usr/lib/jvm')
  }
  let best = null
  let bestVer = -1
  for (const root of roots) {
    let entries = []
    try { entries = readdirSync(root) } catch (e) { continue }
    for (const name of entries) {
      if (!/^jdk/i.test(name)) continue
      const home = root + '/' + name
      // On Windows require the server JVM library specifically (bin\server\jvm.dll)
      // so JRE-only or broken layouts are skipped.
      if (process.platform === 'win32') {
        if (!existsSync(home + '\\bin\\server\\jvm.dll')) continue
      } else if (!javaHomeValid(home)) {
        continue
      }
      const m = /jdk[-_]?(\d+)/i.exec(name)
      const ver = m ? parseInt(m[1], 10) : 0
      if (ver > bestVer) { bestVer = ver; best = home }
    }
  }
  return best
}

// Resolved `java` launcher: an absolute path under a discovered JAVA_HOME when
// available (handles "C:\Program Files\Java\..." spaces), else the bare `java`
// (resolved via PATH by the shell).
function javaBin() {
  const home = discoverJavaHome()
  return home ? home + '/bin/java' + (process.platform === 'win32' ? '.exe' : '') : 'java'
}

const DESCRIPTORS = METHODS.map((method) => ({
  id: `${NAMESPACE}:${method}`,
  service: NAMESPACE,
  namespace: NAMESPACE,
  method,
  invocation: { kind: 'direct' },
  parameters: [jsonParam('input', 'input')],
  result: { mode: 'src-json' },
}))

// --- Chat tools: shared helpers ---------------------------------------------
// The InterPSS tab owns "the current simulation case". Every selection change
// in the tab (preset switch, custom path, file picker, remount) already calls
// the `checkResult` RPC, so the Host records the selection there instead of
// adding a client-side call or a new Typert endpoint.
const CASE_PATH_RE = /^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/
// Anchor on the unique "/wspace/data/" marker: the DSH home itself may live
// under a directory also named "wspace" (e.g. ~/Documents/wspace/…).
const WS_DATA_MARKER = '/wspace/data/'

const selectedCaseBySession = new Map()

function sessionKey(sessionId) {
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : ''
}

function formatOfCasePath(casePath) {
  return /\.raw$/i.test(casePath) ? 'psse' : 'ieee'
}

// Record (or clear, for an empty path) the case selected in the InterPSS tab.
function rememberSelectedCase(sessionId, casePath, format) {
  const key = sessionKey(sessionId)
  if (typeof casePath !== 'string' || casePath === '') {
    selectedCaseBySession.delete(key)
    return
  }
  selectedCaseBySession.set(key, {
    input: casePath,
    format: format === 'psse' ? 'psse' : formatOfCasePath(casePath),
  })
}

function selectedCaseFor(sessionId) {
  return selectedCaseBySession.get(sessionKey(sessionId)) || null
}

// Host-side mirror of the tab's preset list (lib/client.js `PRESETS`).
const IPSS_PRESETS = [
  { label: 'ieee 118-bus', format: 'ieee', input: 'data/ieee/Ieee118Bus/ieee118.ieee' },
  { label: 'ieee 14-bus', format: 'ieee', input: 'data/ieee/Ieee14Bus/ieee14.ieee' },
  { label: 'texas 2k-bus', format: 'psse', input: 'data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW' },
]

// A session renders workspace files as `wspace/data/…` (that is the form an @-reference
// and the file surfaces show), so accept that prefix — and its `./` spelling — wherever a
// `data/…` selector is expected. It is a pure prefix strip: the `data/` form is still
// what every regex and every bridge call sees.
function stripWspacePrefix(value) {
  let text = String(value).trim()
  for (;;) {
    if (text.startsWith('./')) {
      text = text.slice(2)
      continue
    }
    if (text.startsWith('wspace/')) {
      text = text.slice('wspace/'.length)
      continue
    }
    return text
  }
}

// Accept a workspace-relative data/… path (optionally written as wspace/data/…), an
// absolute path containing /wspace/data/, or an exact preset label.
function resolveCaseArgument(raw) {
  const value = stripWspacePrefix(raw)
  if (value === '') return { ok: false, error: 'empty case selector' }
  for (const preset of IPSS_PRESETS) {
    if (preset.label === value.toLowerCase()) return { ok: true, input: preset.input, format: preset.format }
  }
  if (CASE_PATH_RE.test(value)) return { ok: true, input: value, format: formatOfCasePath(value) }
  const marker = value.indexOf(WS_DATA_MARKER)
  if (marker >= 0) {
    const rel = 'data/' + value.slice(marker + WS_DATA_MARKER.length)
    if (CASE_PATH_RE.test(rel)) return { ok: true, input: rel, format: formatOfCasePath(rel) }
  }
  return {
    ok: false,
    error: 'unrecognized case selector "' + value + '"; expected a data/... case path (wspace/data/... is ' +
      'accepted too), an absolute path containing ' + WS_DATA_MARKER + ', or a preset label (' +
      IPSS_PRESETS.map((preset) => preset.label).join(', ') + ')',
  }
}

function relativeCasePath(absPath) {
  const marker = String(absPath).indexOf(WS_DATA_MARKER)
  return marker >= 0 ? 'data/' + String(absPath).slice(marker + WS_DATA_MARKER.length) : String(absPath)
}

// --- Chat tools: DC contingency analysis -------------------------------------
// A CA input file is addressed the way the tab's dialog addresses it: relative to
// wspace/ ("data/<case dir>/x.json"). A bare name resolves inside the *resolved case's*
// folder, so the common case needs no path at all.
function resolveCaFileArgument(caseInput, raw) {
  const value = typeof raw === 'string' ? stripWspacePrefix(raw) : ''
  if (value === '') return { ok: false, error: 'empty JSON file selector' }
  if (value.indexOf('..') >= 0) return { ok: false, error: 'the file path must not contain "..": ' + value }
  const pathRe = /^data\/[A-Za-z0-9_.\/-]+\.json$/i
  if (pathRe.test(value)) return { ok: true, input: value }
  if (!value.includes('/') && /\.json$/i.test(value)) {
    const { parent } = casePartsOf(caseInput)
    return { ok: true, input: wspaceJoin(parent, value) }
  }
  const marker = value.indexOf(WS_DATA_MARKER)
  if (marker >= 0) {
    const candidate = 'data/' + value.slice(marker + WS_DATA_MARKER.length)
    if (pathRe.test(candidate)) return { ok: true, input: candidate }
  }
  return {
    ok: false,
    error: 'unrecognized JSON file selector "' + value + '": expected a file name in the case folder, ' +
      'a data/... path (wspace/data/... is accepted too), or an absolute path containing ' + WS_DATA_MARKER,
  }
}

// The Java runner prints ContAnalysisSummary as "Label=value" lines; lift the numbers so
// the card can show them without the caller parsing that text.
function parseCaSummary(text) {
  const pick = (label) => {
    const m = new RegExp(label + '=([0-9.]+)').exec(String(text === null || text === undefined ? '' : text))
    return m ? Number(m[1]) : null
  }
  return {
    threshold: pick('Threshold'),
    contingencies: pick('Contingencies'),
    monitoredBranches: pick('Monitored Branches'),
    overloads: pick('Overloading Branches'),
  }
}

// --- Chat tools: Groovy scenario scripts -------------------------------------
// A scenario script lives next to the case it edits: wspace/data/<case dir>/scripts/<name>.gvy.
// The Java runner reads the file and evaluates it against the bridge-held network
// under the `aclfnet` binding (docs/groovy-script-adapter-architecture.md), so the
// Host only has to decide *which* file, and refuse anything outside that folder.
const GVY_SCRIPT_PATH_RE = /^data\/[A-Za-z0-9_.\/-]+\/scripts\/[A-Za-z0-9_.\/-]+\.gvy$/
const GVY_MAX_LISTED = 20
const GVY_STDOUT_LIMIT = 8000
// A batch is a scenario sequence, not a script library: cap it so one call cannot run away.
const GVY_MAX_SCRIPTS = 20
// The `script` argument carries the adapter's two entry points (see
// docs/groovy-script-adapter-architecture.md): a .gvy file selector, or the Groovy
// source itself. A value is a selector when it can name a file — it ends in .gvy,
// carries a path separator, or is a bare name (the form that already failed as an
// "unrecognized script selector"). Whitespace or statement punctuation means source.
const GVY_CODE_PUNCT_RE = /[\s;{}()'"=,+\*%<>&|!?[\]:@]/
const GVY_BARE_NAME_RE = /^[A-Za-z0-9_-]+$/
// A workspace-level fixtures folder, beside the case folders: wspace/script/*.gvy. The
// Host reads these itself and hands the JVM the source (the Java rule confines *file*
// scripts to the case folder), so a shared what-if script no longer needs a copy per case.
const GVY_WORKSPACE_SCRIPT_RE = /^script\/[A-Za-z0-9_.\/-]+\.gvy$/i
const GVY_WORKSPACE_MARKER = '/wspace/script/'

// Mirrors GvyScriptRunner.MAX_SCRIPT_BYTES; the JVM enforces the byte limit itself.
const GVY_SOURCE_MAX_CHARS = 256 * 1024

// Decide whether `script` names a file or is inline Groovy source.
function classifyGvyArgument(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') return { kind: 'none' }
  if (GVY_CODE_PUNCT_RE.test(value)) return { kind: 'source', value }
  if (/\.gvy$/i.test(value)) return { kind: 'file', value }
  if (GVY_BARE_NAME_RE.test(value)) return { kind: 'file', value }
  if (value.includes('/')) return { kind: 'file', value }
  return { kind: 'source', value }
}

// The label an inline script carries in the result and on the card; no file name exists.
function gvySourceLabel(source) {
  const lines = String(source).split('\n').length
  return 'inline Groovy (' + lines + (lines === 1 ? ' line)' : ' lines)')
}

// Inline source needs the same guard rails as a file: non-empty and bounded.
function validateGvySource(value) {
  const source = typeof value === 'string' ? value : ''
  if (source.trim() === '') {
    return { ok: false, error: 'the `script` argument is empty' }
  }
  if (source.length > GVY_SOURCE_MAX_CHARS) {
    return {
      ok: false,
      error: 'the inline script is too large (' + source.length + ' characters; limit ' + GVY_SOURCE_MAX_CHARS + ')',
    }
  }
  return { ok: true, source: source }
}

// `script` is one .gvy selector, one inline source, or an **array** of those applied in
// order (0.4.11+). Every entry is resolved up front, so a bad second selector fails the
// call before the first script has touched the model. Returns { ok, kind, steps } with
// one step per script: { kind: 'file'|'source', input?, abs?, source?, label }.
async function resolveGvyArguments(ctx, root, caseInput, raw) {
  const list = Array.isArray(raw) ? raw : [raw]
  const batch = Array.isArray(raw)
  if (list.length === 0) {
    return { ok: false, error: 'the `script` argument is empty: pass a .gvy file name, Groovy source, or an array of those' }
  }
  if (list.length > GVY_MAX_SCRIPTS) {
    return { ok: false, error: 'too many scripts in one call: ' + list.length + ' (limit ' + GVY_MAX_SCRIPTS + ')' }
  }
  const steps = []
  for (let i = 0; i < list.length; i++) {
    const where = batch ? ' (script ' + (i + 1) + ' of ' + list.length + ')' : ''
    const argument = classifyGvyArgument(list[i])
    if (argument.kind === 'none') {
      return {
        ok: false,
        error: batch
          ? 'script ' + (i + 1) + ' of ' + list.length + ' is empty: pass a .gvy file name, Groovy source, or null to skip'
          : 'the `script` argument is required: a .gvy file name in <case folder>/scripts/ ' +
            '(for example "ieee14_adjBus14.gvy"), a data/.../scripts/x.gvy path, or the Groovy source itself',
      }
    }
    if (argument.kind === 'file') {
      const script = await resolveGvyScript(ctx, root, caseInput, argument.value)
      if (script.ok !== true) return { ok: false, error: script.error + where }
      if (script.workspace === true) {
        // Evaluated as source: the file lives outside the case folder, and only the
        // Host opens it. The label stays the path the caller asked for.
        const fs = ctx.get('fs')
        let text = null
        try {
          text = await fs.readText(await fs.resolve(script.abs))
        } catch (e) {
          return { ok: false, error: 'could not read ' + script.input + ': ' + (e && e.message ? e.message : String(e)) + where }
        }
        const checked = validateGvySource(text)
        if (checked.ok !== true) return { ok: false, error: checked.error + where }
        steps.push({ kind: 'source', source: checked.source, label: script.input })
      } else {
        steps.push({ kind: 'file', input: script.input, abs: script.abs, label: script.input })
      }
    } else {
      const checked = validateGvySource(argument.value)
      if (checked.ok !== true) return { ok: false, error: checked.error + where }
      steps.push({ kind: 'source', source: checked.source, label: gvySourceLabel(checked.source) })
    }
  }
  return { ok: true, kind: batch ? 'batch' : 'single', steps: steps }
}

// Resolve the `script` argument to a workspace-relative .gvy path under the case's
// scripts/ folder, then confirm it exists. Returns { ok, input, abs } or { ok:false, error }.
async function resolveGvyScript(ctx, root, caseInput, raw) {
  const value = typeof raw === 'string' ? stripWspacePrefix(raw) : ''
  if (value === '') {
    return {
      ok: false,
      error: 'the `script` argument is required: the name of a .gvy file in <case folder>/scripts/ ' +
        '(for example "ieee14_adjBus14.gvy"), or a data/.../scripts/x.gvy path',
    }
  }
  if (value.indexOf('..') >= 0) return { ok: false, error: 'the script path must not contain "..": ' + value }
  // Workspace fixtures: `script/x.gvy`, `wspace/script/x.gvy` (the prefix is stripped
  // above) or an absolute path containing `/wspace/script/`. The caller reads the text
  // and evaluates it as source — the JVM never opens a path outside the case folder.
  let workspace = ''
  const marker = value.indexOf(GVY_WORKSPACE_MARKER)
  if (marker >= 0) {
    const candidate = 'script/' + value.slice(marker + GVY_WORKSPACE_MARKER.length)
    if (GVY_WORKSPACE_SCRIPT_RE.test(candidate)) workspace = candidate
  } else if (GVY_WORKSPACE_SCRIPT_RE.test(value)) {
    workspace = value
  }
  if (workspace !== '') {
    const workspaceAbs = root + '/wspace/' + workspace
    const wsFs = ctx.get('fs')
    let wsFound = false
    if (wsFs !== undefined) {
      try {
        const info = await wsFs.stat(await wsFs.resolve(workspaceAbs))
        wsFound = info !== undefined
      } catch (e) {
        wsFound = false
      }
    }
    if (!wsFound) {
      return { ok: false, error: 'script not found: ' + workspace + ' (the workspace script/ folder)' }
    }
    return { ok: true, workspace: true, input: workspace, abs: workspaceAbs }
  }
  let input = ''
  if (GVY_SCRIPT_PATH_RE.test(value)) {
    input = value
  } else if (!value.includes('/') && /\.gvy$/i.test(value)) {
    // `caseInput` is already workspace-relative ("data/<case dir>/<stem>.<ext>").
    const { parent } = casePartsOf(caseInput)
    input = wspaceJoin(parent, 'scripts/' + value)
  } else {
    const marker = value.indexOf(WS_DATA_MARKER)
    if (marker >= 0) {
      const candidate = 'data/' + value.slice(marker + WS_DATA_MARKER.length)
      if (GVY_SCRIPT_PATH_RE.test(candidate)) input = candidate
    }
  }
  if (input === '') {
    return {
      ok: false,
      error: 'unrecognized script selector "' + value + '": expected a .gvy file name in the case folder\'s ' +
        'scripts/ directory, or a data/.../scripts/x.gvy path',
    }
  }
  const abs = root + '/wspace/' + input
  const fs = ctx.get('fs')
  if (fs !== undefined) {
    let found = false
    try {
      const info = await fs.stat(await fs.resolve(abs))
      found = info !== undefined
    } catch (e) {
      found = false
    }
    if (!found) {
      // The names in that folder are the useful part of this failure.
      const available = await listGvyScripts(ctx, root, input)
      return {
        ok: false,
        error: 'script not found: ' + input +
          (available.length > 0 ? '; available scripts: ' + available.join(', ') : ' (no .gvy files there)'),
      }
    }
  }
  return { ok: true, input: input, abs: abs }
}

// Names of the .gvy files beside the requested script, for an actionable error.
async function listGvyScripts(ctx, root, scriptInput) {
  const fs = ctx.get('fs')
  if (fs === undefined) return []
  const slash = scriptInput.lastIndexOf('/')
  if (slash < 0) return []
  try {
    const dir = await fs.resolve(root + '/wspace/' + scriptInput.slice(0, slash))
    const entries = await fs.listDir(dir)
    return entries
      .filter((entry) => entry.type === 'file' && /\.gvy$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .slice(0, GVY_MAX_LISTED)
  } catch (e) {
    return []
  }
}

// Resolve the calling session's workspace root. Shared by the `interpss`
// service (browser RPCs) and the chat tools (which carry the agent id).
function resolveWorkspaceRoot(ctx, sessionId) {
  if (typeof sessionId === 'string' && sessionId !== '') {
    const sessions = ctx.get('sessions')
    if (sessions !== undefined) {
      try {
        const session = sessions.get(sessionId)
        const cwd = session && session.header ? session.header.cwd : undefined
        if (typeof cwd === 'string' && cwd !== '') return cwd
      } catch (e) {}
    }
  }
  const agents = ctx.get('agents')
  if (agents !== undefined) {
    try {
      const agent = agents.currentInitiator()
      const cwd = agent && agent.session && agent.session.header ? agent.session.header.cwd : undefined
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } catch (e) {}
  }
  const sp = ctx.get('sandboxPolicy')
  if (sp !== undefined && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot !== '') return sp.workspaceRoot
  return ''
}

// The activation gate: the workspace README.md's first H1 must be "iPSS Agent".
async function isIpssWorkspace(ctx, root) {
  const fs = ctx.get('fs')
  if (fs === undefined || root === '') return false
  try {
    const target = await fs.resolve(root + '/README.md')
    const text = await fs.readText(target)
    for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
      const trimmed = line.trim()
      if (trimmed.indexOf('# ') === 0) return trimmed.slice(2).trim() === 'iPSS Agent'
    }
    return false
  } catch (e) {
    return false
  }
}

// Split a workspace-relative case path into its result-directory parent and stem.
function casePartsOf(caseInput) {
  const slash = caseInput.lastIndexOf('/')
  const parent = slash >= 0 ? caseInput.slice(0, slash) : ''
  const stem = caseInput.slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
  return { parent, stem }
}

function wspaceJoin(parent, name) {
  return parent === '' ? name : parent + '/' + name
}

// Case-specific config/aclf_run.json (under the case folder) wins, then the project
// default config/aclf_run.json. Shared by the `interpss` service and `runAclfTool`.
async function resolveAclfConfigPath(ctx, root, caseInput) {
  const fs = ctx.get('fs')
  if (fs === undefined) return root + '/config/aclf_run.json'
  const { parent } = casePartsOf(caseInput)
  const caseCfg = root + '/wspace/' + wspaceJoin(parent, 'config/aclf_run.json')
  const defCfg = root + '/config/aclf_run.json'
  try {
    const target = await fs.resolve(caseCfg)
    const info = await fs.stat(target)
    if (info !== undefined) return caseCfg
  } catch (e) {}
  return defCfg
}

// Resolve the case a chat tool should act on: explicit argument first, then the
// case selected in the InterPSS tab, then the case the bridge already holds.
// Returns { target, source } with target null when nothing is available.
// A tool that loads — or switches to — a case makes it the session's current case, so
// the tab's Simu Case picker and the next no-argument call agree with the bridge
// instead of the case the tab happened to have selected. The Client mirrors the same
// value through `getBridgeCase`, which is why this is recorded here as well.
function adoptLoadedCase(sessionId, target) {
  if (target === null || target === undefined || typeof target.input !== 'string') return
  const current = selectedCaseFor(sessionId)
  if (current !== null && current.input === target.input) return
  rememberSelectedCase(sessionId, target.input, target.format)
}

function resolveToolCase(sessionId, requested) {
  if (typeof requested === 'string' && requested.trim() !== '') {
    const resolved = resolveCaseArgument(requested)
    if (resolved.ok !== true) return { target: null, source: 'argument', error: resolved.error }
    return { target: resolved, source: 'argument' }
  }
  const selected = selectedCaseFor(sessionId)
  if (selected !== null) return { target: selected, source: 'selection' }
  if (lastLoadedAbs !== null) {
    return { target: { input: relativeCasePath(lastLoadedAbs), format: formatOfCasePath(lastLoadedAbs) }, source: 'bridge' }
  }
  return { target: null, source: 'none' }
}

// Default ACLF run options, mirroring the project's config/aclf_run.json, used
// when that file is absent so the Options dialog always has values to edit.
const DEFAULT_ACLF_CONFIG = {
  lfMethod: 'NR',
  polarCoordinate: true,
  tolerance: 1.0e-4,
  tolUnitType: 'PU',
  maxIterations: 20,
  autoSetZeroZBranch: true,
  turnOffIslandBus: true,
  autoTurnLine2Xfr: true,
  busLoadLowVoltAdj: true,
  vConstPMin: 0.7,
  vConstIMin: 0.5,
  includeAdjustments: true,
  activateAllAdjCtrl: false,
  applyLimitControl: true,
  pvBusLimitControl: true,
  pqBusLimitControl: true,
  limitBackoffCheck: false,
  checkGenQLimImmediate: false,
  applyVoltAdjust: true,
  applyDiscreteAdjust: true,
  remoteQBusControl: true,
  switchedShuntAdjust: true,
  svcFactsAdjust: true,
  xfrTapControl: true,
  hvdcTapControl: true,
  applyPowerAdjust: true,
  psXfrPControl: true,
  nonDivergent: true,
  optAlgo: 'CUBIC_EQN',
  variableUpdateLimit: false,
  deltaVAngLimit: 0.2,
  deltaVMagLimit: 0.1,
  stopNoSolutionFound: false,
  minScaleFactor: 0.01,
  limitCtrlStartPoint: 10,
  limitCtrlTolearnceFactor: 10.0,
  limitCtrlApplyType: 'DURING_ITERATION',
  voltAdjStartPoint: 10,
  voltAdjTolearnce: 0.005,
  dQ_dVThreshold: 1.0,
  voltAdjApplyType: 'DURING_ITERATION',
  powerAdjStartPoint: 10,
  powerAdjTolearnceFactor: 10.0,
  powerAdjApplyType: 'POST_ITERATION',
  pvLimitAccFactor: 1.0,
  pqLimitAccFactor: 1.0,
  reQBusAccFactor: 1.0,
  svcAccFactor: 1.0,
  xfrTapAccFactor: 1.0,
  psXfrPContrlAccFactor: 1.0,
}

// Contingency-analysis run config (config/ca_run.json, beside config/aclf_run.json
// under the case folder) written by the CA dialog and read by `runCa`. Contingency
// inputs are case-specific, so there is no project-level default: an absent file
// falls back to the per-case suggestion below, which reproduces the filename
// discovery the CA run has always used.
const DEFAULT_CA_CONFIG = {
  contingencyMode: 'all',
  contingencyFile: null,
  monitorMode: 'all',
  monitoredBranchFile: null,
  // Violation-check loading (%): a monitored branch at or above it after a contingency
  // lands in the result CSV. The CA dialog's field, the tool's `overloadThreshold` and
  // config/ca_run.json all feed this one number.
  overloadThreshold: 90,
}

// The dialog reports how many entries a candidate file holds, which means
// parsing every .json in the case folder; skip absurd ones.
const CA_INSPECT_MAX_BYTES = 16 * 1024 * 1024

function caConfigPath(root, parent) {
  return root + '/wspace/' + wspaceJoin(parent, 'config/ca_run.json')
}

function caConfigRel(parent) {
  return wspaceJoin(parent, 'config/ca_run.json')
}

// Case-folder .json files that can be contingency inputs: our own two config
// files are settings, not inputs.
function caCandidateName(name) {
  return /\.json$/i.test(name) && name !== 'aclf_run.json' && name !== 'ca_run.json'
}

// Today's discovery heuristic, kept as the default when no ca_run.json exists:
// the first *contingenc*.json and the first *monitor*.json.
async function suggestCaConfig(ctx, root, parent) {
  const fs = ctx.get('fs')
  const out = Object.assign({}, DEFAULT_CA_CONFIG)
  if (fs === undefined) return out
  try {
    const entries = await fs.listDir(await fs.resolve(root + '/wspace/' + parent))
    const names = entries
      .filter((e) => e.type === 'file' && caCandidateName(e.name))
      .map((e) => e.name)
      .sort()
    for (const name of names) {
      const lower = name.toLowerCase()
      if (out.contingencyFile === null && lower.indexOf('contingenc') !== -1) {
        out.contingencyMode = 'custom'
        out.contingencyFile = wspaceJoin(parent, name)
      }
      if (out.monitoredBranchFile === null && lower.indexOf('monitor') !== -1) {
        out.monitorMode = 'custom'
        out.monitoredBranchFile = wspaceJoin(parent, name)
      }
    }
  } catch (e) {}
  return out
}

// Entry counts for the dialog message. A null count means the file does not
// carry that shape; `error` explains an unreadable file.
function caFileCounts(text) {
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { contingencyCount: null, monitoredCount: null, error: 'not valid JSON' }
  }
  if (Array.isArray(parsed)) {
    return { contingencyCount: parsed.length, monitoredCount: null, error: null }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { contingencyCount: null, monitoredCount: null, error: 'not a JSON object' }
  }
  return {
    contingencyCount: Array.isArray(parsed.contingencies) ? parsed.contingencies.length : null,
    monitoredCount: Array.isArray(parsed.monitored_branches) ? parsed.monitored_branches.length : null,
    error: null,
  }
}

// A ca_run.json entry is a wspace-relative path: never absolute, never escaping
// wspace/.
async function caEntryCheck(ctx, root, value) {
  const rel = String(value).replace(/\\/g, '/')
  if (rel.startsWith('/') || rel.indexOf('..') !== -1) {
    return { ok: false, error: 'must be a path under wspace/ (got ' + rel + ')' }
  }
  const fs = ctx.get('fs')
  let exists = false
  if (fs !== undefined) {
    try {
      const info = await fs.stat(await fs.resolve(root + '/wspace/' + rel))
      exists = info !== undefined && info !== null
    } catch (e) {
      exists = false
    }
  }
  return { ok: true, exists: exists }
}

// Normalise an untrusted config payload to the five known keys. Modes must be
// exactly 'all' | 'custom'; a custom mode must name a file, which must exist
// when `requireFiles` is set.
async function validateCaConfig(ctx, root, value, requireFiles) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'the run configuration must be a JSON object' }
  }
  const out = Object.assign({}, DEFAULT_CA_CONFIG)
  if (value.overloadThreshold !== undefined && value.overloadThreshold !== null && value.overloadThreshold !== '') {
    const threshold = Number(value.overloadThreshold)
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1000) {
      return {
        ok: false,
        error: 'overloadThreshold must be a loading percentage between 0 and 1000 (got ' +
          JSON.stringify(value.overloadThreshold) + ')',
      }
    }
    out.overloadThreshold = threshold
  }
  const fields = [
    ['contingencyMode', 'contingencyFile'],
    ['monitorMode', 'monitoredBranchFile'],
  ]
  for (const field of fields) {
    const modeKey = field[0]
    const fileKey = field[1]
    const raw = value[modeKey]
    if (raw !== undefined && raw !== null && raw !== '' && raw !== 'all' && raw !== 'custom') {
      return { ok: false, error: modeKey + " must be 'all' or 'custom' (got " + JSON.stringify(raw) + ')' }
    }
    const mode = raw === 'custom' ? 'custom' : 'all'
    out[modeKey] = mode
    if (mode === 'all') continue
    const rel = typeof value[fileKey] === 'string' ? value[fileKey].trim() : ''
    if (rel === '') {
      return { ok: false, error: modeKey + " is 'custom' but no " + fileKey + ' is set' }
    }
    const check = await caEntryCheck(ctx, root, rel)
    if (!check.ok) return { ok: false, error: fileKey + ': ' + check.error }
    if (requireFiles && !check.exists) {
      return { ok: false, error: fileKey + ' not found: ' + rel }
    }
    out[fileKey] = rel
  }
  return { ok: true, config: out }
}

// Effective CA config for a run: an explicit payload from the dialog, else the
// case-folder ca_run.json, else the per-case suggestion.
async function resolveCaRunConfig(ctx, root, parent, explicit) {
  if (explicit !== undefined && explicit !== null) {
    const validated = await validateCaConfig(ctx, root, explicit, true)
    if (!validated.ok) return { ok: false, error: 'invalid run configuration: ' + validated.error }
    return { ok: true, config: validated.config, source: 'request' }
  }
  const fs = ctx.get('fs')
  if (fs !== undefined) {
    let text = null
    try {
      text = await fs.readText(await fs.resolve(caConfigPath(root, parent)))
    } catch (e) {}
    if (text !== null) {
      let parsed = null
      try {
        parsed = JSON.parse(text)
      } catch (e) {
        return { ok: false, error: caConfigRel(parent) + ' is not valid JSON' }
      }
      const validated = await validateCaConfig(ctx, root, parsed, true)
      if (!validated.ok) return { ok: false, error: validated.error }
      return { ok: true, config: validated.config, source: 'case' }
    }
  }
  return { ok: true, config: await suggestCaConfig(ctx, root, parent), source: 'suggested' }
}

async function scanCases(fs, dirTarget, relDir, out) {
  let entries
  try {
    entries = await fs.listDir(dirTarget)
  } catch (e) {
    return
  }
  for (const entry of entries) {
    const rel = relDir === '' ? entry.name : relDir + '/' + entry.name
    if (entry.type === 'directory') {
      await scanCases(fs, entry.target, rel, out)
    } else if (entry.type === 'file') {
      if (/\.ieee$/i.test(entry.name)) out.push({ path: rel, format: 'ieee' })
      else if (/\.raw$/i.test(entry.name)) out.push({ path: rel, format: 'psse' })
    }
  }
}

// The preview reads one diagram at a time, so this bounds what it accepts as text.
const MAX_DRAWIO_BYTES = 2 * 1024 * 1024

// --- Launch the local draw.io app (shared, byte-identical in both hosts) -----
// The browser cannot start a process, so the Diagram tab's edit button asks the Host — and the
// Host goes through the `subprocess` service rather than `node:child_process`, because the
// dynamic half is an injected body with no imports and the service is the sandbox-aware
// execution world the harness already manages. The rungs are tried in order: the draw.io
// desktop app (macOS), the OS default handler, then `xdg-open` (Linux) / `cmd /c start`
// (Windows). Each rung resolves its executable FIRST, so a command that is not installed comes
// back as a message instead of a spawn failure, and the failures are all reported together.
const DRAWIO_LAUNCH_RUNGS = [
  { exe: 'open', args: ['-a', 'draw.io'], label: 'open -a draw.io' },
  { exe: 'open', args: [], label: 'open' },
  { exe: 'xdg-open', args: [], label: 'xdg-open' },
]
const DRAWIO_WINDOWS_RUNG = { exe: 'cmd', args: ['/c', 'start', ''], label: 'cmd /c start' }

function drawioLaunchRungs(platform) {
  return platform === 'windows' ? [DRAWIO_WINDOWS_RUNG] : DRAWIO_LAUNCH_RUNGS
}

// A failing rung is worth quoting only if it said something: `open: no such file` is the useful
// half of a failure, the empty string is not.
function drawioLaunchStderr(handle) {
  const collected = handle === null || handle === undefined ? null : handle.collected
  const reader = collected === null || collected === undefined ? null : collected.stderr
  if (reader === null || reader === undefined || typeof reader.readFrom !== 'function') return ''
  try {
    return String(reader.readFrom(0).text || '').trim().slice(0, 300)
  } catch (e) {
    return ''
  }
}

// One rung: resolve, spawn, wait for the exit fact. `open` returns as soon as the app is
// launched, so a zero exit means "handed to the OS", not "draw.io has drawn it".
async function drawioLaunchOnce(sp, rung, absPath, cwd, signal) {
  let exe
  try {
    exe = await sp.resolveExecutable(rung.exe, undefined, signal)
  } catch (e) {
    return { ok: false, why: rung.label + ' is not available here' }
  }
  let handle
  try {
    handle = sp.spawn({
      argv: [exe].concat(rung.args, [absPath]),
      cwd: cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
      graceMs: 10000,
      signal: signal,
    })
  } catch (e) {
    return { ok: false, why: rung.label + ' could not start' }
  }
  let outcome = null
  try {
    outcome = await handle.done
  } catch (e) {
    return { ok: false, why: rung.label + ' failed to run' }
  }
  if (outcome !== null && outcome !== undefined && outcome.exitCode === 0) {
    return { ok: true, launcher: rung.label }
  }
  const code = outcome === null || outcome === undefined ? '?' : String(outcome.exitCode)
  const detail = drawioLaunchStderr(handle)
  return { ok: false, why: rung.label + ' exited ' + code + (detail === '' ? '' : ': ' + detail) }
}

async function drawioLaunch(sp, platform, absPath, cwd, signal) {
  const tried = []
  for (const rung of drawioLaunchRungs(platform)) {
    const result = await drawioLaunchOnce(sp, rung, absPath, cwd, signal)
    if (result.ok === true) return { ok: true, launcher: result.launcher }
    tried.push(result.why)
  }
  return { ok: false, error: 'could not launch the local draw.io app (' + tried.join('; ') + ')' }
}
// --- end draw.io launcher ---------------------------------------------------

// One in-process JVM per Host process, started lazily on first bridge use.
// `java-bridge` is loaded with a dynamic import so the plugin still loads (and
// runAclf falls back to shell-out) when the native module is not installed.
let bridgePromise = null
// java-bridge default namespace (carries stdout.enableRedirect in v2.7+),
// captured during JVM bootstrap so runAclf can intercept JVM stdout/stderr.
let jbApi = null
// Absolute path of the case the embedded JVM currently holds. Mirrors
// IpssAgentBridge.loadedInput; every JVM load goes through this module's
// javaBridge provider, so the two cannot drift. Used by `caseInfo` to reuse a
// loaded case (and preserve a converged AC load flow) instead of reloading.
let lastLoadedAbs = null
let lastLoadedBusCount = null
let lastLoadedBranchCount = null

// Update `lastLoadedAbs` from a bridge load result (JSON string, `{ok:true,…}`).
function rememberLoadedCase(raw, absCase) {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && parsed.ok === true && typeof absCase === 'string' && absCase !== '') {
      lastLoadedAbs = absCase
      rememberLoadedCounts(parsed.busCount, parsed.branchCount)
    }
  } catch (e) {}
}

// Equipment counts of the case the bridge holds. The tab prints them as its
// "\u2713 Loaded: N buses, M branches" confirmation, so a load driven from chat needs the
// Host to publish them alongside the case path — otherwise the tab can only say which
// case arrived, not how big it is.
function parseNetworkCounts(text) {
  const value = String(text === null || text === undefined ? '' : text)
  const bus = /Number of Active Buses:\s*(\d+)/.exec(value)
  const branch = /Number of Active Branches:\s*(\d+)/.exec(value)
  return { busCount: bus ? Number(bus[1]) : null, branchCount: branch ? Number(branch[1]) : null }
}

function rememberLoadedCounts(busCount, branchCount) {
  if (typeof busCount === 'number' && Number.isFinite(busCount)) lastLoadedBusCount = busCount
  if (typeof branchCount === 'number' && Number.isFinite(branchCount)) lastLoadedBranchCount = branchCount
}

async function ensureBridge(root) {
  if (bridgePromise === null) {
    bridgePromise = (async () => {
      // java-bridge reads JAVA_HOME at ensureJvm() time; self-discover a JDK on
      // Windows (and friends) when the harness env lacks it, then hand it over.
      const home = discoverJavaHome()
      if (home) process.env.JAVA_HOME = home
      const mod = await import('java-bridge')
      // java-bridge v2.6 exports the helpers as top-level named exports; v2.7+
      // moved them onto the module's default namespace. Pick whichever surface
      // actually carries `appendClasspath` so either installed version works.
      const jb = (mod.default && typeof mod.default.appendClasspath === 'function') ? mod.default : mod
      jbApi = jb
      // Classpath must be set before the JVM starts.
      jb.appendClasspath([root + '/target/ipss-agent-cmd-1.0.0-uber.jar'])
      // Heap for the shared model: the largest case in this workspace (the Eastern
      // Interconnect, 78k buses / 126k branches) needs more than the 4g this used to
      // ask for. The JVM reads it only when it starts, so a change lands on the next
      // `dsh web` restart.
      await jb.ensureJvm({ opts: ['-Xmx8g'] })
      const BridgeClass = await jb.importClass('org.interpss.agent.bridge.IpssAgentBridge')
      return BridgeClass.newInstanceAsync()
    })().catch((e) => {
      bridgePromise = null
      throw e
    })
  }
  return bridgePromise
}

// Capture the embedded JVM's stdout/stderr into buffers for the duration of a
// bridge call. When java-bridge exposes `stdout.enableRedirect`, the JVM's
// native stdout/stderr are intercepted at the boundary (so log4j2 Console,
// slf4j-simple, and direct System.out/err all land here) instead of spilling
// into the dsh web terminal. Returns a tiny {out, err, stop} handle; callers
// MUST stop() even on failure.
function captureStdio() {
  const chunksOut = []
  const chunksErr = []
  if (jbApi !== null && jbApi.stdout !== undefined && typeof jbApi.stdout.enableRedirect === 'function') {
    let guard = null
    try {
      guard = jbApi.stdout.enableRedirect(
        (err, data) => { if (!err && typeof data === 'string') chunksOut.push(data) },
        (err, data) => { if (!err && typeof data === 'string') chunksErr.push(data) },
      )
    } catch (e) {
      guard = null
    }
    return {
      out: () => chunksOut.join(''),
      err: () => chunksErr.join(''),
      stop: () => { if (guard !== null) { try { guard.reset() } catch (e) {} } },
    }
  }
  return { out: () => '', err: () => '', stop: () => {} }
}

// Run one Groovy evaluation through the bridge: capture the script's println output,
// then mirror the held case and its counts. Shared by `runGvy` (a .gvy file) and
// `runGvySource` (inline source), so the two entry points cannot drift.
async function gvyThrough(run, absCase) {
  const cap = captureStdio()
  let raw
  try {
    raw = await run()
  } finally {
    cap.stop()
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        lastLoadedAbs = absCase
        rememberLoadedCounts(parsed.buses, parsed.branches)
      }
      parsed.stdout = cap.out()
      parsed.stderr = cap.err()
      raw = JSON.stringify(parsed)
    }
  } catch (e) {}
  return raw
}

// Sort CSV data rows by one header column. Numeric when every non-empty value in that
// column parses as a finite number (LoadingPercent, flows, ratings), lexicographic
// otherwise. An unknown column is not an error: the caller gets the file order back and
// `column: null`, so a UI can avoid claiming a sort it did not get.
function applyCsvSort(rows, header, column, desc) {
  const names = String(header).split(',')
  const wanted = typeof column === 'string' ? column.trim().toLowerCase() : ''
  if (wanted === '') return { rows: rows, column: null, desc: false }
  const index = names.findIndex((name) => name.trim().toLowerCase() === wanted)
  if (index < 0) return { rows: rows, column: null, desc: false }
  const valueOf = (line) => {
    const cells = String(line).split(',')
    return index < cells.length ? cells[index].trim() : ''
  }
  const numeric = rows.every((line) => {
    const value = valueOf(line)
    return value === '' || Number.isFinite(Number(value))
  })
  const compare = (a, b) => {
    const left = valueOf(a)
    const right = valueOf(b)
    let result
    if (numeric) {
      const l = left === '' ? Number.NEGATIVE_INFINITY : Number(left)
      const r = right === '' ? Number.NEGATIVE_INFINITY : Number(right)
      result = l < r ? -1 : l > r ? 1 : 0
    } else {
      result = left.localeCompare(right)
    }
    return desc ? -result : result
  }
  const sorted = rows.slice().sort(compare)
  return { rows: sorted, column: names[index].trim(), desc: desc }
}

class InterpssService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, NAMESPACE)
  }

  resolveWorkspaceRoot(sessionId) {
    return resolveWorkspaceRoot(this.ctx, sessionId)
  }

  bridge() {
    return this.ctx.get('javaBridge')
  }

  caseParts(caseInput) {
    return casePartsOf(caseInput)
  }

  async resolveAclfConfigPath(root, caseInput) {
    return resolveAclfConfigPath(this.ctx, root, caseInput)
  }

  async isActivated(input) {
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    return { activated: await isIpssWorkspace(this.ctx, root) }
  }

  async checkResult(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const casePath = input && typeof input.input === 'string' ? input.input : ''
    if (casePath.indexOf('..') !== -1 || !CASE_PATH_RE.test(casePath)) {
      return { ok: false, error: 'Invalid case path: ' + casePath }
    }
    // The tab calls checkResult on mount and on every selection change, so this
    // is also where "the case currently selected in the InterPSS tab" is
    // recorded for chat tools (interpss_network_info).
    rememberSelectedCase(input && input.sessionId, casePath)
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    const wspace = root + '/wspace'
    const slash = casePath.lastIndexOf('/')
    const parent = slash >= 0 ? casePath.slice(0, slash) : ''
    const stem = casePath.slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
    const infoRel = parent + '/result/' + stem + '_network_info.txt'
    try {
      const target = await fs.resolve(wspace + '/' + infoRel)
      const text = await fs.readText(target)
      const converged = /Loadflow converged:\s*True/i.test(text)
      return {
        ok: true,
        exists: true,
        converged: converged,
        networkInfo: text,
        resultDir: parent + '/result',
        files: [
          stem + '_DF_bus.csv',
          stem + '_DF_branch.csv',
          stem + '_DF_gen.csv',
          stem + '_DF_load.csv',
          stem + '_network_info.txt',
        ],
      }
    } catch (e) {
      return { ok: true, exists: false, converged: false, networkInfo: null }
    }
  }

  async checkResultFiles(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const casePath = input && typeof input.input === 'string' ? input.input : ''
    if (casePath.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(casePath)) {
      return { ok: false, error: 'Invalid case path: ' + casePath }
    }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    const wspace = root + '/wspace'
    const slash = casePath.lastIndexOf('/')
    const parent = slash >= 0 ? casePath.slice(0, slash) : ''
    const stem = casePath.slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
    const resultDir = parent + '/result'
    const files = [
      stem + '_DF_bus.csv',
      stem + '_DF_branch.csv',
      stem + '_DF_gen.csv',
      stem + '_DF_load.csv',
    ]
    const present = []
    for (const name of files) {
      try {
        const target = await fs.resolve(wspace + '/' + resultDir + '/' + name)
        const info = await fs.stat(target)
        if (info !== undefined) present.push(name)
      } catch (e) {}
    }
    return {
      ok: true,
      available: present.length === files.length,
      present: present,
      resultDir: resultDir,
    }
  }

  async listCases(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    let dataTarget
    try {
      dataTarget = await fs.resolve(root + '/wspace/data')
    } catch (e) {
      return { ok: false, error: 'cannot resolve wspace/data' }
    }
    const out = []
    await scanCases(fs, dataTarget, 'data', out)
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return { ok: true, cases: out }
  }

  // The tab's Diagram source: the .drawio files DIRECTLY inside the selected case's
  // `diagram/` folder, as workspace-relative paths so `readDrawio` can take one straight
  // back. A diagram belongs to a case, and the tab's Diagram button is enabled by this
  // answer, so an absent case or folder is an EMPTY LIST and not an error — "this case has
  // no diagram yet" is a state the tab renders. A malformed case path is a real error.
  async listDrawioFiles(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const caseInput = input && typeof input.case === 'string' ? input.case : ''
    if (caseInput === '' || caseInput.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(caseInput)) {
      return { ok: false, error: 'Invalid case path: ' + caseInput }
    }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    const relDir = 'wspace/' + wspaceJoin(casePartsOf(caseInput).parent, 'diagram')
    let entries
    try {
      entries = await fs.listDir(await fs.resolve(root + '/' + relDir))
    } catch (e) {
      return { ok: true, files: [], dir: relDir }
    }
    const files = []
    for (const entry of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.type !== 'file' || !/\.drawio$/i.test(entry.name)) continue
      let size = null
      try {
        const info = await fs.stat(entry.target)
        size = info && typeof info.size === 'number' ? info.size : null
      } catch (e) {}
      files.push({ path: relDir + '/' + entry.name, size: size })
    }
    return { ok: true, files: files, dir: relDir }
  }

  // Read one .drawio as text for the client-side renderer. The whitelist is the same
  // shape as readCsv's, plus an explicit `..` rejection, and the size check happens
  // before the read so an oversized file never reaches the RPC payload.
  async readDrawio(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const path = input && typeof input.path === 'string' ? input.path : ''
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-\/]*\.drawio$/i.test(path) || path.indexOf('..') !== -1) {
      return { ok: false, error: 'Invalid diagram path: ' + path }
    }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    let target
    try {
      target = await fs.resolve(root + '/' + path)
    } catch (e) {
      return { ok: false, error: 'cannot resolve diagram: ' + path }
    }
    let size = null
    try {
      const info = await fs.stat(target)
      size = info && typeof info.size === 'number' ? info.size : null
    } catch (e) {
      return { ok: false, error: 'cannot stat diagram: ' + path }
    }
    if (size !== null && size > MAX_DRAWIO_BYTES) {
      return { ok: false, error: 'diagram too large (' + size + ' bytes; limit ' + MAX_DRAWIO_BYTES + ')' }
    }
    let xml
    try {
      xml = await fs.readText(target)
    } catch (e) {
      return { ok: false, error: 'cannot read diagram: ' + path }
    }
    return { ok: true, path: path, xml: String(xml), size: size }
  }

  // Hand one diagram to the local draw.io desktop app (the Diagram tab's edit button). The
  // path validation is readDrawio's, the launch itself is the shared helper above, and the
  // answer names the rung that worked — `open` reports success once the OS has the file, so
  // this says "launched", not "edited".
  async openDrawio(input) {
    const sp = this.ctx.get('subprocess')
    if (sp === undefined) return { ok: false, error: 'subprocess service unavailable' }
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const path = input && typeof input.path === 'string' ? input.path : ''
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-\/]*\.drawio$/i.test(path) || path.indexOf('..') !== -1) {
      return { ok: false, error: 'Invalid diagram path: ' + path }
    }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    let target
    try {
      target = await fs.resolve(root + '/' + path)
    } catch (e) {
      return { ok: false, error: 'cannot resolve diagram: ' + path }
    }
    const abs = typeof fs.processPath === 'function' ? fs.processPath(target) : ''
    if (typeof abs !== 'string' || abs === '') {
      return { ok: false, error: 'this filesystem exposes no host path for ' + path }
    }
    let platform = 'posix'
    try {
      const env = await sp.terminalEnvironment()
      if (env !== null && env !== undefined && env.platform === 'windows') platform = 'windows'
    } catch (e) {}
    return drawioLaunch(sp, platform, abs, root, undefined)
  }

  async readCsv(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const path = input && typeof input.path === 'string' ? input.path : ''
    if (!/^data\/[A-Za-z0-9_.\/-]+\/result\/[A-Za-z0-9_.-]+_DF_(bus|branch|gen|load|contingency)\.csv$/.test(path)) {
      return { ok: false, error: 'Invalid result path: ' + path }
    }
    const start = (input && typeof input.start === 'number' && input.start > 0) ? Math.floor(input.start) : 0
    const limit = (input && typeof input.limit === 'number' && input.limit > 0) ? Math.floor(input.limit) : 200
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    const wspace = root + '/wspace'
    let text
    try {
      const target = await fs.resolve(wspace + '/' + path)
      text = await fs.readText(target)
    } catch (e) {
      return { ok: false, error: 'cannot read result file: ' + path }
    }
    const lines = String(text).replace(/\r\n/g, '\n').split('\n')
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    if (lines.length === 0) {
      return { ok: true, header: '', rows: [], totalRows: 0, hasMore: false, sortColumn: null, sortDesc: false }
    }
    const header = lines[0]
    let data = lines.slice(1)
    // Sorting happens here, before the page is sliced, so a sorted table is sorted over
    // the whole file rather than over the rows the caller happens to have loaded.
    const applied = applyCsvSort(data, header, input && input.sortColumn, input && input.sortDesc === true)
    data = applied.rows
    const totalRows = data.length
    const dataStart = Math.min(start, data.length)
    const dataEnd = Math.min(dataStart + limit, data.length)
    const rows = dataStart < data.length ? data.slice(dataStart, dataEnd) : []
    return {
      ok: true,
      header: header,
      rows: rows,
      totalRows: totalRows,
      hasMore: dataEnd < data.length,
      sortColumn: applied.column,
      sortDesc: applied.desc,
    }
  }

      async busConnections(input) {
        const fs = this.ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const busId = input && typeof input.busId === 'string' ? input.busId : ''
        const path = input && typeof input.path === 'string' ? input.path : ''
        if (busId === '') return { ok: false, error: 'missing bus id' }
        if (!/^data\/[A-Za-z0-9_.\/-]+\/result\/[A-Za-z0-9_.-]+_DF_branch\.csv$/.test(path)) {
          return { ok: false, error: 'Invalid branch path: ' + path }
        }
        const root = this.resolveWorkspaceRoot(input && input.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        const wspace = root + '/wspace'
        let text
        try {
          const target = await fs.resolve(wspace + '/' + path)
          text = await fs.readText(target)
        } catch (e) {
          return { ok: false, error: 'cannot read branch file: ' + path }
        }
        const lines = String(text).replace(/\r\n/g, '\n').split('\n')
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
        if (lines.length === 0) return { ok: true, busId: busId, header: [], rows: [], count: 0 }
        const header = lines[0].split(',')
        const rows = []
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim() === '') continue
          const cols = lines[i].split(',')
          if (cols[4] === busId || cols[7] === busId) rows.push(cols)
        }

        const readAll = async (relPath) => {
          try {
            const target = await fs.resolve(wspace + '/' + relPath)
            const txt = await fs.readText(target)
            const ls = String(txt).replace(/\r\n/g, '\n').split('\n')
            while (ls.length > 0 && ls[ls.length - 1].trim() === '') ls.pop()
            if (ls.length === 0) return { header: [], rows: [] }
            const hdr = ls[0].split(',')
            const out = []
            for (let i = 1; i < ls.length; i++) {
              if (ls[i].trim() === '') continue
              out.push(ls[i].split(','))
            }
            return { header: hdr, rows: out }
          } catch (e) {
            return { header: [], rows: [] }
          }
        }

        const busFile = path.replace(/_DF_branch\.csv$/, '_DF_bus.csv')
        const genFile = path.replace(/_DF_branch\.csv$/, '_DF_gen.csv')
        const loadFile = path.replace(/_DF_branch\.csv$/, '_DF_load.csv')

        const busAll = await readAll(busFile)
        const genAll = await readAll(genFile)
        const loadAll = await readAll(loadFile)

        const busById = {}
        for (const c of busAll.rows) busById[c[0]] = c

        const genByBus = {}
        for (const c of genAll.rows) {
          if (!genByBus[c[0]]) genByBus[c[0]] = []
          genByBus[c[0]].push(c)
        }
        const loadByBus = {}
        for (const c of loadAll.rows) {
          if (!loadByBus[c[0]]) loadByBus[c[0]] = []
          loadByBus[c[0]].push(c)
        }

        const displayed = new Set([busId])
        for (const r of rows) { displayed.add(r[4]); displayed.add(r[7]) }

        const busRecords = []
        for (const id of displayed) {
          const b = busById[id]
          if (!b) continue
          const gs = genByBus[id] || []
          const ls = loadByBus[id] || []
          let totalGenP = 0
          let totalGenQ = 0
          for (const g of gs) {
            const p = parseFloat(g[9]); if (isFinite(p)) totalGenP += p
            const q = parseFloat(g[12]); if (isFinite(q)) totalGenQ += q
          }
          busRecords.push({
            id: id,
            name: b[2] || '',
            baseKV: b[11] || '',
            status: b[9] || '',
            voltMag: b[12] || '',
            voltAng: b[13] || '',
            genCode: gs.length > 0 ? (gs[0][5] || '') : '',
            genCount: gs.length,
            genIds: gs.map((g) => g[3] || ''),
            loadCode: ls.length > 0 ? (ls[0][5] || '') : '',
            loadCount: ls.length,
            loadIds: ls.map((l) => l[3] || ''),
            totalGenP: totalGenP,
            totalGenQ: totalGenQ,
          })
        }

        const selGen = genByBus[busId] || []
        const selLoad = loadByBus[busId] || []

        return {
          ok: true,
          busId: busId,
          header: header,
          rows: rows,
          count: rows.length,
          genHeader: genAll.header,
          genRows: selGen,
          genCount: selGen.length,
          loadHeader: loadAll.header,
          loadRows: selLoad,
          loadCount: selLoad.length,
          busRecords: busRecords,
        }
      }

  async runAclf(input) {
    const format = input && input.format === 'psse' ? 'psse' : 'ieee'
    const caseInput = input && typeof input.input === 'string' ? input.input : ''
    if (caseInput.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(caseInput)) {
      return { ok: false, error: 'Invalid case path: ' + caseInput }
    }

    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }

    const { parent, stem } = this.caseParts(caseInput)

    // In-process bridge path (preferred).
    const bridge = this.bridge()
    if (bridge !== undefined && typeof bridge.runAclf === 'function') {
      try {
        const absCase = root + '/wspace/' + caseInput
        const absCfg = await this.resolveAclfConfigPath(root, caseInput)
        const absResults = root + '/wspace/' + parent + '/result'
        const raw = await bridge.runAclf(format, absCase, absCfg, absResults, stem)
        const parsed = JSON.parse(raw)
        if (parsed && parsed.ok) {
          return {
            ok: true,
            exitCode: 0,
            timedOut: false,
            aborted: false,
            stdout: '',
            stderr: '',
            converged: !!parsed.converged,
            networkInfo: parsed.networkInfo || null,
            input: caseInput,
            format: format,
            resultDir: parent + '/result',
            files: [
              stem + '_DF_bus.csv',
              stem + '_DF_branch.csv',
              stem + '_DF_gen.csv',
              stem + '_DF_load.csv',
              stem + '_network_info.txt',
            ],
          }
        }
        return { ok: false, error: parsed && parsed.error ? parsed.error : 'bridge runAclf failed' }
      } catch (e) {
        return { ok: false, error: 'bridge runAclf failed: ' + (e && e.message ? e.message : String(e)) }
      }
    }

    // Fallback: shell out to IpssCmd.
    const shell = this.ctx.get('shell')
    if (shell === undefined) return { ok: false, error: 'shell service unavailable' }

    const wspace = root + '/wspace'
    const infoRel = parent + '/result/' + stem + '_network_info.txt'

    const javaCp = root + '/target/classes:' + root + '/lib/ipss_runnable.jar:' + root + '/lib/deps/*'
    const command = shellQuote(javaBin()) + ' -cp "' + javaCp + '" org.interpss.agent.IpssCmd aclf ' + format + ' ' + caseInput
    const spec = shell.resolve({ command: command, workdir: wspace, timeoutMs: 180000, stdoutMaxBytes: 300000 })

    let res
    try {
      res = await shell.run(spec)
    } catch (e) {
      return { ok: false, error: 'command failed to start: ' + (e && e.message ? e.message : String(e)) }
    }

    let networkInfo = null
    if (res.exitCode === 0) {
      const fs = this.ctx.get('fs')
      if (fs !== undefined) {
        try {
          const target = await fs.resolve(wspace + '/' + infoRel)
          networkInfo = await fs.readText(target)
        } catch (e) {
          networkInfo = null
        }
      }
    }

    return {
      ok: res.exitCode === 0,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
      aborted: res.aborted,
      stdout: res.stdout.text,
      stderr: res.stderr.text,
      networkInfo: networkInfo,
      input: caseInput,
      format: format,
      resultDir: parent + '/result',
      files: [
        stem + '_DF_bus.csv',
        stem + '_DF_branch.csv',
        stem + '_DF_gen.csv',
        stem + '_DF_load.csv',
        stem + '_network_info.txt',
      ],
    }
  }

  async runCa(input) {
    const format = input && input.format === 'psse' ? 'psse' : 'ieee'
    const caseInput = input && typeof input.input === 'string' ? input.input : ''
    if (caseInput.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(caseInput)) {
      return { ok: false, error: 'Invalid case path: ' + caseInput }
    }

    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }

    const { parent, stem } = this.caseParts(caseInput)
    const resultDir = parent + '/result'

    // Run configuration: an explicit payload from the dialog, else the
    // case-folder ca_run.json, else the per-case filename discovery. A custom
    // entry with no matching file becomes null, which selects the Java defaults
    // (N-1 outages / all branches monitored).
    const resolved = await resolveCaRunConfig(this.ctx, root, parent, input && input.config)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const caConfig = resolved.config
    const contRel = caConfig.contingencyFile
    const monRel = caConfig.monitoredBranchFile

    // In-process bridge path (preferred): no JVM spawn, cached network.
    const bridge = this.bridge()
    if (bridge !== undefined && typeof bridge.runContingency === 'function') {
      try {
        const absCase = root + '/wspace/' + caseInput
        const absCont = contRel !== null ? root + '/wspace/' + contRel : null
        const absMon = monRel !== null ? root + '/wspace/' + monRel : null
        const absResults = root + '/wspace/' + resultDir
        const raw = await bridge.runContingency(format, absCase, absCont, absMon, absResults, stem,
          caConfig.overloadThreshold)
        const parsed = JSON.parse(raw)
        if (parsed && parsed.ok) {
          return {
            ok: true,
            resultDir: resultDir,
            contingencyFile: parsed.contingencyFile || (stem + '_DF_contingency.csv'),
            caSummary: typeof parsed.caSummary === 'string' ? parsed.caSummary : null,
            stdout: parsed.stdout || '',
            stderr: parsed.stderr || '',
            input: caseInput,
          }
        }
        return { ok: false, error: parsed && parsed.error ? parsed.error : 'bridge runContingency failed' }
      } catch (e) {
        // Bridge threw (e.g. stale JAR / signature mismatch): fall through
        // to the Java CLI shell fallback below instead of failing CA.
      }
    }

    // Fallback: shell out to the Java CA subcommand (IpssCmd ca).
    const shell = this.ctx.get('shell')
    if (shell === undefined) return { ok: false, error: 'shell service unavailable' }

    const wspace = root + '/wspace'
    const javaCp = root + '/target/classes:' + root + '/lib/ipss_runnable.jar:' + root + '/lib/deps/*'
    let command = shellQuote(javaBin()) + ' -cp "' + javaCp + '" org.interpss.agent.IpssCmd ca ' + format + ' ' + caseInput
    // CLI args are positional (cont then monitor). Append independently when
    // cont is present; monitor-only cannot be expressed without a cont slot.
    if (contRel !== null) {
      command += ' ' + shellQuote(contRel)
      if (monRel !== null) command += ' ' + shellQuote(monRel)
    }
    const spec = shell.resolve({ command: command, workdir: wspace, timeoutMs: 180000, stdoutMaxBytes: 300000 })

    let res
    try {
      res = await shell.run(spec)
    } catch (e) {
      return { ok: false, error: 'command failed to start: ' + (e && e.message ? e.message : String(e)) }
    }

    if (res.exitCode !== 0) {
      return { ok: false, error: 'contingency analysis failed (exit ' + res.exitCode + ')\n' + (res.stderr.text || res.stdout.text || '') }
    }

    let caSummary = null
    const m = /ContAnalysisSummary:[\s\S]*?Overloading Branches=\d+/.exec(res.stdout.text || '')
    if (m) caSummary = m[0].trim()
    return { ok: true, resultDir: resultDir, contingencyFile: stem + '_DF_contingency.csv', caSummary: caSummary, stdout: res.stdout.text, stderr: res.stderr.text, input: caseInput }
  }

  async loadCase(input) {
    const format = input && input.format === 'psse' ? 'psse' : 'ieee'
    const caseInput = input && typeof input.input === 'string' ? input.input : ''
    if (caseInput.indexOf('..') !== -1 || !CASE_PATH_RE.test(caseInput)) {
      return { ok: false, error: 'Invalid case path: ' + caseInput }
    }
    // Loading is the definitive "this is the active simulation case" action.
    rememberSelectedCase(input && input.sessionId, caseInput, format)
    const bridge = this.bridge()
    if (bridge === undefined || typeof bridge.loadCase !== 'function') {
      return { ok: false, error: 'in-process bridge unavailable' }
    }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    try {
      const absCase = root + '/wspace/' + caseInput
      const raw = await bridge.loadCase(format, absCase)
      const parsed = JSON.parse(raw)
      if (parsed && parsed.ok) {
        return { ok: true, format: parsed.format, input: caseInput, busCount: parsed.busCount, branchCount: parsed.branchCount }
      }
      return { ok: false, error: parsed && parsed.error ? parsed.error : 'bridge loadCase failed' }
    } catch (e) {
      return { ok: false, error: 'bridge loadCase failed: ' + (e && e.message ? e.message : String(e)) }
    }
  }

  async summarizeResult(input) {
    const scope = input && typeof input.scope === 'string' ? input.scope : 'Net'
    const sortRule = input && typeof input.sortRule === 'string' ? input.sortRule : ''
    const numRec = input && typeof input.numRec === 'number' && input.numRec > 0 ? Math.floor(input.numRec) : 10
    const bridge = this.bridge()
    if (bridge === undefined || typeof bridge.summarize !== 'function') {
      return { ok: false, error: 'in-process bridge unavailable' }
    }
    try {
      const raw = await bridge.summarize(scope, sortRule, numRec)
      const parsed = JSON.parse(raw)
      if (parsed && parsed.ok) {
        return { ok: true, scope: parsed.scope || scope, text: parsed.text || '' }
      }
      return { ok: false, error: parsed && parsed.error ? parsed.error : 'bridge summarize failed' }
    } catch (e) {
      return { ok: false, error: 'bridge summarize failed: ' + (e && e.message ? e.message : String(e)) }
    }
  }

  async getNetworkInfo(input) {
    const bridge = this.bridge()
    if (bridge === undefined || typeof bridge.networkInfo !== 'function') {
      return { ok: false, error: 'in-process bridge unavailable' }
    }
    try {
      const text = await bridge.networkInfo()
      return { ok: true, networkInfo: typeof text === 'string' ? text : '' }
    } catch (e) {
      return { ok: false, error: 'bridge getNetworkInfo failed: ' + (e && e.message ? e.message : String(e)) }
    }
  }

  // The case the bridge currently holds, for the tab's Simu Case picker: a chat tool
  // can load (or switch) the model while the tab still shows the case the user picked,
  // and the two must not disagree. Answers from the Host's `lastLoadedAbs` mirror, so
  // it costs nothing and never starts the JVM just to reply.
  async getBridgeCase() {
    const value = { ok: true, case: lastLoadedAbs === null ? '' : relativeCasePath(lastLoadedAbs) }
    if (lastLoadedBusCount !== null) value.busCount = lastLoadedBusCount
    if (lastLoadedBranchCount !== null) value.branchCount = lastLoadedBranchCount
    return value
  }

  async runReport(input) {
    const casePath = input && typeof input.input === 'string' ? input.input : ''
    if (casePath.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(casePath)) {
      return { ok: false, error: 'Invalid case path: ' + casePath }
    }

    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }

    const { parent, stem } = this.caseParts(casePath)
    const resultDir = parent + '/result'

    let displayName = input && typeof input.displayName === 'string' && input.displayName.trim() !== '' ? input.displayName.trim() : stem
    displayName = String(displayName).replace(/[\r\n\t'"]/g, ' ').trim()

    // An explicit `reportType` ("aclf" | "nerc") wins; otherwise NERC when a
    // contingency CSV is present, else the AC Loadflow report.
    const fs = this.ctx.get('fs')
    const requestedType = input && typeof input.reportType === 'string' ? input.reportType.trim().toLowerCase() : ''
    let reportType = requestedType === 'aclf' || requestedType === 'nerc' ? requestedType : ''
    if (reportType === '') {
      let hasContingency = false
      if (fs !== undefined) {
        try {
          const target = await fs.resolve(root + '/wspace/' + resultDir + '/' + stem + '_DF_contingency.csv')
          hasContingency = (await fs.stat(target)) !== undefined
        } catch (e) {}
      }
      reportType = hasContingency ? 'nerc' : 'aclf'
    }
    const reportFile = reportType === 'nerc' ? 'NERC_TPL_001_5_Report.md' : 'AC_Loadflow_Report.md'

    const bridge = this.bridge()
    if (bridge !== undefined && typeof bridge.runReport === 'function') {
      try {
        const raw = await bridge.runReport(reportType, displayName, root, resultDir, null)
        const parsed = JSON.parse(raw)
        if (parsed && parsed.ok) {
          return {
            ok: true,
            markdown: parsed.markdown || '',
            resultDir: parsed.resultDir || resultDir,
            input: casePath,
            displayName: parsed.displayName || displayName,
            reportType: reportType,
          }
        }
        return { ok: false, error: parsed && parsed.error ? parsed.error : 'bridge runReport failed' }
      } catch (e) {
        // Bridge threw (e.g. stale JAR / signature mismatch): fall through
        // to the Java CLI shell fallback below instead of failing the report.
      }
    }

    // Fallback: shell out to the Java report subcommand.
    const shell = this.ctx.get('shell')
    if (shell === undefined) return { ok: false, error: 'shell service unavailable' }

    const wspace = root + '/wspace'
    const javaCp = root + '/target/classes:' + root + '/lib/ipss_runnable.jar:' + root + '/lib/deps/*'
    const command = shellQuote(javaBin()) + ' -cp "' + javaCp + '" org.interpss.agent.IpssCmd report ' + reportType + ' ' + shellQuote(displayName) + ' ' + shellQuote(resultDir)
    const spec = shell.resolve({ command: command, workdir: wspace, timeoutMs: 120000, stdoutMaxBytes: 300000 })

    let res
    try {
      res = await shell.run(spec)
    } catch (e) {
      return { ok: false, error: 'command failed to start: ' + (e && e.message ? e.message : String(e)) }
    }

    if (res.exitCode !== 0) {
      return { ok: false, error: 'report generation failed (exit ' + res.exitCode + ')\n' + (res.stderr.text || res.stdout.text || '') }
    }

    let markdown = null
    if (fs !== undefined) {
      try {
        const target = await fs.resolve(wspace + '/' + resultDir + '/' + reportFile)
        markdown = await fs.readText(target)
      } catch (e) {
        markdown = null
      }
    }

    return { ok: true, markdown: markdown, resultDir: resultDir, input: casePath, displayName: displayName, reportType: reportType }
  }

  async getAclfOptions(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    const caseInput = input && typeof input.input === 'string' ? input.input : ''
    const defCfg = root + '/config/aclf_run.json'
    let cfgPath = defCfg
    if (caseInput !== '') {
      const { parent } = this.caseParts(caseInput)
      const caseCfg = root + '/wspace/' + wspaceJoin(parent, 'config/aclf_run.json')
      try {
        const target = await fs.resolve(caseCfg)
        const info = await fs.stat(target)
        if (info !== undefined) cfgPath = caseCfg
      } catch (e) {}
    }
    try {
      const target = await fs.resolve(cfgPath)
      const text = await fs.readText(target)
      let config = null
      try {
        config = JSON.parse(text)
      } catch (e) {
        return { ok: false, error: cfgPath + ' is not valid JSON' }
      }
      return { ok: true, config: config && typeof config === 'object' ? config : {} }
    } catch (e) {
      return { ok: true, config: DEFAULT_ACLF_CONFIG }
    }
  }

  async saveAclfOptions(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const config = input && input.config && typeof input.config === 'object' ? input.config : null
    if (config === null) return { ok: false, error: 'missing options payload' }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    const caseInput = input && typeof input.input === 'string' ? input.input : ''
    if (caseInput === '') return { ok: false, error: 'no case selected' }
    const { parent } = this.caseParts(caseInput)
    const caseCfg = root + '/wspace/' + wspaceJoin(parent, 'config/aclf_run.json')
    try {
      const target = await fs.resolve(caseCfg)
      const written = await writeConfigText(fs, target, JSON.stringify(config, null, 2) + '\n', caseCfg)
      if (written.ok !== true) return { ok: false, error: 'failed to write ' + caseCfg + ': ' + written.error }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: 'failed to write ' + caseCfg + ': ' + (e && e.message ? e.message : String(e)) }
    }
  }

  // Candidate contingency / monitored-branch inputs: every .json beside the
  // case file, with the entry counts the dialog reports after a pick.
  async listCaFiles(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const caseInput = input && typeof input.input === 'string' ? input.input : ''
    if (caseInput === '') return { ok: false, error: 'no case selected' }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    const { parent } = this.caseParts(caseInput)

    let entries
    try {
      entries = await fs.listDir(await fs.resolve(root + '/wspace/' + parent))
    } catch (e) {
      return { ok: false, error: 'cannot list ' + (parent === '' ? 'wspace' : parent) }
    }

    const files = []
    const names = entries
      .filter((e) => e.type === 'file' && caCandidateName(e.name))
      .map((e) => e.name)
      .sort()
    for (const name of names) {
      const rel = wspaceJoin(parent, name)
      const out = { name: name, path: rel, contingencyCount: null, monitoredCount: null, error: null }
      try {
        const target = await fs.resolve(root + '/wspace/' + rel)
        const info = await fs.stat(target)
        const size = info && typeof info.size === 'number' ? info.size : null
        if (size !== null && size > CA_INSPECT_MAX_BYTES) {
          out.error = 'too large to inspect'
        } else {
          Object.assign(out, caFileCounts(await fs.readText(target)))
        }
      } catch (e) {
        out.error = 'cannot read'
      }
      files.push(out)
    }
    return { ok: true, dir: parent, files: files }
  }

  // The dialog's starting state: the case ca_run.json when it exists and
  // parses, else the discovered defaults with a warning explaining why.
  async getCaOptions(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const caseInput = input && typeof input.input === 'string' ? input.input : ''
    if (caseInput === '') return { ok: false, error: 'no case selected' }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    const { parent } = this.caseParts(caseInput)
    const cfgRel = caConfigRel(parent)
    const suggestion = await suggestCaConfig(this.ctx, root, parent)

    let text = null
    try {
      text = await fs.readText(await fs.resolve(caConfigPath(root, parent)))
    } catch (e) {
      return { ok: true, config: suggestion, source: 'suggested', path: cfgRel }
    }
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      return { ok: true, config: suggestion, source: 'suggested', path: cfgRel, warning: cfgRel + ' is not valid JSON — showing the discovered defaults' }
    }
    // A missing file is reported by listCaFiles, so existence is not required here.
    const validated = await validateCaConfig(this.ctx, root, parsed, false)
    if (!validated.ok) {
      return { ok: true, config: suggestion, source: 'suggested', path: cfgRel, warning: cfgRel + ': ' + validated.error + ' — showing the discovered defaults' }
    }
    return { ok: true, config: validated.config, source: 'case', path: cfgRel }
  }

  // Persist the dialog's configuration as <case folder>/config/ca_run.json.
  async saveCaOptions(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const caseInput = input && typeof input.input === 'string' ? input.input : ''
    if (caseInput === '') return { ok: false, error: 'no case selected' }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    const { parent } = this.caseParts(caseInput)
    const validated = await validateCaConfig(this.ctx, root, input && input.config, true)
    if (!validated.ok) return { ok: false, error: validated.error }

    const cfgRel = caConfigRel(parent)
    const payload = {
      contingencyMode: validated.config.contingencyMode,
      contingencyFile: validated.config.contingencyFile,
      monitorMode: validated.config.monitorMode,
      monitoredBranchFile: validated.config.monitoredBranchFile,
      // The dialog's over loading threshold. It must round-trip, or the next dialog
      // open, the CLI and `interpss_run_ca` silently fall back to 90.
      overloadThreshold: validated.config.overloadThreshold,
    }
    try {
      const target = await fs.resolve(caConfigPath(root, parent))
      const written = await writeConfigText(fs, target, JSON.stringify(payload, null, 2) + '\n', caConfigPath(root, parent))
      if (written.ok !== true) return { ok: false, error: 'failed to write ' + cfgRel + ': ' + written.error }
      return { ok: true, path: cfgRel }
    } catch (e) {
      return { ok: false, error: 'failed to write ' + cfgRel + ': ' + (e && e.message ? e.message : String(e)) }
    }
  }
}

// --- Chat tool: interpss_network_info ---------------------------------------
// Model-facing Tool over the embedded bridge. Registered once on the host tool
// registry; per-call it resolves the target case (argument → tab selection →
// case held by the bridge) and is gated on the iPSS Agent workspace.
// Shared ordering guidance for the chat tools: loading the selected case is an
// explicit first step, though every tool still loads on demand if it is skipped.
const LOAD_FIRST_HINT =
  'If the case selected in the InterPSS tab has not been loaded yet, call interpss_case_load ' +
  'first (this tool still loads on demand). '

// --- Chat tool: interpss_case_load ------------------------------------------
// The explicit "load the selected case into the bridge" step. It reuses the same
// caseInfo() path the other tools go through, so it is a no-op when the bridge
// already holds the target and only otherwise parses the case file.
function caseLoadTool(ctx) {
  return {
    name: 'interpss_case_load',
    description:
      'Load a power-system simulation case into the embedded InterPSS model (the base case held in the ' +
      'bridge memory). Call this before interpss_network_info or interpss_run_aclf when a case is selected ' +
      'in the InterPSS tab and has not been loaded yet: it is a no-op reporting `alreadyLoaded` when the ' +
      'bridge already holds that case. The case comes from the `case` argument when given, otherwise from ' +
      'the case selected in the InterPSS tab, otherwise from the case the bridge already holds. Reports ' +
      'the active bus and branch counts; large cases (PSS/E 2K-bus and up) can take seconds to load.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        case: {
          type: 'string',
          description:
            "Optional case selector: a workspace-relative path such as 'data/ieee/Ieee14Bus/ieee14.ieee' " +
            "(also accepted as 'wspace/data/ieee/Ieee14Bus/ieee14.ieee'), " +
            "an absolute path containing '/wspace/data/', or a preset label ('IEEE 118-bus', 'IEEE 14-bus', " +
            "'Texas 2K-bus'). Omit it to use the case selected in the InterPSS tab, then the case already " +
            'held by the bridge.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          case: { type: 'string' },
          source: { type: 'string' },
          format: { type: 'string' },
          alreadyLoaded: { type: 'boolean' },
          busCount: { type: 'number' },
          branchCount: { type: 'number' },
          error: { type: 'string' },
        },
      },
      render(args, value) {
        if (value && value.ok === true) {
          const counts = (typeof value.busCount === 'number' ? value.busCount : '?') + ' buses, ' +
            (typeof value.branchCount === 'number' ? value.branchCount : '?') + ' branches'
          const head = 'InterPSS case load \u2014 ' + String(value.case || '') +
            ' (source: ' + String(value.source || '') + ')'
          // Same confirmation the tab prints after a load, so the card and the tab agree:
          // "\u2713 Loaded: N buses, M branches".
          const status = value.alreadyLoaded === true ? '\u2713 Already loaded: ' : '\u2713 Loaded: '
          return [{ type: 'text', text: head + '\n' + status + counts }]
        }
        return [{ type: 'text', text: 'InterPSS case load failed: ' + String((value && value.error) || 'unknown error') }]
      },
      // Persisted to the card's block.meta so the load card can render without
      // the generic row's expand toggle.
      presentationMeta(args, value) {
        if (value === null || value === undefined || value.ok !== true) return { ok: false }
        return {
          ok: true,
          case: String(value.case || ''),
          source: String(value.source || ''),
          format: String(value.format || ''),
          alreadyLoaded: value.alreadyLoaded === true,
        }
      },
    },
    presentCall(args) {
      return { card: 'generic', title: 'InterPSS case load', kind: 'read', rawInput: args }
    },
    async execute(args, exec) {
      const fail = (error, source) => ({ ok: false, error: error, source: source === undefined ? 'bridge' : source })
      const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : ''
      const root = resolveWorkspaceRoot(ctx, sessionId)
      if (root === '') return fail('could not resolve the session workspace root', 'none')
      if (!(await isIpssWorkspace(ctx, root))) {
        return fail('InterPSS is not available in this workspace: the workspace README.md first heading must be "iPSS Agent"', 'none')
      }
      const resolvedCase = resolveToolCase(sessionId, args && typeof args.case === 'string' ? args.case : '')
      if (resolvedCase.error !== undefined) return fail(resolvedCase.error, 'argument')
      if (resolvedCase.target === null) {
        return fail('no simulation case is selected: pick one in the InterPSS tab, or pass `case` (a data/... path, an absolute path containing /wspace/data/, or a preset label)', 'none')
      }
      const target = resolvedCase.target
      const source = resolvedCase.source
      const bridge = ctx.get('javaBridge')
      if (bridge === undefined || typeof bridge.caseInfo !== 'function') {
        return fail('the in-process InterPSS bridge is unavailable; install java-bridge and rebuild the uber JAR (see scripts/setup-java-bridge.sh)', source)
      }
      try {
        const raw = await bridge.caseInfo(target.format, root + '/wspace/' + target.input)
        const parsed = JSON.parse(raw)
        if (!parsed || parsed.ok !== true) {
          return fail(String((parsed && parsed.error) || 'bridge case load failed'), source)
        }
        adoptLoadedCase(sessionId, target)
        const value = {
          ok: true,
          case: target.input,
          source: source,
          format: target.format,
          alreadyLoaded: parsed.reused === true,
        }
        // Only include counts the bridge reported: output.schema declares
        // numbers, and null would fail output validation.
        if (typeof parsed.busCount === 'number') value.busCount = parsed.busCount
        if (typeof parsed.branchCount === 'number') value.branchCount = parsed.branchCount
        return value
      } catch (e) {
        return fail('InterPSS case load failed: ' + (e && e.message ? e.message : String(e)), source)
      }
    },
  }
}

function networkInfoTool(ctx) {
  return {
    name: 'interpss_network_info',
    description:
      LOAD_FIRST_HINT +
      'Show the InterPSS network information (active buses and branches, total generation and load, ' +
      'load-flow convergence, max mismatch) of a power-system simulation case handled by the embedded ' +
      'InterPSS bridge. The case comes from the `case` argument when given, otherwise from the case ' +
      'selected in the InterPSS tab, otherwise from the case already held by the bridge. A case held by ' +
      'the bridge is reused, so a converged AC load flow is preserved; loading a case into the bridge is ' +
      'part of the call.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        case: {
          type: 'string',
          description:
            "Optional case selector: a workspace-relative path such as 'data/ieee/Ieee14Bus/ieee14.ieee' " +
            "(also accepted as 'wspace/data/ieee/Ieee14Bus/ieee14.ieee'), " +
            "an absolute path containing '/wspace/data/', or a preset label ('IEEE 118-bus', 'IEEE 14-bus', " +
            "'Texas 2K-bus'). Omit it to use the case selected in the InterPSS tab, then the case already " +
            'loaded in the bridge.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          case: { type: 'string' },
          source: { type: 'string' },
          busCount: { type: 'number' },
          branchCount: { type: 'number' },
          lfConverged: { type: 'boolean' },
          reused: { type: 'boolean' },
          networkInfo: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(args, value) {
        if (value && value.ok === true) {
          const head = 'InterPSS network info \u2014 ' + String(value.case || '') +
            ' (source: ' + String(value.source || '') + ')'
          return [{ type: 'text', text: head + '\n' + String(value.networkInfo || '') }]
        }
        return [{ type: 'text', text: 'InterPSS network info failed: ' + String((value && value.error) || 'unknown error') }]
      },
      // Persisted to the card's block.meta for the client-side card view: the
      // shipped generic row hides a tool's output behind an expand toggle, so
      // the summary would otherwise be invisible in the conversation.
      presentationMeta(args, value) {
        if (value === null || value === undefined || value.ok !== true) return { ok: false }
        return {
          ok: true,
          case: String(value.case || ''),
          source: String(value.source || ''),
          lfConverged: value.lfConverged === true,
        }
      },
    },
    presentCall(args) {
      return { card: 'generic', title: 'InterPSS network info', kind: 'read', rawInput: args }
    },
    async execute(args, exec) {
      const fail = (error, source) => ({ ok: false, error: error, source: source === undefined ? 'bridge' : source })
      const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : ''
      const root = resolveWorkspaceRoot(ctx, sessionId)
      if (root === '') return fail('could not resolve the session workspace root', 'none')
      if (!(await isIpssWorkspace(ctx, root))) {
        return fail('InterPSS is not available in this workspace: the workspace README.md first heading must be "iPSS Agent"', 'none')
      }
      const resolvedCase = resolveToolCase(sessionId, args && typeof args.case === 'string' ? args.case : '')
      if (resolvedCase.error !== undefined) return fail(resolvedCase.error, 'argument')
      const target = resolvedCase.target
      const source = resolvedCase.source
      const bridge = ctx.get('javaBridge')
      if (bridge === undefined || typeof bridge.caseInfo !== 'function') {
        return fail('the in-process InterPSS bridge is unavailable; install java-bridge and rebuild the uber JAR (see scripts/setup-java-bridge.sh)', source)
      }
      try {
        const absCase = target !== null ? root + '/wspace/' + target.input : ''
        const raw = await bridge.caseInfo(target !== null ? target.format : '', absCase)
        const parsed = JSON.parse(raw)
        if (!parsed || parsed.ok !== true) {
          return fail(String((parsed && parsed.error) || 'bridge caseInfo failed'), source)
        }
        // `caseInfo` loads the case when the bridge does not already hold it, so this
        // call can switch the session's current case too.
        if (target !== null) adoptLoadedCase(sessionId, target)
        const value = {
          ok: true,
          case: target !== null ? target.input : relativeCasePath(parsed.input),
          source: source,
          lfConverged: parsed.lfConverged === true,
          reused: parsed.reused === true,
          networkInfo: typeof parsed.networkInfo === 'string' ? parsed.networkInfo : '',
        }
        // Only include counts when the bridge reported them: output.schema
        // declares numbers, and null would fail output validation.
        if (typeof parsed.busCount === 'number') value.busCount = parsed.busCount
        if (typeof parsed.branchCount === 'number') value.branchCount = parsed.branchCount
        return value
      } catch (e) {
        return fail('InterPSS bridge call failed: ' + (e && e.message ? e.message : String(e)), source)
      }
    },
  }
}

// --- Chat tool: interpss_run_aclf -------------------------------------------
// Runs AC load flow on a case and reports convergence plus the resulting
// network information. Writes the result CSVs and network-info file under
// wspace/<case dir>/result/, so a following report tool can consume them.
function runAclfTool(ctx) {
  return {
    name: 'interpss_run_aclf',
    description:
      LOAD_FIRST_HINT +
      'Run an InterPSS AC load flow (ACLF) on a power-system simulation case and report convergence plus ' +
      'the resulting network information. Writes <case>_DF_bus.csv, <case>_DF_branch.csv, <case>_DF_gen.csv, ' +
      '<case>_DF_load.csv and <case>_network_info.txt under wspace/<case dir>/result/. The case comes from ' +
      'the `case` argument when given, otherwise from the case selected in the InterPSS tab, otherwise from ' +
      'the case the bridge already holds. Solver options come from the case folder config/aclf_run.json when ' +
      'present, otherwise config/aclf_run.json. Large cases can take minutes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        case: {
          type: 'string',
          description:
            "Optional case selector: a workspace-relative path such as 'data/ieee/Ieee14Bus/ieee14.ieee' " +
            "(also accepted as 'wspace/data/ieee/Ieee14Bus/ieee14.ieee'), " +
            "an absolute path containing '/wspace/data/', or a preset label ('IEEE 118-bus', 'IEEE 14-bus', " +
            "'Texas 2K-bus'). Omit it to run the case selected in the InterPSS tab, then the case already " +
            'held by the bridge.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          case: { type: 'string' },
          source: { type: 'string' },
          format: { type: 'string' },
          converged: { type: 'boolean' },
          busCount: { type: 'number' },
          branchCount: { type: 'number' },
          resultDir: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          networkInfo: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(args, value) {
        if (value && value.ok === true) {
          const head = [
            'InterPSS AC load flow \u2014 ' + String(value.case || '') + ' (source: ' + String(value.source || '') + ')',
            'Converged: ' + (value.converged === true ? 'true' : 'false'),
            'Results: wspace/' + String(value.resultDir || ''),
          ].join('\n')
          return [{ type: 'text', text: head + '\n' + String(value.networkInfo || '') }]
        }
        return [{ type: 'text', text: 'InterPSS AC load flow failed: ' + String((value && value.error) || 'unknown error') }]
      },
      // Persisted to the tool card's block.meta. The client-side result explorer
      // reads it to fetch rows over the existing `interpss/readCsv` RPC instead
      // of re-deriving paths from the rendered text; keep it small, lossless
      // JSON — never rows or live objects.
      presentationMeta(args, value) {
        if (value === null || value === undefined || value.ok !== true) return { ok: false }
        return {
          ok: true,
          case: String(value.case || ''),
          source: String(value.source || ''),
          resultDir: String(value.resultDir || ''),
          converged: value.converged === true,
          files: Array.isArray(value.files) ? value.files.map((name) => String(name)) : [],
        }
      },
    },
    presentCall(args) {
      return { card: 'generic', title: 'InterPSS AC load flow', kind: 'execute', rawInput: args }
    },
    async execute(args, exec) {
      const fail = (error, source) => ({ ok: false, error: error, source: source === undefined ? 'bridge' : source })
      const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : ''
      const root = resolveWorkspaceRoot(ctx, sessionId)
      if (root === '') return fail('could not resolve the session workspace root', 'none')
      if (!(await isIpssWorkspace(ctx, root))) {
        return fail('InterPSS is not available in this workspace: the workspace README.md first heading must be "iPSS Agent"', 'none')
      }
      const resolvedCase = resolveToolCase(sessionId, args && typeof args.case === 'string' ? args.case : '')
      if (resolvedCase.error !== undefined) return fail(resolvedCase.error, 'argument')
      if (resolvedCase.target === null) {
        return fail('no simulation case is selected: pick one in the InterPSS tab, or pass `case` (a data/... path, an absolute path containing /wspace/data/, or a preset label)', 'none')
      }
      const target = resolvedCase.target
      const source = resolvedCase.source
      const bridge = ctx.get('javaBridge')
      if (bridge === undefined || typeof bridge.runAclf !== 'function') {
        return fail('the in-process InterPSS bridge is unavailable; install java-bridge and rebuild the uber JAR (see scripts/setup-java-bridge.sh)', source)
      }
      try {
        const { parent, stem } = casePartsOf(target.input)
        const absCase = root + '/wspace/' + target.input
        const absCfg = await resolveAclfConfigPath(ctx, root, target.input)
        const absResults = root + '/wspace/' + parent + '/result'
        const raw = await bridge.runAclf(target.format, absCase, absCfg, absResults, stem)
        const parsed = JSON.parse(raw)
        if (!parsed || parsed.ok !== true) {
          return fail(String((parsed && parsed.error) || 'bridge runAclf failed'), source)
        }
        const info = typeof parsed.networkInfo === 'string' ? parsed.networkInfo : ''
        adoptLoadedCase(sessionId, target)
        const value = {
          ok: true,
          case: target.input,
          source: source,
          format: target.format,
          converged: parsed.converged === true,
          resultDir: parent + '/result',
          files: [
            stem + '_DF_bus.csv',
            stem + '_DF_branch.csv',
            stem + '_DF_gen.csv',
            stem + '_DF_load.csv',
            stem + '_network_info.txt',
          ],
          networkInfo: info,
        }
        // Only include counts when the run reported them: output.schema
        // declares numbers, and null would fail output validation.
        const bus = /Number of Active Buses:\s*(\d+)/.exec(info)
        const branch = /Number of Active Branches:\s*(\d+)/.exec(info)
        if (bus) value.busCount = Number(bus[1])
        if (branch) value.branchCount = Number(branch[1])
        return value
      } catch (e) {
        return fail('InterPSS AC load flow failed: ' + (e && e.message ? e.message : String(e)), source)
      }
    },
  }
}

// --- Chat tool: interpss_case_summary ----------------------------------------
// Ports IpssAgentBridge.summarize(): a top-N ranking from the cached model.
//
// Two facts about the Java side shape this tool:
//   1. `text` is a JSON *string* inside the JSON envelope, so it needs a second parse.
//   2. The result container ALWAYS carries every section (busResults, genResults,
//      loadResults, branchResults, ...); only the requested section is ranked and
//      limited. On a large case the bridge payload is therefore big, so this tool
//      keeps just the requested section plus netResults and returns a bounded,
//      model-friendly row list rather than forwarding the raw container.
//
// It is also stricter than the RPC: an unknown scope is rejected, because the Java
// switch silently falls back to `net`, which truncates every section in model order
// — a ranking that is not a ranking.
const SUMMARY_SECTIONS = {
  bus: { section: 'busResults', unit: 'pu' },
  gen: { section: 'genResults', unit: 'MW' },
  load: { section: 'loadResults', unit: 'MW' },
  branch: { section: 'branchResults', unit: 'MVA' },
}
const SUMMARY_DEFAULT_ROWS = 10
const SUMMARY_MAX_ROWS = 100

function finiteOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function padRight(text, width) {
  return text.length >= width ? text + ' ' : text + ' '.repeat(width - text.length)
}

function formatAmount(value, unit) {
  return typeof value === 'number' && Number.isFinite(value)
    ? (unit === 'pu' ? value.toFixed(4) : value.toFixed(2))
    : '?'
}

// One InterPSS container entry -> a compact uniform row. Returns null when the
// ranked quantity is absent, so the row is dropped rather than reported as 0.
function summaryRowOf(scope, entry) {
  if (entry === null || typeof entry !== 'object') return null
  if (scope === 'bus') {
    const v = finiteOrNull(entry.busVoltageMagnitude)
    if (v === null) return null
    return { id: String(entry.busId || ''), name: String(entry.busName || ''), value: v, unit: 'pu' }
  }
  if (scope === 'branch') {
    const flow = entry.branchPowerFlowFrom2To
    if (flow === null || typeof flow !== 'object') return null
    const re = finiteOrNull(flow.real)
    const im = finiteOrNull(flow.imaginary)
    if (re === null || im === null) return null
    // The adapter ranks branches by flow magnitude, so report the same quantity.
    return { id: String(entry.branchId || ''), name: String(entry.branchName || ''), value: Math.hypot(re, im), unit: 'MVA' }
  }
  const complex = entry[scope]
  if (complex === null || typeof complex !== 'object') return null
  const mw = finiteOrNull(complex.real)
  if (mw === null) return null
  const row = {
    id: String(entry[scope + 'Id'] || ''),
    name: String(entry[scope + 'Name'] || ''),
    bus: String(entry.busId || ''),
    value: mw,
    unit: 'MW',
  }
  const mvar = finiteOrNull(complex.imaginary)
  if (mvar !== null) row.mvar = mvar
  return row
}

// The case-wide totals the container carries regardless of scope.
function summaryNetOf(net) {
  const out = {}
  if (net === null || typeof net !== 'object') return out
  if (net.LoadflowConverged !== undefined) out.converged = net.LoadflowConverged === true
  const put = (key, raw) => {
    const n = finiteOrNull(raw)
    if (n !== null) out[key] = n
  }
  put('buses', net.numberOfBuses)
  put('branches', net.numberOfBranches)
  if (net.totalGeneration) put('generationMw', net.totalGeneration.real)
  if (net.totalLoad) put('loadMw', net.totalLoad.real)
  if (net.maxMismatch) {
    put('maxMismatchP', net.maxMismatch.real)
    put('maxMismatchQ', net.maxMismatch.imaginary)
  }
  return out
}

function caseSummaryTool(ctx) {
  return {
    name: 'interpss_case_summary',
    description:
      LOAD_FIRST_HINT +
      'Summarize the simulation case held in the InterPSS bridge. With `scope` "net" (the default) it ' +
      'reports the case-wide totals: convergence, bus and branch counts, generation, load and max ' +
      'mismatch. With scope "bus", "gen", "load" or "branch" it adds the top `numRec` entries ranked by ' +
      'voltage, generation, load, or branch flow magnitude. Rows come from the in-memory model, so the ' +
      'case only needs to be loaded (interpss_case_load), not solved; on a base case the values are ' +
      'base-case values. `sortRule` is only read by the bus scope, and only the substring "High" ' +
      'selects highest-first. Branch ranking is by flow magnitude, not by rating loading — read the ' +
      'result CSV for Loading%.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scope: {
          type: 'string',
          enum: ['net', 'bus', 'gen', 'load', 'branch'],
          description:
            'Which section to summarize. Omit or use "net" for the case-wide totals only; the other ' +
            'scopes add ranked rows.',
        },
        sortRule: {
          type: 'string',
          description:
            'Optional ordering hint passed to the InterPSS adapter. Only the bus scope reads it, and ' +
            'only the substring "High" (e.g. "Highest Bus Voltage") selects highest-first; anything ' +
            'else means lowest-first. gen/load/branch are always largest-first.',
        },
        numRec: {
          type: 'number',
          description: 'Rows to return for a ranked scope (default 10, capped at 100). Ignored by scope "net".',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          case: { type: 'string' },
          source: { type: 'string' },
          scope: { type: 'string' },
          converged: { type: 'boolean' },
          buses: { type: 'number' },
          branches: { type: 'number' },
          generationMw: { type: 'number' },
          loadMw: { type: 'number' },
          maxMismatchP: { type: 'number' },
          maxMismatchQ: { type: 'number' },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                bus: { type: 'string' },
                value: { type: 'number' },
                unit: { type: 'string' },
                mvar: { type: 'number' },
              },
            },
          },
          error: { type: 'string' },
        },
      },
      render(args, value) {
        if (!value || value.ok !== true) {
          return [{ type: 'text', text: 'InterPSS case summary failed: ' + String((value && value.error) || 'unknown error') }]
        }
        const scope = String(value.scope || 'net')
        // No case/scope/convergence preamble on any card: it is chrome the tool row
        // above (which names the tool and its arguments) and the chat report already
        // carry. The case-wide totals themselves stay, on the `net` scope only, and a
        // ranked scope renders its table with no blank line.
        const lines = []
        if (scope === 'net') {
          const bits = []
          if (value.buses !== undefined) bits.push(value.buses + ' buses')
          if (value.branches !== undefined) bits.push(value.branches + ' branches')
          if (value.generationMw !== undefined) bits.push('gen ' + formatAmount(value.generationMw, 'MW') + ' MW')
          if (value.loadMw !== undefined) bits.push('load ' + formatAmount(value.loadMw, 'MW') + ' MW')
          if (bits.length > 0) lines.push(bits.join(' \u00b7 '))
          if (value.maxMismatchP !== undefined || value.maxMismatchQ !== undefined) {
            lines.push('max mismatch: dP ' + formatAmount(value.maxMismatchP, 'MW') +
              ', dQ ' + formatAmount(value.maxMismatchQ, 'MW'))
          }
        }
        const rows = Array.isArray(value.rows) ? value.rows : []
        if (rows.length > 0) {
          lines.push(padRight('#', 5) + padRight('id', 24) + padRight('name', 18) + padRight('value', 12) + 'unit')
          rows.forEach((row, index) => {
            lines.push(
              padRight(String(index + 1), 5) +
              padRight(String(row.id || ''), 24) +
              padRight(String(row.name || ''), 18) +
              padRight(formatAmount(row.value, row.unit), 12) +
              String(row.unit || ''),
            )
          })
        }
        if (lines.length === 0) {
          // A registered toolview key replaces the generic row, so this card must
          // always render text: a ranked scope with no rows would otherwise leave
          // an empty cell.
          lines.push('no data for scope: ' + scope)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
      // Persisted to the card's block.meta so the summary card renders directly.
      presentationMeta(args, value) {
        if (value === null || value === undefined || value.ok !== true) return { ok: false }
        return {
          ok: true,
          case: String(value.case || ''),
          scope: String(value.scope || ''),
          rowCount: Array.isArray(value.rows) ? value.rows.length : 0,
        }
      },
    },
    presentCall(args) {
      return { card: 'generic', title: 'InterPSS case summary', kind: 'read', rawInput: args }
    },
    async execute(args, exec) {
      const fail = (error, source) => ({ ok: false, error: error, source: source === undefined ? 'bridge' : source })
      const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : ''
      const root = resolveWorkspaceRoot(ctx, sessionId)
      if (root === '') return fail('could not resolve the session workspace root', 'none')
      if (!(await isIpssWorkspace(ctx, root))) {
        return fail('InterPSS is not available in this workspace: the workspace README.md first heading must be "iPSS Agent"', 'none')
      }
      const rawScope = args && typeof args.scope === 'string' && args.scope.trim() !== ''
        ? args.scope.trim().toLowerCase()
        : 'net'
      if (rawScope !== 'net' && SUMMARY_SECTIONS[rawScope] === undefined) {
        return fail('unknown scope "' + rawScope + '": expected net, bus, gen, load or branch', 'none')
      }
      const sortRule = args && typeof args.sortRule === 'string' ? args.sortRule : ''
      const requested = args && typeof args.numRec === 'number' && Number.isFinite(args.numRec) && args.numRec > 0
        ? Math.floor(args.numRec)
        : SUMMARY_DEFAULT_ROWS
      const bridge = ctx.get('javaBridge')
      if (bridge === undefined || typeof bridge.summarize !== 'function') {
        return fail('the in-process InterPSS bridge is unavailable; install java-bridge and rebuild the uber JAR (see scripts/setup-java-bridge.sh)', 'bridge')
      }
      try {
        // Only the totals are needed for "net", so ask for one row per section:
        // the container is otherwise returned with every section in full.
        const limit = rawScope === 'net' ? 1 : Math.min(requested, SUMMARY_MAX_ROWS)
        const raw = await bridge.summarize(rawScope, sortRule, limit)
        const parsed = JSON.parse(raw)
        if (!parsed || parsed.ok !== true) {
          const message = String((parsed && parsed.error) || 'bridge summarize failed')
          if (message.indexOf('no loaded network') !== -1) {
            return fail('no simulation case is loaded in the InterPSS bridge: call interpss_case_load first', 'bridge')
          }
          return fail(message, 'bridge')
        }
        const container = typeof parsed.text === 'string' ? JSON.parse(parsed.text) : parsed.text
        const value = {
          ok: true,
          case: lastLoadedAbs === null ? '' : relativeCasePath(lastLoadedAbs),
          source: 'bridge',
          scope: rawScope,
        }
        // `converged` always; the remaining case-wide totals belong to `net`, so a
        // ranked scope does not carry (or repeat) them.
        const totals = summaryNetOf(container.netResults)
        if (totals.converged !== undefined) value.converged = totals.converged
        if (rawScope === 'net') {
          Object.assign(value, totals)
        } else {
          const section = container[SUMMARY_SECTIONS[rawScope].section]
          const rows = []
          if (Array.isArray(section)) {
            for (const entry of section) {
              const row = summaryRowOf(rawScope, entry)
              if (row !== null) rows.push(row)
            }
          }
          value.rows = rows
        }
        return value
      } catch (e) {
        return fail('InterPSS case summary failed: ' + (e && e.message ? e.message : String(e)), 'bridge')
      }
    },
  }
}

// `load 259.00 \u2192 262.10 MW (+3.10)` for one step of a batch, or '' when it moved nothing
// (a pure query script has no delta worth a line).
function gvyStepDelta(step) {
  const before = finiteOrNull(step && step.loadMwBefore)
  const after = finiteOrNull(step && step.loadMw)
  if (before === null || after === null) return ''
  const delta = after - before
  if (Math.abs(delta) < 0.005) return 'load unchanged (' + formatAmount(after, 'MW') + ' MW)'
  return 'load ' + formatAmount(before, 'MW') + ' \u2192 ' + formatAmount(after, 'MW') + ' MW (' +
    signed(formatAmount(after, 'MW'), formatAmount(before, 'MW')) + ')'
}

// --- Chat tool: interpss_run_gvy ---------------------------------------------
// Applies Groovy to the case held in the embedded bridge — a .gvy file, or the source
// itself. The script mutates that network in place and may query it (bindings `aclfnet`
// and `senAlgo`, the DC sensitivity analyser; Complex and the sensitivity types are
// pre-imported), which is what makes the tool useful and also what makes it dangerous:
// edits are not rolled back, so `reload: true` re-parses the case and the docs say the
// scripts are trusted code. Solving stays a separate step (interpss_run_aclf).
function runGvyTool(ctx) {
  return {
    name: 'interpss_run_gvy',
    description:
      LOAD_FIRST_HINT +
      'Apply one or more Groovy scenario scripts to the power-system case held in the embedded ' +
      'InterPSS bridge, then report what they changed. A script comes from its case folder\'s ' +
      'scripts/ directory — pass the file name (for example "ieee14_adjBus14.gvy") or a ' +
      'data/.../scripts/x.gvy path — or pass the Groovy source itself, which is evaluated the same ' +
      'way without writing a file (for example "aclfnet.getBus(\'Bus14\').getContributeLoad(\'Bus14-L1\')' +
      '.loadCP = new Complex(0.50, 0.30)"). A single bare word is read as a file name, so anything ' +
      'containing whitespace or statement punctuation is taken as source. Pass an ARRAY to apply ' +
      'several in order on the same held model (for example ["mask_branch.gvy", ' +
      '"aclfnet.getBus(\'Bus14\').loadP = 0.5"]): they accumulate, the run stops at the first failure, ' +
      'and `steps` reports each one. Inside the script the ' +
      'network is bound as `aclfnet` and a DC sensitivity analyser on that same network as `senAlgo` ' +
      '(for example `aclfnet.getBus("Bus14").getContributeLoad("Bus14-L1").loadCP = new Complex(0.18, 0.07)`, ' +
      'or `senAlgo.calGenShiftFactor("Bus14", aclfnet.getBranch("Bus1","Bus5","1"))`); `Complex` and the ' +
      'sensitivity types (`SenAnalysisType`, `ContingencyBranchOutageType`, `DclfAlgoObjectFactory`) are ' +
      'already imported. The script edits the model in place and edits are NOT rolled back, ' +
      'so pass `reload: true` to re-parse the case before applying it; a failing script keeps whatever ' +
      'it already changed. Script output from println is returned as `stdout`. This tool only edits the ' +
      'model — call interpss_run_aclf afterwards to solve the edited case. See ' +
      'docs/groovy-script-adapter-architecture.md for the binding and property mapping.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        script: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description:
            'The Groovy to apply: a .gvy file name in the case folder\'s scripts/ directory ' +
            '(e.g. "ieee14_adjBus14.gvy"), a workspace-relative path such as ' +
            '"data/ieee/Ieee14Bus/scripts/ieee14_adjBranch1_2.gvy" (the "wspace/data/..." spelling is ' +
            'accepted too), or the Groovy source itself — for example ' +
            '"aclfnet.getBus(\'Bus14\').getContributeLoad(\'Bus14-L1\').loadCP = new Complex(0.50, 0.30)" ' +
            'or a multi-line script. Whitespace or statement punctuation marks source; a single bare ' +
            'word is read as a file name. An **array** applies several scripts in order (0.4.11+, up ' +
            'to 20) on the same held model — e.g. ["base_case.gvy", "mask_branch.gvy", "export.gvy"] — ' +
            'stopping at the first failure, with `steps` reporting what each one did.',
        },
        case: {
          type: 'string',
          description:
            "Optional case selector: a workspace-relative path such as 'data/ieee/Ieee14Bus/ieee14.ieee' " +
            "(also accepted as 'wspace/data/ieee/Ieee14Bus/ieee14.ieee'), " +
            "an absolute path containing '/wspace/data/', or a preset label ('IEEE 118-bus', 'IEEE 14-bus', " +
            "'Texas 2K-bus'). Omit it to use the case selected in the InterPSS tab, then the case already " +
            'held by the bridge. The script is always taken from that case folder\'s scripts/ directory.',
        },
        reload: {
          type: 'boolean',
          description:
            'Re-parse the case from disk before applying the script, discarding any earlier script edits ' +
            'on the held model. Defaults to false, which reuses the held model and lets scripts accumulate.',
        },
      },
      required: ['script'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          case: { type: 'string' },
          source: { type: 'string' },
          format: { type: 'string' },
          script: { type: 'string' },
          scripts: { type: 'array', items: { type: 'string' } },
          scriptCount: { type: 'number' },
          applied: { type: 'number' },
          failedScript: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                script: { type: 'string' },
                elapsedMs: { type: 'number' },
                returnValue: { type: 'string' },
                returnType: { type: 'string' },
                stdout: { type: 'string' },
                buses: { type: 'number' },
                branches: { type: 'number' },
                loadMw: { type: 'number' },
                generationMw: { type: 'number' },
                loadMwBefore: { type: 'number' },
                generationMwBefore: { type: 'number' },
                lfConverged: { type: 'boolean' },
              },
            },
          },
          reload: { type: 'boolean' },
          elapsedMs: { type: 'number' },
          returnValue: { type: 'string' },
          returnType: { type: 'string' },
          stdout: { type: 'string' },
          line: { type: 'number' },
          buses: { type: 'number' },
          branches: { type: 'number' },
          loadMw: { type: 'number' },
          generationMw: { type: 'number' },
          loadMwBefore: { type: 'number' },
          generationMwBefore: { type: 'number' },
          lfConverged: { type: 'boolean' },
          error: { type: 'string' },
        },
      },
      render(args, value) {
        // A batch names itself by count and then lists what each script did; a single
        // script keeps the original one-line-per-fact card.
        const batch = value && value.ok === true && Array.isArray(value.steps)
        if (value && value.ok === true) {
          const lines = [
            'InterPSS run script \u2014 ' + String(value.script || '') + ' on ' + String(value.case || '') +
              ' (source: ' + String(value.source || '') + ')',
            'Model: ' + String(value.buses === undefined ? '?' : value.buses) + ' buses \u00b7 ' +
              String(value.branches === undefined ? '?' : value.branches) + ' branches \u00b7 load ' +
              formatAmount(value.loadMwBefore, 'MW') + ' \u2192 ' + formatAmount(value.loadMw, 'MW') + ' MW (' +
              signed(formatAmount(value.loadMw, 'MW'), formatAmount(value.loadMwBefore, 'MW')) + ') \u00b7 gen ' +
              formatAmount(value.generationMwBefore, 'MW') + ' \u2192 ' + formatAmount(value.generationMw, 'MW') +
              ' MW \u00b7 ' + (value.lfConverged === true ? 'solved' : 'not solved'),
          ]
          if (batch) {
            // Each step on its own line: the label, its own delta and what it returned.
            const width = String(value.steps.length).length
            value.steps.forEach((step, i) => {
              const parts = [
                String(i + 1).padStart(width) + '. ' + String(step.script || '?'),
                formatAmount(step.elapsedMs, 'ms') + ' ms',
              ]
              const delta = gvyStepDelta(step)
              if (delta !== '') parts.push(delta)
              if (typeof step.returnValue === 'string' && step.returnValue !== '') {
                parts.push('returned ' + step.returnValue)
              } else if (typeof step.returnType === 'string' && step.returnType !== '') {
                parts.push('returned a ' + step.returnType)
              }
              lines.push(parts.join(' \u00b7 '))
              if (typeof step.stdout === 'string' && step.stdout.trim() !== '') {
                lines.push('   output: ' + step.stdout.trimEnd().split('\n').join('\n   '))
              }
            })
            return [{ type: 'text', text: lines.join('\n') }]
          }
          if (typeof value.returnValue === 'string' && value.returnValue !== '') {
            lines.push('Returned: ' + value.returnValue)
          } else if (typeof value.returnType === 'string' && value.returnType !== '') {
            lines.push('Returned a ' + value.returnType + ' (not rendered)')
          }
          if (typeof value.stdout === 'string' && value.stdout.trim() !== '') {
            lines.push('Script output:', value.stdout.trimEnd())
          }
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const where = value && typeof value.line === 'number' && value.line > 0
          ? ' (script line ' + value.line + ')'
          : ''
        // A batch that failed part-way: say how far it got, because those edits stay.
        const partial = value && typeof value.applied === 'number' && value.scriptCount > 1
          ? '\n' + value.applied + ' of ' + value.scriptCount + ' scripts applied before the failure' +
            (value.failedScript ? ' (failed: ' + value.failedScript + ')' : '') +
            '; the model keeps those edits \u2014 pass reload: true to reset'
          : ''
        return [{
          type: 'text',
          text: 'InterPSS run script failed' + where + ': ' + String((value && value.error) || 'unknown error') + partial,
        }]
      },
      // Persisted to the card's block.meta so the script card renders directly.
      presentationMeta(args, value) {
        if (value === null || value === undefined || value.ok !== true) return { ok: false }
        return {
          ok: true,
          case: String(value.case || ''),
          source: String(value.source || ''),
          script: String(value.script || ''),
        }
      },
    },
    presentCall(args) {
      return { card: 'generic', title: 'InterPSS run script', kind: 'execute', rawInput: args }
    },
    async execute(args, exec) {
      const fail = (error, source) => ({ ok: false, error: error, source: source === undefined ? 'bridge' : source })
      const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : ''
      const root = resolveWorkspaceRoot(ctx, sessionId)
      if (root === '') return fail('could not resolve the session workspace root', 'none')
      if (!(await isIpssWorkspace(ctx, root))) {
        return fail('InterPSS is not available in this workspace: the workspace README.md first heading must be "iPSS Agent"', 'none')
      }
      const resolvedCase = resolveToolCase(sessionId, args && typeof args.case === 'string' ? args.case : '')
      if (resolvedCase.error !== undefined) return fail(resolvedCase.error, 'argument')
      if (resolvedCase.target === null) {
        return fail('no simulation case is selected: pick one in the InterPSS tab, or pass `case` (a data/... path, an absolute path containing /wspace/data/, or a preset label)', 'none')
      }
      const target = resolvedCase.target
      const source = resolvedCase.source

      // `script` is a .gvy selector, inline Groovy source, or an array of those applied in
      // order. Every entry is resolved before the first one runs, so a bad selector cannot
      // leave the model half-edited by an argument mistake.
      const resolved = await resolveGvyArguments(ctx, root, target.input, args && args.script)
      if (resolved.ok !== true) return fail(resolved.error, 'argument')
      const steps = resolved.steps
      const batch = resolved.kind === 'batch'

      const bridge = ctx.get('javaBridge')
      if (bridge === undefined || typeof bridge.runGvy !== 'function') {
        return fail('the in-process InterPSS bridge is unavailable; install java-bridge and rebuild the uber JAR (see scripts/setup-java-bridge.sh)', source)
      }
      if (steps.some((step) => step.kind === 'source') && typeof bridge.runGvySource !== 'function') {
        return fail(
          'this bridge cannot evaluate inline Groovy yet (it predates the adapter\'s source entry point); ' +
          'rebuild the uber JAR (see scripts/setup-java-bridge.sh), or pass .gvy files in `script`',
          source,
        )
      }
      // `reload` re-parses the case *once*, before the first script: every later script
      // must see the edits the earlier ones made.
      const reload = args && args.reload === true
      const absCase = root + '/wspace/' + target.input
      const runStep = (step, first) => (step.kind === 'file'
        ? bridge.runGvy(target.format, absCase, step.abs, first && reload)
        : bridge.runGvySource(target.format, absCase, step.source, first && reload))

      // One digest per step, plus the failure that stopped the run. A script can fail
      // *after* editing, so everything that already ran stays in the result.
      const done = []
      let failure = null
      for (let i = 0; i < steps.length; i++) {
        let parsed = null
        try {
          parsed = JSON.parse(await runStep(steps[i], i === 0))
        } catch (e) {
          failure = { step: steps[i], error: 'InterPSS run script failed: ' + (e && e.message ? e.message : String(e)) }
          break
        }
        if (!parsed || parsed.ok !== true) {
          failure = {
            step: steps[i],
            error: String((parsed && parsed.error) || 'bridge runGvy failed'),
            line: parsed && typeof parsed.line === 'number' ? parsed.line : undefined,
            stdout: parsed && typeof parsed.stdout === 'string' ? parsed.stdout : undefined,
          }
          break
        }
        done.push({ step: steps[i], parsed: parsed })
      }
      if (done.length > 0) adoptLoadedCase(sessionId, target)

      const stepValue = (entry) => {
        const value = { script: entry.step.label }
        for (const key of ['elapsedMs', 'buses', 'branches', 'loadMw', 'generationMw', 'loadMwBefore',
          'generationMwBefore']) {
          const n = finiteOrNull(entry.parsed[key])
          if (n !== null) value[key] = n
        }
        for (const key of ['returnValue', 'returnType']) {
          if (typeof entry.parsed[key] === 'string' && entry.parsed[key] !== '') value[key] = entry.parsed[key]
        }
        if (entry.parsed.lfConverged === true) value.lfConverged = true
        if (typeof entry.parsed.stdout === 'string' && entry.parsed.stdout !== '') {
          value.stdout = truncateStdout(entry.parsed.stdout)
        }
        return value
      }
      const labels = steps.map((step) => step.label)

      if (failure !== null) {
        const value = {
          ok: false,
          error: failure.error,
          case: target.input,
          source: source,
          script: failure.step.label,
          applied: done.length,
        }
        if (batch) {
          value.scripts = labels
          value.scriptCount = steps.length
          value.failedScript = failure.step.label
          value.steps = done.map(stepValue)
        }
        if (typeof failure.line === 'number') value.line = failure.line
        if (typeof failure.stdout === 'string' && failure.stdout !== '') value.stdout = truncateStdout(failure.stdout)
        return value
      }

      const first = done[0].parsed
      const last = done[done.length - 1].parsed

      // A single script (the pre-0.4.11 form) keeps its flat result exactly as before.
      if (!batch) {
        const value = {
          ok: true,
          case: target.input,
          source: source,
          format: target.format,
          script: labels[0],
          reload: reload,
        }
        for (const key of ['elapsedMs', 'buses', 'branches', 'loadMw', 'generationMw', 'loadMwBefore',
          'generationMwBefore', 'line']) {
          const n = finiteOrNull(last[key])
          if (n !== null) value[key] = n
        }
        for (const key of ['returnValue', 'returnType']) {
          if (typeof last[key] === 'string' && last[key] !== '') value[key] = last[key]
        }
        value.lfConverged = last.lfConverged === true
        if (typeof last.stdout === 'string' && last.stdout !== '') value.stdout = truncateStdout(last.stdout)
        return value
      }

      const value = {
        ok: true,
        case: target.input,
        source: source,
        format: target.format,
        script: steps.length + (steps.length === 1 ? ' script' : ' scripts'),
        scripts: labels,
        scriptCount: steps.length,
        applied: steps.length,
        steps: done.map(stepValue),
        reload: reload,
      }
      // The batch digest spans the whole run: before the first script, after the last.
      for (const key of ['buses', 'branches']) {
        const n = finiteOrNull(last[key])
        if (n !== null) value[key] = n
      }
      const before = finiteOrNull(first.loadMwBefore)
      const after = finiteOrNull(last.loadMw)
      if (before !== null) value.loadMwBefore = before
      if (after !== null) value.loadMw = after
      const genBefore = finiteOrNull(first.generationMwBefore)
      const genAfter = finiteOrNull(last.generationMw)
      if (genBefore !== null) value.generationMwBefore = genBefore
      if (genAfter !== null) value.generationMw = genAfter
      let elapsed = 0
      let seen = false
      for (const entry of done) {
        const n = finiteOrNull(entry.parsed.elapsedMs)
        if (n !== null) { elapsed += n; seen = true }
      }
      if (seen) value.elapsedMs = elapsed
      value.lfConverged = last.lfConverged === true
      return value
    },
  }
}

// --- Chat tool: interpss_run_ca ----------------------------------------------
// DC contingency analysis with the dialog bypassed: the inputs come from an explicit
// contingencyFile/monitorFile, else the case folder's config/ca_run.json, else the case-folder
// discovery (*contingenc*.json / *monitor*.json), else the Java defaults (N-1 outages on
// every branch not connected to the reference bus, every branch monitored). The runner
// solves its own DC load flow, so no ACLF run is needed first.
function runCaTool(ctx) {
  return {
    name: 'interpss_run_ca',
    description:
      LOAD_FIRST_HINT +
      'Run a DC contingency analysis (CA) on a power-system case in the embedded InterPSS bridge and report ' +
      'the overload summary. No dialog is involved and nothing is prompted for: the contingency and ' +
      'monitored-branch inputs come from the `contingencyFile` / `monitorFile` arguments when given, ' +
      'otherwise from the case folder config/ca_run.json, otherwise from the case folder discovery ' +
      '(*contingenc*.json / *monitor*.json), otherwise from the Java defaults (N-1 outages on every branch ' +
      'not connected to the reference bus, every branch monitored). `overloadThreshold` sets the ' +
      'over loading threshold in percent (default 90, overridable per call or in config/ca_run.json). Writes ' +
      '<stem>_DF_contingency.csv under wspace/<case dir>/result/ — the file the NERC TPL-001-5 report and ' +
      'the ACLF card Report button consume. The runner solves its own DC load flow, so the case only has ' +
      'to be loaded, not solved; large cases (PSS/E 2K-bus and up) take minutes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        case: {
          type: 'string',
          description:
            "Optional case selector: a workspace-relative path such as 'data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW', " +
            "an absolute path containing '/wspace/data/', or a preset label ('IEEE 118-bus', 'IEEE 14-bus', " +
            "'Texas 2K-bus'). Omit it to use the case selected in the InterPSS tab, then the case already " +
            'held by the bridge.',
        },
        contingencyFile: {
          type: 'string',
          description:
            'Optional contingency JSON: a file name in the case folder (e.g. ' +
            '"2k_contingencies_115kVAbove.json"), or a workspace-relative path such as ' +
            '"data/psse/Texas2K/2k_contingencies_115kVAbove.json". Omit it to use the case folder config/ca_run.json, ' +
            'then the case-folder discovery, then all N-1 outages.',
        },
        monitorFile: {
          type: 'string',
          description:
            'Optional monitored-branch JSON, addressable like `contingencyFile`. Omit it to use the case ' +
            'folder config/ca_run.json, then the case-folder discovery, then every branch.',
        },
        overloadThreshold: {
          type: 'number',
          description:
            'Optional over loading threshold in percent (default 90): a monitored branch whose ' +
            'post-contingency loading reaches it is written to the result CSV. Overrides the case ' +
            'folder config/ca_run.json for this run.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          case: { type: 'string' },
          source: { type: 'string' },
          format: { type: 'string' },
          resultDir: { type: 'string' },
          contingencyCsv: { type: 'string' },
          contingencyFile: { type: 'string' },
          monitoredBranchFile: { type: 'string' },
          threshold: { type: 'number' },
          contingencies: { type: 'number' },
          monitoredBranches: { type: 'number' },
          overloads: { type: 'number' },
          caSummary: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(args, value) {
        if (value && value.ok === true) {
          const amount = (n) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '?')
          const inputs = [
            typeof value.contingencyFile === 'string' && value.contingencyFile !== ''
              ? value.contingencyFile
              : 'all N-1 outages',
            typeof value.monitoredBranchFile === 'string' && value.monitoredBranchFile !== ''
              ? value.monitoredBranchFile
              : 'all branches monitored',
          ]
          return [{
            type: 'text',
            text: [
              'InterPSS DC contingency analysis \u2014 ' + String(value.case || '') +
                ' (source: ' + String(value.source || '') + ')',
              'Threshold ' + amount(value.threshold) + '% \u00b7 ' + amount(value.contingencies) +
                ' contingencies \u00b7 ' + amount(value.monitoredBranches) + ' monitored branches \u00b7 ' +
                amount(value.overloads) + ' overload rows',
              'Inputs: ' + inputs.join(' \u00b7 '),
              'Results: wspace/' + String(value.resultDir || '') + ' (' + String(value.contingencyCsv || '') + ')',
            ].join('\n'),
          }]
        }
        return [{
          type: 'text',
          text: 'InterPSS DC contingency analysis failed: ' + String((value && value.error) || 'unknown error'),
        }]
      },
      // Persisted to the card's block.meta so the card can render without the generic
      // row's expand toggle.
      presentationMeta(args, value) {
        if (value === null || value === undefined || value.ok !== true) return { ok: false }
        return {
          ok: true,
          case: String(value.case || ''),
          source: String(value.source || ''),
          resultDir: String(value.resultDir || ''),
          contingencyCsv: String(value.contingencyCsv || ''),
        }
      },
    },
    presentCall(args) {
      return { card: 'generic', title: 'InterPSS contingency analysis', kind: 'execute', rawInput: args }
    },
    async execute(args, exec) {
      const fail = (error, source) => ({ ok: false, error: error, source: source === undefined ? 'bridge' : source })
      const sessionId = exec && exec.agent && typeof exec.agent.id === 'string' ? exec.agent.id : ''
      const root = resolveWorkspaceRoot(ctx, sessionId)
      if (root === '') return fail('could not resolve the session workspace root', 'none')
      if (!(await isIpssWorkspace(ctx, root))) {
        return fail('InterPSS is not available in this workspace: the workspace README.md first heading must be "iPSS Agent"', 'none')
      }
      const resolvedCase = resolveToolCase(sessionId, args && typeof args.case === 'string' ? args.case : '')
      if (resolvedCase.error !== undefined) return fail(resolvedCase.error, 'argument')
      if (resolvedCase.target === null) {
        return fail('no simulation case is selected: pick one in the InterPSS tab, or pass `case` (a data/... path, an absolute path containing /wspace/data/, or a preset label)', 'none')
      }
      const target = resolvedCase.target
      const source = resolvedCase.source

      const { parent, stem } = casePartsOf(target.input)

      // Arguments override the case's ca_run.json per key; anything omitted keeps following the
      // dialog-free resolution order (ca_run.json -> discovery -> Java defaults), so passing only
      // `overloadThreshold` still runs the case's own contingency and monitored-branch selections.
      const hasCont = args && typeof args.contingencyFile === 'string' && args.contingencyFile.trim() !== ''
      const hasMon = args && typeof args.monitorFile === 'string' && args.monitorFile.trim() !== ''
      const hasThreshold = args && typeof args.overloadThreshold === 'number' &&
        Number.isFinite(args.overloadThreshold)
      const explicit = {}
      if (hasCont) {
        const cont = resolveCaFileArgument(target.input, args.contingencyFile)
        if (cont.ok !== true) return fail(cont.error, 'argument')
        explicit.contingencyMode = 'custom'
        explicit.contingencyFile = cont.input
      }
      if (hasMon) {
        const mon = resolveCaFileArgument(target.input, args.monitorFile)
        if (mon.ok !== true) return fail(mon.error, 'argument')
        explicit.monitorMode = 'custom'
        explicit.monitoredBranchFile = mon.input
      }
      if (hasThreshold) explicit.overloadThreshold = args.overloadThreshold

      const resolvedConfig = await resolveCaRunConfig(ctx, root, parent, undefined)
      if (resolvedConfig.ok !== true) return fail(resolvedConfig.error, 'argument')
      let configured = resolvedConfig
      if (Object.keys(explicit).length > 0) {
        const merged = Object.assign({}, resolvedConfig.config, explicit)
        const validated = await validateCaConfig(ctx, root, merged, true)
        if (!validated.ok) return fail('invalid run configuration: ' + validated.error, 'argument')
        configured = { ok: true, config: validated.config, source: resolvedConfig.source }
      }
      const caConfig = configured.config

      const bridge = ctx.get('javaBridge')
      if (bridge === undefined || typeof bridge.runContingency !== 'function') {
        return fail('the in-process InterPSS bridge is unavailable; install java-bridge and rebuild the uber JAR (see scripts/setup-java-bridge.sh)', source)
      }
      try {
        const absCase = root + '/wspace/' + target.input
        const absResults = root + '/wspace/' + parent + '/result'
        const absCont = caConfig.contingencyFile === null ? null : root + '/wspace/' + caConfig.contingencyFile
        const absMon = caConfig.monitoredBranchFile === null ? null : root + '/wspace/' + caConfig.monitoredBranchFile
        const raw = await bridge.runContingency(target.format, absCase, absCont, absMon, absResults, stem,
          caConfig.overloadThreshold)
        const parsed = JSON.parse(raw)
        if (!parsed || parsed.ok !== true) {
          return fail(String((parsed && parsed.error) || 'bridge runContingency failed'), source)
        }
        adoptLoadedCase(sessionId, target)
        const summary = typeof parsed.caSummary === 'string' ? parsed.caSummary : ''
        const value = {
          ok: true,
          case: target.input,
          source: source,
          format: target.format,
          resultDir: parent + '/result',
          contingencyCsv: typeof parsed.contingencyFile === 'string'
            ? parsed.contingencyFile
            : stem + '_DF_contingency.csv',
          caSummary: summary,
        }
        if (caConfig.contingencyFile !== null) value.contingencyFile = caConfig.contingencyFile
        if (caConfig.monitoredBranchFile !== null) value.monitoredBranchFile = caConfig.monitoredBranchFile
        const numbers = parseCaSummary(summary)
        for (const key of Object.keys(numbers)) {
          if (numbers[key] !== null) value[key] = numbers[key]
        }
        return value
      } catch (e) {
        return fail('InterPSS DC contingency analysis failed: ' + (e && e.message ? e.message : String(e)), source)
      }
    },
  }
}

function truncateStdout(text) {
  return text.length > GVY_STDOUT_LIMIT
    ? text.slice(0, GVY_STDOUT_LIMIT) + '\n\u2026 (truncated)'
    : text
}

// "+3.10" / "-2.00" / "\u00b10.00" for the card's load/gen delta.
function signed(after, before) {
  const a = Number(after)
  const b = Number(before)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '\u00b1?'
  const delta = a - b
  return (delta >= 0 ? '+' : '') + delta.toFixed(2)
}

export default {
  // Wait for the `typert` registry before applying: loader entries activate in
  // parallel, and without this dependency `ctx.get('typert')` can still be
  // `undefined` here, silently skipping the Remote registration (the client
  // tab's /api endpoints then 404). `javaBridge` is still provided
  // unconditionally once this row applies.
  inject: ['typert'],
  apply(ctx) {
    diag('apply reached; ctx=' + (typeof ctx) + ' hasProvide=' + (typeof ctx.provide) + ' hasReflect=' + (typeof ctx.reflect))
    console.error('[dsh-interpss] apply reached')
    try {
    // Provide the `interpss` service (and its Typert binding) by instantiating
    // the Service. Its registration is owned by this fiber, so it unwinds with
    // the plugin.
    new InterpssService(ctx)

    // Publish the in-process `javaBridge` service (lazy JVM bootstrap). Other
    // host rows — e.g. the dynamic per-session plugin — consume it via
    // `ctx.get('javaBridge')`. Provided unconditionally: the uber-JAR root is
    // derived from the case path (rootFor), never from sandboxPolicy, which
    // may not be available when this row applies early.
    function rootFor(absCase) {
      if (typeof absCase === 'string') {
        // The case path is always <workspace>/wspace/data/…, but the DSH home
        // itself may live under a directory also named "wspace" (e.g.
        // ~/Documents/wspace/…), so anchor on the unique "/wspace/data/" marker
        // instead of the first "/wspace/".
        const i = absCase.indexOf('/wspace/data/')
        if (i >= 0) return absCase.slice(0, i)
      }
      return ''
    }

    ctx.provide('javaBridge', {
      async loadCase(format, absCase) {
        const bridge = await ensureBridge(rootFor(absCase))
        const raw = await bridge.loadCase(format, absCase)
        rememberLoadedCase(raw, absCase)
        return raw
      },
      async runAclf(format, absCase, absCfg, absResults, stem) {
        const bridge = await ensureBridge(rootFor(absCase))
        const cap = captureStdio()
        let raw
        try {
          raw = await bridge.runAclf(format, absCase, absCfg, absResults, stem)
        } finally {
          cap.stop()
        }
        // Attach the intercepted stdout/stderr so the GUI "Show log info"
        // panel can render them instead of the dsh terminal.
        try {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            if (parsed.ok === true) {
              lastLoadedAbs = absCase
              const counts = parseNetworkCounts(parsed.networkInfo)
              rememberLoadedCounts(counts.busCount, counts.branchCount)
            }
            parsed.stdout = cap.out()
            parsed.stderr = cap.err()
            raw = JSON.stringify(parsed)
          }
        } catch (e) {}
        return raw
      },
      async summarize(scope, sortRule, numRec) {
        const bridge = await ensureBridge(rootFor(''))
        return bridge.summarize(scope, sortRule, numRec)
      },
      // Apply a Groovy scenario script to the held case. Mutations are in place, so
      // `absCase` becomes the case the JVM holds — the same bookkeeping `runAclf`
      // does. stdout/stderr are attached like runAclf's, which is how a script's
      // println output reaches the caller instead of the dsh terminal.
      async runGvy(format, absCase, absScript, reload) {
        const bridge = await ensureBridge(rootFor(absCase))
        return gvyThrough(() => bridge.runGvy(format, absCase, absScript, reload === true), absCase)
      },
      // The adapter's inline entry point: the same evaluation without a .gvy file.
      // Kept beside runGvy so both share the stdio capture and held-case bookkeeping.
      async runGvySource(format, absCase, source, reload) {
        const bridge = await ensureBridge(rootFor(absCase))
        return gvyThrough(() => bridge.runGvySource(format, absCase, source, reload === true), absCase)
      },
      async networkInfo() {
        const bridge = await ensureBridge(rootFor(''))
        return bridge.getNetworkInfo()
      },
      // Network info for one case, or for whatever the JVM already holds when
      // `absCase` is blank. Loading is part of the call; a case the JVM already
      // holds is reused so a converged AC load flow is preserved. Returns a JSON
      // string like the other bridge methods.
      async caseInfo(format, absCase) {
        const want = typeof absCase === 'string' ? absCase.trim() : ''
        if (want === '' && lastLoadedAbs === null) {
          return JSON.stringify({ ok: false, error: 'no simulation case is loaded in the InterPSS bridge' })
        }
        const target = want === '' ? lastLoadedAbs : want
        // `target` is always an absolute case path here, so the JVM (if this is
        // the first bridge call) boots with the real workspace classpath.
        const bridge = await ensureBridge(rootFor(target))
        let reused = true
        if (target !== lastLoadedAbs) {
          const raw = await bridge.loadCase(format === 'psse' ? 'psse' : 'ieee', target)
          let parsed = null
          try { parsed = JSON.parse(raw) } catch (e) {}
          if (!parsed || parsed.ok !== true) return raw
          lastLoadedAbs = target
          reused = false
        }
        const info = await bridge.getNetworkInfo()
        const text = typeof info === 'string' ? info : ''
        if (text === '') {
          return JSON.stringify({ ok: false, error: 'the InterPSS bridge returned no network information for ' + target })
        }
        const counts = parseNetworkCounts(text)
        rememberLoadedCounts(counts.busCount, counts.branchCount)
        return JSON.stringify({
          ok: true,
          input: target,
          reused: reused,
          busCount: counts.busCount,
          branchCount: counts.branchCount,
          lfConverged: /Loadflow converged:\s*true/i.test(text),
          networkInfo: text,
        })
      },
      async runReport(reportType, displayName, projectRoot, resultDirRelative, csvPrefix) {
        const bridge = await ensureBridge(projectRoot || rootFor(''))
        return bridge.runReport(reportType, displayName, projectRoot, resultDirRelative, csvPrefix)
      },
      async runContingency(format, absCase, absCont, absMon, absResults, stem, overloadThreshold) {
        const bridge = await ensureBridge(rootFor(absCase))
        const cap = captureStdio()
        const threshold = typeof overloadThreshold === 'number' && Number.isFinite(overloadThreshold)
          ? overloadThreshold
          : 90
        let raw
        try {
          raw = await bridge.runContingency(format, absCase, absCont, absMon, absResults, stem, threshold)
        } finally {
          cap.stop()
        }
        // Attach the intercepted stdout/stderr (e.g. "Using N threads…") so the
        // GUI can surface them instead of the dsh terminal.
        try {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            if (parsed.ok === true) lastLoadedAbs = absCase
            parsed.stdout = cap.out()
            parsed.stderr = cap.err()
            raw = JSON.stringify(parsed)
          }
        } catch (e) {}
        return raw
      },
      // Resolved `java` launcher for the dynamic plugin's CLI shell fallback.
      // Synchronous, does NOT start the JVM; safe to call even when java-bridge
      // is not installed (JDK discovery uses only node:fs + process).
      javaLauncher() {
        return javaBin()
      },
    })
    diag('javaBridge provided unconditionally')

    const typert = ctx.get('typert')
    if (typert !== undefined) {
      const dispose = typert.register({
        package: PACKAGE,
        face: 'host',
        schemas: [],
        model: { services: [], events: [], objects: [] },
        invocations: DESCRIPTORS,
      })
      ctx.effect(() => dispose)
    }

    // Expose the InterPSS capability to the chat agent as model tools. This row
    // applies at the host level, so the registration is global and each tool
    // call is gated on the iPSS Agent workspace activation check.
    const tools = ctx.get('tools')
    if (tools !== undefined) {
      const chatToolDefs = [caseLoadTool(ctx), networkInfoTool(ctx), runAclfTool(ctx), caseSummaryTool(ctx), runGvyTool(ctx), runCaTool(ctx)]
      for (const definition of chatToolDefs) {
        ctx.effect(() => tools.register(definition))
      }
      diag('chat tools registered: ' + chatToolDefs.map((definition) => definition.name).join(', '))
    } else {
      diag('chat tools NOT registered: the tools service is unavailable in this context')
    }
    diag('apply complete; interpss=' + (ctx.get('interpss') !== undefined) + ' javaBridge=' + (ctx.get('javaBridge') !== undefined) + ' tools=' + (tools !== undefined))
    } catch (e) {
      diag('apply FAILED: ' + (e && e.stack ? e.stack : e))
      console.error('[dsh-interpss] apply failed:', e && e.stack ? e.stack : e)
      throw e
    }
  },
}

