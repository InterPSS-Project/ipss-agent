// InterPSS dynamic dual-face plugin — Host half.
//
// Dynamic-port of @deepseek-ai/dsh-interpss (the persistent composition row).
// The persistent Host half exposed an `interpss` Cordis service through the
// Typert Remote gateway (/api endpoints). The dynamic Host half instead
// registers Package-private Client<->Host RPC handlers with harness.handle,
// one per method: 'interpss/<method>'. The browser Client half
// (client.js) calls these through host.call('interpss/<method>', args).
//
// The activation gate is unchanged: the tab only offers the tool when the
// workspace README.md's first H1 is exactly "iPSS Agent".

const NAMESPACE = 'interpss'
const METHODS = ['isActivated', 'checkResult', 'checkResultFiles', 'listCases', 'readCsv', 'busConnections', 'runAclf', 'runCa', 'runReport', 'getAclfOptions', 'saveAclfOptions', 'listCaFiles', 'getCaOptions', 'saveCaOptions', 'loadCase', 'summarizeResult', 'getNetworkInfo', 'getBridgeCase', 'listDrawioFiles', 'readDrawio', 'openDrawio', 'getNetDiagramOptions', 'saveNetDiagramOptions']

function shellQuote(value) {
  return "'" + String(value) + "'"
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

// The preview reads one diagram at a time, so this bounds what it accepts as text. It is checked
// BEFORE the read, so an oversized file never reaches the RPC payload. 4 MiB covers the largest
// drawing this workspace produces -- a 2000-bus case is ~2.9 MiB of XML (Texas 2K) -- with room
// for a hand-edited one on top; the 20000-cell preview cap is the other half of the bound.
const MAX_DRAWIO_BYTES = 4 * 1024 * 1024

// --- Launch the local draw.io app (shared, byte-identical in both hosts) -----
// The browser cannot start a process, so the Diagram tab's edit button asks the Host — and the
// Host goes through the `subprocess` service rather than `node:child_process`, because the
// dynamic half is an injected body with no imports and the service is the sandbox-aware
// execution world the harness already manages.
//
// WHICH executable to run is configuration, not code: `config/ipss_plugin_env.json` carries an
// ordered `drawio.launchers` list (see the shipped file for the schema), so a Windows or Linux
// install names its own draw.io path instead of living with the macOS default. The list below is
// what the plugin uses when that file is missing, unreadable or malformed — a broken config must
// never disable the button, only change which executable it tries.
//
// Entries are tried in order and the file path to edit is appended to `args`. Every entry
// resolves its executable FIRST, so a command that is not installed comes back as a message
// instead of a spawn failure, and all the failures are reported together.
const DEFAULT_DRAWIO_LAUNCHERS = [
  { platform: 'darwin', exe: 'open', args: ['-a', 'draw.io'], label: 'open -a draw.io' },
  { platform: 'darwin', exe: '/Applications/draw.io.app/Contents/MacOS/draw.io', args: [], label: '/Applications/draw.io.app' },
  { platform: 'win32', exe: 'C:\\Program Files\\draw.io\\draw.io.exe', args: [], label: 'C:\\Program Files\\draw.io\\draw.io.exe' },
  { platform: 'win32', exe: 'cmd.exe', args: ['/c', 'start', ''], label: 'cmd /c start' },
  { platform: 'linux', exe: 'drawio', args: [], label: 'drawio' },
  { platform: 'linux', exe: '/opt/drawio/drawio', args: [], label: '/opt/drawio/drawio' },
  { platform: 'linux', exe: 'xdg-open', args: [], label: 'xdg-open' },
  { exe: 'open', args: [], label: 'open' },
  { exe: 'xdg-open', args: [], label: 'xdg-open' },
]

const DRAWIO_LAUNCHER_LIMIT = 12

// `process` is a plain Node global — the persistent Host certainly has it, and the dynamic body
// is an injected module that must not IMPORT anything (it may still read a global). The read is
// guarded and the answer is only a HINT: with no platform, every launcher is kept in file order
// and executable resolution decides, which is also how an entry for another OS is skipped.
function drawioPlatformKey() {
  try {
    const p = typeof process === 'object' && process !== null ? process.platform : ''
    if (p === 'darwin') return 'darwin'
    if (p === 'win32') return 'win32'
    if (p === 'linux') return 'linux'
  } catch (e) {}
  return ''
}

// An entry's optional `platform` tag: absent = every OS (tried last, as a file-association
// fallback), `posix` = any non-Windows, and the mac/win/linux spellings are accepted because the
// file is hand-written.
function drawioPlatformMatches(tag, platform) {
  if (typeof tag !== 'string' || tag === '') return true
  if (platform === '') return true
  const wanted = tag.trim().toLowerCase()
  if (wanted === platform) return true
  if (wanted === 'posix') return platform !== 'win32'
  if (platform === 'win32') return wanted === 'windows' || wanted === 'win'
  if (platform === 'darwin') return wanted === 'macos' || wanted === 'mac' || wanted === 'osx'
  if (platform === 'linux') return wanted === 'linux' || wanted === 'unix'
  return false
}

// One config entry -> the { exe, args, label } a launcher needs, or null when it is unusable.
function drawioLauncherEntry(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.exe !== 'string' || raw.exe.trim() === '') return null
  const args = []
  if (Array.isArray(raw.args)) {
    for (const a of raw.args) if (typeof a === 'string') args.push(a)
  }
  const exe = raw.exe.trim()
  return {
    platform: typeof raw.platform === 'string' ? raw.platform.trim().toLowerCase() : '',
    exe: exe,
    args: args,
    label: typeof raw.label === 'string' && raw.label.trim() !== '' ? raw.label.trim() : exe,
  }
}

