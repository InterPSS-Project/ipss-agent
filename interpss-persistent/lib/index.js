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

const NAMESPACE = 'interpss'
const PACKAGE = '@deepseek-ai/dsh-interpss'
const METHODS = ['isActivated', 'checkResult', 'checkResultFiles', 'listCases', 'readCsv', 'busConnections', 'runAclf', 'runReport', 'getAclfOptions', 'saveAclfOptions', 'loadCase', 'summarizeResult']

function jsonParam(name, wire) {
  return { name, wire, source: 'json', codec: { mode: 'src-json' } }
}

function shellQuote(value) {
  return "'" + String(value) + "'"
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

async function ensureBridge(root) {
  if (bridgePromise === null) {
    bridgePromise = (async () => {
      const jb = await import('java-bridge')
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

class InterpssService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, NAMESPACE)
  }

  resolveWorkspaceRoot(sessionId) {
    const ctx = this.ctx
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

  bridge() {
    return this.ctx.get('javaBridge')
  }

  caseParts(caseInput) {
    const slash = caseInput.lastIndexOf('/')
    const parent = slash >= 0 ? caseInput.slice(0, slash) : ''
    const stem = caseInput.slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
    return { parent, stem }
  }

  async resolveAclfConfigPath(root, caseInput) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return root + '/config/aclf_run.json'
    const { parent } = this.caseParts(caseInput)
    const caseCfg = root + '/wspace/' + parent + '/config/aclf_run.json'
    const defCfg = root + '/config/aclf_run.json'
    try {
      const target = await fs.resolve(caseCfg)
      const info = await fs.stat(target)
      if (info !== undefined) return caseCfg
    } catch (e) {}
    return defCfg
  }

  async isActivated(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { activated: false }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
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
  }

  async checkResult(input) {
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
    if (!/^data\/[A-Za-z0-9_.\/-]+\/result\/[A-Za-z0-9_.-]+_DF_(bus|branch|gen|load)\.csv$/.test(path)) {
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
    const command = 'java -cp "' + javaCp + '" org.interpss.agent.IpssCmd aclf ' + format + ' ' + caseInput
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

  async loadCase(input) {
    const format = input && input.format === 'psse' ? 'psse' : 'ieee'
    const caseInput = input && typeof input.input === 'string' ? input.input : ''
    if (caseInput.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(caseInput)) {
      return { ok: false, error: 'Invalid case path: ' + caseInput }
    }
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

  async runReport(input) {
    const shell = this.ctx.get('shell')
    if (shell === undefined) return { ok: false, error: 'shell service unavailable' }

    const casePath = input && typeof input.input === 'string' ? input.input : ''
    if (casePath.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(casePath)) {
      return { ok: false, error: 'Invalid case path: ' + casePath }
    }

    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }

    const python = root + '/.venv/bin/python'
    const wspace = root + '/wspace'
    const slash = casePath.lastIndexOf('/')
    const parent = slash >= 0 ? casePath.slice(0, slash) : ''
    const stem = casePath.slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
    const resultDir = parent + '/result'

    let displayName = input && typeof input.displayName === 'string' && input.displayName.trim() !== '' ? input.displayName.trim() : stem
    displayName = String(displayName).replace(/[\r\n\t'"]/g, ' ').trim()

    const command = python + ' ../src/report/generate_nerc_tpl_report.py ' + shellQuote(displayName) + ' ' + resultDir
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
    const fs = this.ctx.get('fs')
    if (fs !== undefined) {
      try {
        const target = await fs.resolve(wspace + '/' + resultDir + '/NERC_TPL_001_5_Report.md')
        markdown = await fs.readText(target)
      } catch (e) {
        markdown = null
      }
    }

    return { ok: true, markdown: markdown, resultDir: resultDir, input: casePath, displayName: displayName }
  }

  async getAclfOptions(input) {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
    const root = this.resolveWorkspaceRoot(input && input.sessionId)
    if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
    try {
      const target = await fs.resolve(root + '/config/aclf_run.json')
      const text = await fs.readText(target)
      let config = null
      try {
        config = JSON.parse(text)
      } catch (e) {
        return { ok: false, error: 'config/aclf_run.json is not valid JSON' }
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
    try {
      const target = await fs.resolve(root + '/config/aclf_run.json')
      await fs.writeText(target, JSON.stringify(config, null, 2) + '\n')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: 'failed to write config/aclf_run.json: ' + (e && e.message ? e.message : String(e)) }
    }
  }
}

export default {
  // Wait for the `typert` registry before applying: loader entries activate in
  // parallel, and without this dependency `ctx.get('typert')` can still be
  // `undefined` here, silently skipping the Remote registration.
  inject: ['typert'],

  apply(ctx) {
    // Provide the `interpss` service (and its Typert binding) by instantiating
    // the Service. Its registration is owned by this fiber, so it unwinds with
    // the plugin.
    new InterpssService(ctx)

    // Publish the in-process `javaBridge` service (lazy JVM bootstrap). Other
    // host rows — e.g. the dynamic per-session plugin — consume it via
    // `ctx.get('javaBridge')`.
    const sp = ctx.get('sandboxPolicy')
    const bridgeRoot = sp && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot : ''
    if (bridgeRoot !== '') {
      ctx.provide('javaBridge', {
        async loadCase(format, absCase) {
          const bridge = await ensureBridge(bridgeRoot)
          return bridge.loadCase(format, absCase)
        },
        async runAclf(format, absCase, absCfg, absResults, stem) {
          const bridge = await ensureBridge(bridgeRoot)
          return bridge.runAclf(format, absCase, absCfg, absResults, stem)
        },
        async summarize(scope, sortRule, numRec) {
          const bridge = await ensureBridge(bridgeRoot)
          return bridge.summarize(scope, sortRule, numRec)
        },
      })
    }

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
  },
}

