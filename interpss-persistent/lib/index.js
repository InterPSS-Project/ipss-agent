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

const NAMESPACE = 'interpss'
const PACKAGE = '@deepseek-ai/dsh-interpss'
const METHODS = ['isActivated', 'checkResult', 'checkResultFiles', 'listCases', 'readCsv', 'busConnections', 'runAclf', 'runCa', 'runReport', 'getAclfOptions', 'saveAclfOptions', 'loadCase', 'summarizeResult', 'getNetworkInfo']

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

// Accept a workspace-relative data/… path, an absolute path containing
// /wspace/data/, or an exact preset label.
function resolveCaseArgument(raw) {
  const value = String(raw).trim()
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
    error: 'unrecognized case selector "' + value + '"; expected a data/... case path, an absolute path containing ' +
      WS_DATA_MARKER + ', or a preset label (' + IPSS_PRESETS.map((preset) => preset.label).join(', ') + ')',
  }
}

function relativeCasePath(absPath) {
  const marker = String(absPath).indexOf(WS_DATA_MARKER)
  return marker >= 0 ? 'data/' + String(absPath).slice(marker + WS_DATA_MARKER.length) : String(absPath)
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

// Case-specific aclf_run.json (same folder as the case) wins, then the project
// default config/aclf_run.json. Shared by the `interpss` service and `runAclfTool`.
async function resolveAclfConfigPath(ctx, root, caseInput) {
  const fs = ctx.get('fs')
  if (fs === undefined) return root + '/config/aclf_run.json'
  const { parent } = casePartsOf(caseInput)
  const caseCfg = root + '/wspace/' + parent + '/aclf_run.json'
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

// Update `lastLoadedAbs` from a bridge load result (JSON string, `{ok:true,…}`).
function rememberLoadedCase(raw, absCase) {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && parsed.ok === true && typeof absCase === 'string' && absCase !== '') lastLoadedAbs = absCase
  } catch (e) {}
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
      await jb.ensureJvm({ opts: ['-Xmx4g'] })
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
    if (lines.length === 0) return { ok: true, header: '', rows: [], totalRows: 0, hasMore: false }
    const header = lines[0]
    const totalRows = Math.max(0, lines.length - 1)
    const dataStart = 1 + start
    const dataEnd = Math.min(dataStart + limit, lines.length)
    const rows = dataStart < lines.length ? lines.slice(dataStart, dataEnd) : []
    return { ok: true, header: header, rows: rows, totalRows: totalRows, hasMore: dataEnd < lines.length }
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

    // Discover companion contingency + monitored-branch JSONs in the case dir
    // when present; omit either/both to use N-1 / all-branch defaults in Java.
    const fs = this.ctx.get('fs')
    let contRel = null
    let monRel = null
    if (fs !== undefined) {
      try {
        const dirTarget = await fs.resolve(root + '/wspace/' + parent)
        const entries = await fs.listDir(dirTarget)
        for (const entry of entries) {
          if (entry.type !== 'file' || !/\.json$/i.test(entry.name)) continue
          const lower = entry.name.toLowerCase()
          if (contRel === null && lower.indexOf('contingenc') !== -1) contRel = parent + '/' + entry.name
          if (monRel === null && lower.indexOf('monitor') !== -1) monRel = parent + '/' + entry.name
        }
      } catch (e) {}
    }

    // In-process bridge path (preferred): no JVM spawn, cached network.
    const bridge = this.bridge()
    if (bridge !== undefined && typeof bridge.runContingency === 'function') {
      try {
        const absCase = root + '/wspace/' + caseInput
        const absCont = contRel !== null ? root + '/wspace/' + contRel : null
        const absMon = monRel !== null ? root + '/wspace/' + monRel : null
        const absResults = root + '/wspace/' + resultDir
        const raw = await bridge.runContingency(format, absCase, absCont, absMon, absResults, stem)
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
      const caseCfg = root + '/wspace/' + parent + '/aclf_run.json'
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
    const caseCfg = root + '/wspace/' + parent + '/aclf_run.json'
    try {
      const target = await fs.resolve(caseCfg)
      await fs.writeText(target, JSON.stringify(config, null, 2) + '\n')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: 'failed to write ' + caseCfg + ': ' + (e && e.message ? e.message : String(e)) }
    }
  }
}

// --- Chat tool: interpss_network_info ---------------------------------------
// Model-facing Tool over the embedded bridge. Registered once on the host tool
// registry; per-call it resolves the target case (argument → tab selection →
// case held by the bridge) and is gated on the iPSS Agent workspace.
function networkInfoTool(ctx) {
  return {
    name: 'interpss_network_info',
    description:
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
            "Optional case selector: a workspace-relative path such as 'data/ieee/Ieee14Bus/ieee14.ieee', " +
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
      'Run an InterPSS AC load flow (ACLF) on a power-system simulation case and report convergence plus ' +
      'the resulting network information. Writes <case>_DF_bus.csv, <case>_DF_branch.csv, <case>_DF_gen.csv, ' +
      '<case>_DF_load.csv and <case>_network_info.txt under wspace/<case dir>/result/. The case comes from ' +
      'the `case` argument when given, otherwise from the case selected in the InterPSS tab, otherwise from ' +
      'the case the bridge already holds. Solver options come from the case folder aclf_run.json when ' +
      'present, otherwise config/aclf_run.json. Large cases can take minutes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        case: {
          type: 'string',
          description:
            "Optional case selector: a workspace-relative path such as 'data/ieee/Ieee14Bus/ieee14.ieee', " +
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
            if (parsed.ok === true) lastLoadedAbs = absCase
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
        const bus = /Number of Active Buses:\s*(\d+)/.exec(text)
        const branch = /Number of Active Branches:\s*(\d+)/.exec(text)
        return JSON.stringify({
          ok: true,
          input: target,
          reused: reused,
          busCount: bus ? Number(bus[1]) : null,
          branchCount: branch ? Number(branch[1]) : null,
          lfConverged: /Loadflow converged:\s*true/i.test(text),
          networkInfo: text,
        })
      },
      async runReport(reportType, displayName, projectRoot, resultDirRelative, csvPrefix) {
        const bridge = await ensureBridge(projectRoot || rootFor(''))
        return bridge.runReport(reportType, displayName, projectRoot, resultDirRelative, csvPrefix)
      },
      async runContingency(format, absCase, absCont, absMon, absResults, stem) {
        const bridge = await ensureBridge(rootFor(absCase))
        const cap = captureStdio()
        let raw
        try {
          raw = await bridge.runContingency(format, absCase, absCont, absMon, absResults, stem)
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
      const chatToolDefs = [networkInfoTool(ctx), runAclfTool(ctx)]
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