// The configured list, or null when the parsed file has no usable `drawio.launchers` array
// (which is what makes the caller fall back to the defaults AND say why).
function drawioLauncherList(parsed) {
  const drawio = parsed !== null && typeof parsed === 'object' ? parsed.drawio : null
  const raw = drawio !== null && typeof drawio === 'object' && Array.isArray(drawio.launchers) ? drawio.launchers : null
  if (raw === null) return null
  const out = []
  for (const entry of raw) {
    const one = drawioLauncherEntry(entry)
    if (one !== null) out.push(one)
    if (out.length >= DRAWIO_LAUNCHER_LIMIT) break
  }
  return out.length === 0 ? null : out
}

// This machine's launchers, in the order to try them: its own platform's entries first (in file
// order), then the untagged association fallbacks. An unknown platform keeps the file order
// untouched, so the same file works on a host whose OS cannot be identified.
function drawioLaunchersFor(list, platform) {
  const source = Array.isArray(list) && list.length > 0 ? list : DEFAULT_DRAWIO_LAUNCHERS
  if (platform === '') return source.slice()
  const own = []
  const neutral = []
  for (const entry of source) {
    const one = drawioLauncherEntry(entry)
    if (one === null) continue
    if (one.platform === '') neutral.push(one)
    else if (drawioPlatformMatches(one.platform, platform)) own.push(one)
  }
  return own.concat(neutral)
}

// A failing launcher is worth quoting only if it said something: `open: no such file` is the
// useful half of a failure, the empty string is not.
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

// One launcher: resolve, spawn, wait for the exit fact. `open` returns as soon as the app is
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

async function drawioLaunch(sp, launchers, absPath, cwd, signal) {
  const tried = []
  for (const rung of launchers) {
    const result = await drawioLaunchOnce(sp, rung, absPath, cwd, signal)
    if (result.ok === true) return { ok: true, launcher: result.launcher }
    tried.push(result.why)
  }
  return { ok: false, error: 'could not launch the local draw.io app (' + tried.join('; ') + ')' }
}

// `config/ipss_plugin_env.json` (project-level, beside `aclf_run.json`) -> this machine's
// launchers. A missing file is not an error: the defaults above are the shipped behaviour. A
// file that exists but has no usable launcher list keeps the defaults and reports why, so a
// typo in a hand-written config surfaces in the button's error instead of silently doing nothing.
async function readDrawioLaunchers(fs, root) {
  const rel = root + '/config/ipss_plugin_env.json'
  let info
  try {
    const target = await fs.resolve(rel)
    info = await fs.stat(target)
  } catch (e) {
    return { launchers: DEFAULT_DRAWIO_LAUNCHERS, source: 'defaults', warning: '' }
  }
  if (info === undefined) return { launchers: DEFAULT_DRAWIO_LAUNCHERS, source: 'defaults', warning: '' }
  let parsed = null
  try {
    parsed = JSON.parse(await fs.readText(await fs.resolve(rel)))
  } catch (e) {
    return { launchers: DEFAULT_DRAWIO_LAUNCHERS, source: 'defaults', warning: 'config/ipss_plugin_env.json is not valid JSON, so the built-in draw.io launchers are used' }
  }
  const list = drawioLauncherList(parsed)
  if (list === null) {
    return { launchers: DEFAULT_DRAWIO_LAUNCHERS, source: 'defaults', warning: 'config/ipss_plugin_env.json has no usable drawio.launchers array, so the built-in draw.io launchers are used' }
  }
  return { launchers: list, source: 'config', warning: '' }
}
// --- end draw.io launcher --------------------------------------------------- ---------------------------------------------------

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

return {
  apply(ctx) {
    function resolveWorkspaceRoot(sessionId) {
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

    // In-process bridge, provided by the persistent plugin (which can require
    // `java-bridge`). Optional: when absent, runAclf falls back to shell-out.
    const javaBridge = ctx.get('javaBridge')

    // Resolved `java` launcher for the CLI shell fallback. The persistent plugin
    // exposes javaLauncher() on its javaBridge provider (JDK self-discovery on
    // Windows); fall back to bare `java` when it is unavailable.
    const javaLauncher = () => {
      if (javaBridge !== undefined && typeof javaBridge.javaLauncher === 'function') {
        try {
          const j = javaBridge.javaLauncher()
          if (typeof j === 'string' && j.trim() !== '') return j
        } catch (e) {}
      }
      return 'java'
    }

    function caseParts(caseInput) {
      const slash = caseInput.lastIndexOf('/')
      const parent = slash >= 0 ? caseInput.slice(0, slash) : ''
      const stem = caseInput.slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
      return { parent: parent, stem: stem }
    }

    // Absolute bridge path -> wspace-relative data/... path, anchored on the unique
    // "/wspace/data/" marker so a home directory that itself contains "wspace"
    // cannot shift the result.
    function relativeCasePath(absPath) {
      const marker = '/wspace/data/'
      const i = String(absPath).indexOf(marker)
      return i >= 0 ? 'data/' + String(absPath).slice(i + marker.length) : String(absPath)
    }

    function wspaceJoin(parent, name) {
      return parent === '' ? name : parent + '/' + name
    }

    // Case-specific config/aclf_run.json wins (under the case folder), then the
    // project default config/aclf_run.json.
    async function resolveAclfConfigPath(root, caseInput) {
      const fs = ctx.get('fs')
      if (fs === undefined) return root + '/config/aclf_run.json'
      const { parent } = caseParts(caseInput)
      const caseCfg = root + '/wspace/' + wspaceJoin(parent, 'config/aclf_run.json')
      const defCfg = root + '/config/aclf_run.json'
      try {
        const target = await fs.resolve(caseCfg)
        const info = await fs.stat(target)
        if (info !== undefined) return caseCfg
      } catch (e) {}
      return defCfg
    }

    // ---------------------------------------------------------------------
    // Contingency-analysis run config (config/ca_run.json)
    // ---------------------------------------------------------------------
    // Written beside config/aclf_run.json under the case folder by the CA dialog
    // and read by runCa. Contingency inputs are case-specific, so there is no
    // project-level default: an absent file falls back to the per-case
    // suggestion below, which reproduces the filename discovery the CA run has
    // always used.

    const DEFAULT_CA_CONFIG = {
      contingencyMode: 'all',
      contingencyFile: null,
      monitorMode: 'all',
      monitoredBranchFile: null,
      // Violation-check loading (%): a monitored branch at or above it after a contingency
      // lands in the result CSV. The CA dialog's field and config/ca_run.json both feed
      // this one number.
      overloadThreshold: 90,
    }

    // The dialog reports how many entries a candidate file holds, which means
    // parsing every .json in the case folder; skip absurd ones.
    // config/net_diagram.json: the Diagram tab's flag thresholds and colours, edited from the tab's
// gear dialog (0.6.26). WORKSPACE-level -- one flag style for every case -- and a PREVIEW setting:
// the generator bakes no colour into a .drawio, so the desktop app and the PNG stay plain.
const DEFAULT_NET_DIAGRAM_CONFIG = {
  Bus_flag_upper_limit: 1.1,
  Bus_flag_lower_limit: 0.9,
  Bus_flag_color: 'red',
  Basecase_branch_flow_flag_percent: 80.0,
  Basecase_branch_flow_flag_color: 'green',
  Contingency_branch_flow_flag_percent: 100.0,
  Contingency_branch_flow_flag_color: 'blue',
}

const NET_DIAGRAM_COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([^)]*\)|hsla?\([^)]*\))$/i

// The seven known keys, validated; every other key is passed through untouched. The client
// validates the same way for immediate feedback, the Host sanitizes again so nothing bad lands.
function sanitizeNetDiagramConfig(raw) {
  const out = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.assign({}, raw) : {}
  const defaults = DEFAULT_NET_DIAGRAM_CONFIG
  const num = (key, fallback, lo, hi) => {
    const v = Number(out[key])
    out[key] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
  }
  const color = (key, fallback) => {
    const v = typeof out[key] === 'string' ? out[key].trim() : ''
    out[key] = NET_DIAGRAM_COLOR_RE.test(v) ? v : fallback
  }
  num('Bus_flag_upper_limit', defaults.Bus_flag_upper_limit, 0.05, 5.0)
  num('Bus_flag_lower_limit', defaults.Bus_flag_lower_limit, 0.05, 5.0)
  if (!(out.Bus_flag_lower_limit < out.Bus_flag_upper_limit)) {
    out.Bus_flag_lower_limit = defaults.Bus_flag_lower_limit
    out.Bus_flag_upper_limit = defaults.Bus_flag_upper_limit
  }
  color('Bus_flag_color', defaults.Bus_flag_color)
  num('Basecase_branch_flow_flag_percent', defaults.Basecase_branch_flow_flag_percent, 0.0, 1000.0)
  color('Basecase_branch_flow_flag_color', defaults.Basecase_branch_flow_flag_color)
  num('Contingency_branch_flow_flag_percent', defaults.Contingency_branch_flow_flag_percent, 0.0, 1000.0)
  color('Contingency_branch_flow_flag_color', defaults.Contingency_branch_flow_flag_color)
  return out
}

const CA_INSPECT_MAX_BYTES = 16 * 1024 * 1024

    function netDiagramConfigPath(root) {
  return root + '/config/net_diagram.json'
}

function caConfigPath(root, parent) {
      return root + '/wspace/' + wspaceJoin(parent, 'config/ca_run.json')
    }

    function caConfigRel(parent) {
      return wspaceJoin(parent, 'config/ca_run.json')
    }

    // Case-folder .json files that can be contingency inputs: our own two
    // config files are settings, not inputs.
    function caCandidateName(name) {
      return /\.json$/i.test(name) && name !== 'aclf_run.json' && name !== 'ca_run.json'
    }

    // Today's discovery heuristic, kept as the default when no ca_run.json
    // exists: the first *contingenc*.json and the first *monitor*.json.
    async function suggestCaConfig(root, parent) {
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

    // A ca_run.json entry is a wspace-relative path: never absolute, never
    // escaping wspace/.
    async function caEntryCheck(root, value) {
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

    // Normalise an untrusted config payload to the five known keys. Modes must
    // be exactly 'all' | 'custom'; a custom mode must name a file, which must
    // exist when `requireFiles` is set.
    async function validateCaConfig(root, value, requireFiles) {
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
        const check = await caEntryCheck(root, rel)
        if (!check.ok) return { ok: false, error: fileKey + ': ' + check.error }
        if (requireFiles && !check.exists) {
          return { ok: false, error: fileKey + ' not found: ' + rel }
        }
        out[fileKey] = rel
      }
      return { ok: true, config: out }
    }

    // Effective CA config for a run: an explicit payload from the dialog, else
    // the case-folder ca_run.json, else the per-case suggestion.
    async function resolveCaRunConfig(root, parent, explicit) {
      if (explicit !== undefined && explicit !== null) {
        const validated = await validateCaConfig(root, explicit, true)
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
          const validated = await validateCaConfig(root, parsed, true)
          if (!validated.ok) return { ok: false, error: validated.error }
          return { ok: true, config: validated.config, source: 'case' }
        }
      }
      return { ok: true, config: await suggestCaConfig(root, parent), source: 'suggested' }
    }

    const handlers = {
      async isActivated(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { activated: false }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { activated: false }
        try {
          const target = await fs.resolve(root + '/README.md')
          const text = await fs.readText(target)
          const lines = String(text).replace(/\r\n/g, '\n').split('\n')
          let title = ''
          for (const line of lines) {
            const t = line.trim()
            if (t.indexOf('# ') === 0) { title = t.slice(2).trim(); break }
          }
          return { activated: title === 'iPSS Agent' }
        } catch (e) {
          return { activated: false }
        }
      },

      async checkResult(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const casePath = args && typeof args.input === 'string' ? args.input : ''
        if (casePath.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(casePath)) {
          return { ok: false, error: 'Invalid case path: ' + casePath }
        }
        const root = resolveWorkspaceRoot(args && args.sessionId)
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
      },

      async checkResultFiles(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const casePath = args && typeof args.input === 'string' ? args.input : ''
        if (casePath.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(casePath)) {
          return { ok: false, error: 'Invalid case path: ' + casePath }
        }
        const root = resolveWorkspaceRoot(args && args.sessionId)
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
      },

      async listCases(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
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
      },

      // The tab's Diagram source: the .drawio files DIRECTLY inside the selected case's
      // `diagram/` folder, as workspace-relative paths so `readDrawio` can take one
      // straight back. A diagram belongs to a case, and the tab's Diagram button is enabled
      // by this answer, so an absent case or folder is an EMPTY LIST and not an error —
      // "this case has no diagram yet" is a state the tab renders. A malformed case path is
      // a real error.
      async listDrawioFiles(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const caseInput = args && typeof args.case === 'string' ? args.case : ''
        if (caseInput === '' || caseInput.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(caseInput)) {
          return { ok: false, error: 'Invalid case path: ' + caseInput }
        }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        const relDir = 'wspace/' + wspaceJoin(caseParts(caseInput).parent, 'diagram')
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
      },

      // Read one .drawio as text for the client-side renderer. The whitelist is the same
      // shape as readCsv's, plus an explicit `..` rejection, and the size check happens
      // before the read so an oversized file never reaches the RPC payload.
      async readDrawio(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const path = args && typeof args.path === 'string' ? args.path : ''
        if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-\/]*\.drawio$/i.test(path) || path.indexOf('..') !== -1) {
          return { ok: false, error: 'Invalid diagram path: ' + path }
        }
        const root = resolveWorkspaceRoot(args && args.sessionId)
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
      },

      // Hand one diagram to the local draw.io desktop app (the Diagram tab's edit button).
      // The path validation is readDrawio's, the launch itself is the shared helper above, and
      // the answer names the rung that worked — `open` reports success once the OS has the
      // file, so this says "launched", not "edited".
      async openDrawio(args) {
        const sp = ctx.get('subprocess')
        if (sp === undefined) return { ok: false, error: 'subprocess service unavailable' }
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const path = args && typeof args.path === 'string' ? args.path : ''
        if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-\/]*\.drawio$/i.test(path) || path.indexOf('..') !== -1) {
          return { ok: false, error: 'Invalid diagram path: ' + path }
        }
        const root = resolveWorkspaceRoot(args && args.sessionId)
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
        const configured = await readDrawioLaunchers(fs, root)
        const result = await drawioLaunch(sp, drawioLaunchersFor(configured.launchers, drawioPlatformKey()), abs, root, undefined)
        if (result.ok !== true && configured.warning !== '') result.error = result.error + ' — ' + configured.warning
        return result
      },

      async readCsv(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const path = args && typeof args.path === 'string' ? args.path : ''
        if (!/^data\/[A-Za-z0-9_.\/-]+\/result\/[A-Za-z0-9_.-]+_DF_(bus|branch|gen|load|contingency)\.csv$/.test(path)) {
          return { ok: false, error: 'Invalid result path: ' + path }
        }
        const start = (args && typeof args.start === 'number' && args.start > 0) ? Math.floor(args.start) : 0
        const limit = (args && typeof args.limit === 'number' && args.limit > 0) ? Math.floor(args.limit) : 200
        const root = resolveWorkspaceRoot(args && args.sessionId)
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
        const applied = applyCsvSort(data, header, args && args.sortColumn, args && args.sortDesc === true)
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
      },

      async busConnections(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const busId = args && typeof args.busId === 'string' ? args.busId : ''
        const path = args && typeof args.path === 'string' ? args.path : ''
        if (busId === '') return { ok: false, error: 'missing bus id' }
        if (!/^data\/[A-Za-z0-9_.\/-]+\/result\/[A-Za-z0-9_.-]+_DF_branch\.csv$/.test(path)) {
          return { ok: false, error: 'Invalid branch path: ' + path }
        }
        const root = resolveWorkspaceRoot(args && args.sessionId)
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
      },

      async runAclf(args) {
        const format = args && args.format === 'psse' ? 'psse' : 'ieee'
        const caseInput = args && typeof args.input === 'string' ? args.input : ''
        if (caseInput.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(caseInput)) {
          return { ok: false, error: 'Invalid case path: ' + caseInput }
        }

        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }

        const { parent, stem } = caseParts(caseInput)

        // In-process bridge path (preferred): no JVM spawn, cached network.
        if (javaBridge !== undefined && typeof javaBridge.runAclf === 'function') {
          try {
            const absCase = root + '/wspace/' + caseInput
            const absCfg = await resolveAclfConfigPath(root, caseInput)
            const absResults = root + '/wspace/' + parent + '/result'
            const raw = await javaBridge.runAclf(format, absCase, absCfg, absResults, stem)
            const parsed = JSON.parse(raw)
            if (parsed && parsed.ok) {
              return {
                ok: true,
                exitCode: 0,
                timedOut: false,
                aborted: false,
                stdout: parsed.stdout || '',
                stderr: parsed.stderr || '',
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

        // Fallback: shell out to IpssCmd (no in-process bridge available).
        const shell = ctx.get('shell')
        if (shell === undefined) return { ok: false, error: 'shell service unavailable' }

        const wspace = root + '/wspace'
        const infoRel = parent + '/result/' + stem + '_network_info.txt'

        const javaCp = root + '/target/classes:' + root + '/lib/ipss_runnable.jar:' + root + '/lib/deps/*'
        const command = shellQuote(javaLauncher()) + ' -cp "' + javaCp + '" org.interpss.agent.IpssCmd aclf ' + format + ' ' + caseInput
        const spec = shell.resolve({ command: command, workdir: wspace, timeoutMs: 180000, stdoutMaxBytes: 300000 })

        let res
        try {
          res = await shell.run(spec)
        } catch (e) {
          return { ok: false, error: 'command failed to start: ' + (e && e.message ? e.message : String(e)) }
        }

        let networkInfo = null
        if (res.exitCode === 0) {
          const fs = ctx.get('fs')
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
      },

      async runCa(args) {
        const format = args && args.format === 'psse' ? 'psse' : 'ieee'
        const caseInput = args && typeof args.input === 'string' ? args.input : ''
        if (caseInput.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(caseInput)) {
          return { ok: false, error: 'Invalid case path: ' + caseInput }
        }

        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }

        const { parent, stem } = caseParts(caseInput)
        const resultDir = parent + '/result'

        // Run configuration: an explicit payload from the dialog, else the
        // case-folder ca_run.json, else the per-case filename discovery. A
        // custom entry with no matching file becomes null, which selects the
        // Java defaults (N-1 outages / all branches monitored).
        const resolved = await resolveCaRunConfig(root, parent, args && args.config)
        if (!resolved.ok) return { ok: false, error: resolved.error }
        const caConfig = resolved.config
        const contRel = caConfig.contingencyFile
        const monRel = caConfig.monitoredBranchFile

        // In-process bridge path (preferred): no JVM spawn, cached network.
        if (javaBridge !== undefined && typeof javaBridge.runContingency === 'function') {
          try {
            const absCase = root + '/wspace/' + caseInput
            const absCont = contRel !== null ? root + '/wspace/' + contRel : null
            const absMon = monRel !== null ? root + '/wspace/' + monRel : null
            const absResults = root + '/wspace/' + resultDir
            const raw = await javaBridge.runContingency(format, absCase, absCont, absMon, absResults, stem,
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
        const shell = ctx.get('shell')
        if (shell === undefined) return { ok: false, error: 'shell service unavailable' }

        const wspace = root + '/wspace'
        const javaCp = root + '/target/classes:' + root + '/lib/ipss_runnable.jar:' + root + '/lib/deps/*'
        let command = shellQuote(javaLauncher()) + ' -cp "' + javaCp + '" org.interpss.agent.IpssCmd ca ' + format + ' ' + caseInput
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
      },

      async loadCase(args) {
        const format = args && args.format === 'psse' ? 'psse' : 'ieee'
        const caseInput = args && typeof args.input === 'string' ? args.input : ''
        if (caseInput.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(caseInput)) {
          return { ok: false, error: 'Invalid case path: ' + caseInput }
        }
        if (javaBridge === undefined || typeof javaBridge.loadCase !== 'function') {
          return { ok: false, error: 'in-process bridge unavailable (install the persistent InterPSS plugin)' }
        }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        try {
          const absCase = root + '/wspace/' + caseInput
          const raw = await javaBridge.loadCase(format, absCase)
          const parsed = JSON.parse(raw)
          if (parsed && parsed.ok) {
            return { ok: true, format: parsed.format, input: caseInput, busCount: parsed.busCount, branchCount: parsed.branchCount }
          }
          return { ok: false, error: parsed && parsed.error ? parsed.error : 'bridge loadCase failed' }
        } catch (e) {
          return { ok: false, error: 'bridge loadCase failed: ' + (e && e.message ? e.message : String(e)) }
        }
      },

      async summarizeResult(args) {
        const scope = args && typeof args.scope === 'string' ? args.scope : 'Net'
        const sortRule = args && typeof args.sortRule === 'string' ? args.sortRule : ''
        const numRec = args && typeof args.numRec === 'number' && args.numRec > 0 ? Math.floor(args.numRec) : 10
        if (javaBridge === undefined || typeof javaBridge.summarize !== 'function') {
          return { ok: false, error: 'in-process bridge unavailable (install the persistent InterPSS plugin)' }
        }
        try {
          const raw = await javaBridge.summarize(scope, sortRule, numRec)
          const parsed = JSON.parse(raw)
          if (parsed && parsed.ok) {
            return { ok: true, scope: parsed.scope || scope, text: parsed.text || '' }
          }
          return { ok: false, error: parsed && parsed.error ? parsed.error : 'bridge summarize failed' }
        } catch (e) {
          return { ok: false, error: 'bridge summarize failed: ' + (e && e.message ? e.message : String(e)) }
        }
      },

      async getNetworkInfo(args) {
        if (javaBridge === undefined || typeof javaBridge.networkInfo !== 'function') {
          return { ok: false, error: 'in-process bridge unavailable (install the persistent InterPSS plugin)' }
        }
        try {
          const text = await javaBridge.networkInfo()
          return { ok: true, networkInfo: typeof text === 'string' ? text : '' }
        } catch (e) {
          return { ok: false, error: 'bridge getNetworkInfo failed: ' + (e && e.message ? e.message : String(e)) }
        }
      },

      // The case the bridge currently holds, for the tab's Simu Case picker: a chat
      // tool can load (or switch) the model while the tab still shows the case the
      // user picked, and the two must not disagree. The persistent Host answers this
      // from its own `lastLoadedAbs` mirror; a dynamic Host has no such mirror, so it
      // asks the javaBridge provider, whose caseInfo() answers from the same mirror
      // and never boots the JVM just to reply.
      async getBridgeCase(args) {
        if (javaBridge === undefined || typeof javaBridge.caseInfo !== 'function') {
          return { ok: false, error: 'in-process bridge unavailable (install the persistent InterPSS plugin)' }
        }
        try {
          const parsed = JSON.parse(await javaBridge.caseInfo('ieee', ''))
          if (parsed === null || parsed.ok !== true) return { ok: true, case: '' }
          const value = { ok: true, case: relativeCasePath(parsed.input) }
          if (parsed.busCount !== null && parsed.busCount !== undefined) value.busCount = parsed.busCount
          if (parsed.branchCount !== null && parsed.branchCount !== undefined) value.branchCount = parsed.branchCount
          return value
        } catch (e) {
          return { ok: false, error: 'bridge getBridgeCase failed: ' + (e && e.message ? e.message : String(e)) }
        }
      },

      async runReport(args) {
        const casePath = args && typeof args.input === 'string' ? args.input : ''
        if (casePath.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(casePath)) {
          return { ok: false, error: 'Invalid case path: ' + casePath }
        }

        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }

        const slash = casePath.lastIndexOf('/')
        const parent = slash >= 0 ? casePath.slice(0, slash) : ''
        const stem = casePath.slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
        const resultDir = parent + '/result'

        let displayName = args && typeof args.displayName === 'string' && args.displayName.trim() !== '' ? args.displayName.trim() : stem
        displayName = String(displayName).replace(/[\r\n\t'"]/g, ' ').trim()

        // An explicit `reportType` ("aclf" | "nerc") wins; otherwise NERC when a
        // contingency CSV is present, else the AC Loadflow report.
        const fs = ctx.get('fs')
        const requestedType = args && typeof args.reportType === 'string' ? args.reportType.trim().toLowerCase() : ''
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

        // In-process bridge path (preferred): no JVM spawn, cached network.
        if (javaBridge !== undefined && typeof javaBridge.runReport === 'function') {
          try {
            const raw = await javaBridge.runReport(reportType, displayName, root, resultDir, null)
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
        const shell = ctx.get('shell')
        if (shell === undefined) return { ok: false, error: 'shell service unavailable' }

        const wspace = root + '/wspace'
        const javaCp = root + '/target/classes:' + root + '/lib/ipss_runnable.jar:' + root + '/lib/deps/*'
        const command = shellQuote(javaLauncher()) + ' -cp "' + javaCp + '" org.interpss.agent.IpssCmd report ' + reportType + ' ' + shellQuote(displayName) + ' ' + shellQuote(resultDir)
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
      },

      async getAclfOptions(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        const caseInput = args && typeof args.input === 'string' ? args.input : ''
        const defCfg = root + '/config/aclf_run.json'
        let cfgPath = defCfg
        if (caseInput !== '') {
          const { parent } = caseParts(caseInput)
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
      },

      async saveAclfOptions(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const config = args && args.config && typeof args.config === 'object' ? args.config : null
        if (config === null) return { ok: false, error: 'missing options payload' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        const caseInput = args && typeof args.input === 'string' ? args.input : ''
        if (caseInput === '') return { ok: false, error: 'no case selected' }
        const { parent } = caseParts(caseInput)
        const caseCfg = root + '/wspace/' + wspaceJoin(parent, 'config/aclf_run.json')
        try {
          const target = await fs.resolve(caseCfg)
          await fs.writeText(target, JSON.stringify(config, null, 2) + '\n')
          return { ok: true }
        } catch (e) {
          return { ok: false, error: 'failed to write ' + caseCfg + ': ' + (e && e.message ? e.message : String(e)) }
        }
      },

      // The Diagram tab's gear dialog (0.6.26): read and write the workspace
      // config/net_diagram.json. A read never fails the diagram -- missing or
      // unparseable falls back to the built-in defaults, with a warning the dialog
      // shows. A write merges over what is on disk (unknown keys survive) and always
      // writes a sanitized document.
      async getNetDiagramOptions(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        const cfgPath = netDiagramConfigPath(root)
        const rel = 'config/net_diagram.json'
        try {
          const target = await fs.resolve(cfgPath)
          const text = await fs.readText(target)
          let raw = null
          try {
            raw = JSON.parse(text)
          } catch (e) {
            return { ok: true, config: DEFAULT_NET_DIAGRAM_CONFIG, exists: true, path: rel,
                     warning: rel + ' is not valid JSON; using the built-in defaults' }
          }
          return { ok: true, config: sanitizeNetDiagramConfig(raw), exists: true, path: rel }
        } catch (e) {
          return { ok: true, config: DEFAULT_NET_DIAGRAM_CONFIG, exists: false, path: rel }
        }
      },

      async saveNetDiagramOptions(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const config = args && args.config && typeof args.config === 'object' ? args.config : null
        if (config === null) return { ok: false, error: 'missing options payload' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        const cfgPath = netDiagramConfigPath(root)
        let onDisk = {}
        try {
          const target = await fs.resolve(cfgPath)
          const parsed = JSON.parse(await fs.readText(target))
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) onDisk = parsed
        } catch (e) {
          onDisk = {}
        }
        const merged = sanitizeNetDiagramConfig(Object.assign(onDisk, config))
        try {
          const target = await fs.resolve(cfgPath)
          await fs.writeText(target, JSON.stringify(merged, null, 2) + '\n')
          return { ok: true, config: merged, path: 'config/net_diagram.json' }
        } catch (e) {
          return { ok: false, error: 'failed to write ' + cfgPath + ': ' + (e && e.message ? e.message : String(e)) }
        }
      },

      // Candidate contingency / monitored-branch inputs: every .json beside the
      // case file, with the entry counts the dialog reports after a pick.
      async listCaFiles(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const caseInput = args && typeof args.input === 'string' ? args.input : ''
        if (caseInput === '') return { ok: false, error: 'no case selected' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        const { parent } = caseParts(caseInput)

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
      },

      // The dialog's starting state: the case ca_run.json when it exists and
      // parses, else the discovered defaults with a warning explaining why.
      async getCaOptions(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const caseInput = args && typeof args.input === 'string' ? args.input : ''
        if (caseInput === '') return { ok: false, error: 'no case selected' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        const { parent } = caseParts(caseInput)
        const cfgRel = caConfigRel(parent)
        const suggestion = await suggestCaConfig(root, parent)

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
        const validated = await validateCaConfig(root, parsed, false)
        if (!validated.ok) {
          return { ok: true, config: suggestion, source: 'suggested', path: cfgRel, warning: cfgRel + ': ' + validated.error + ' — showing the discovered defaults' }
        }
        return { ok: true, config: validated.config, source: 'case', path: cfgRel }
      },

      // Persist the dialog's configuration as <case folder>/config/ca_run.json.
      async saveCaOptions(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const caseInput = args && typeof args.input === 'string' ? args.input : ''
        if (caseInput === '') return { ok: false, error: 'no case selected' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        const { parent } = caseParts(caseInput)
        const validated = await validateCaConfig(root, args && args.config, true)
        if (!validated.ok) return { ok: false, error: validated.error }

        const cfgRel = caConfigRel(parent)
        const payload = {
          contingencyMode: validated.config.contingencyMode,
          contingencyFile: validated.config.contingencyFile,
          monitorMode: validated.config.monitorMode,
          monitoredBranchFile: validated.config.monitoredBranchFile,
          // The dialog's over loading threshold. It must round-trip, or the next dialog
          // open and the CLI silently fall back to 90.
          overloadThreshold: validated.config.overloadThreshold,
        }
        try {
          const target = await fs.resolve(caConfigPath(root, parent))
          await fs.writeText(target, JSON.stringify(payload, null, 2) + '\n')
          return { ok: true, path: cfgRel }
        } catch (e) {
          return { ok: false, error: 'failed to write ' + cfgRel + ': ' + (e && e.message ? e.message : String(e)) }
        }
      },
    }

    for (const method of METHODS) {
      ctx.effect(() => harness.handle(NAMESPACE + '/' + method, (args) => handlers[method](args || {})))
    }
  },
}
