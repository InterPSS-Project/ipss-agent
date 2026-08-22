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
const METHODS = ['isActivated', 'checkResult', 'checkResultFiles', 'listCases', 'readCsv', 'busConnections', 'runAclf', 'runReport', 'getAclfOptions', 'saveAclfOptions']

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

export default {
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

      async readCsv(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const path = args && typeof args.path === 'string' ? args.path : ''
        if (!/^data\/[A-Za-z0-9_.\/-]+\/result\/[A-Za-z0-9_.-]+_DF_(bus|branch|gen|load)\.csv$/.test(path)) {
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
        if (lines.length === 0) return { ok: true, header: '', rows: [], totalRows: 0, hasMore: false }
        const header = lines[0]
        const totalRows = Math.max(0, lines.length - 1)
        const dataStart = 1 + start
        const dataEnd = Math.min(dataStart + limit, lines.length)
        const rows = dataStart < lines.length ? lines.slice(dataStart, dataEnd) : []
        return { ok: true, header: header, rows: rows, totalRows: totalRows, hasMore: dataEnd < lines.length }
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

        const readBusData = async (relPath, keyCol) => {
          try {
            const target = await fs.resolve(wspace + '/' + relPath)
            const txt = await fs.readText(target)
            const ls = String(txt).replace(/\r\n/g, '\n').split('\n')
            while (ls.length > 0 && ls[ls.length - 1].trim() === '') ls.pop()
            if (ls.length === 0) return { header: [], rows: [], count: 0 }
            const hdr = ls[0].split(',')
            const out = []
            for (let i = 1; i < ls.length; i++) {
              if (ls[i].trim() === '') continue
              const cols = ls[i].split(',')
              if (cols[keyCol] === busId) out.push(cols)
            }
            return { header: hdr, rows: out, count: out.length }
          } catch (e) {
            return { header: [], rows: [], count: 0 }
          }
        }

        const gen = await readBusData(path.replace(/_DF_branch\.csv$/, '_DF_gen.csv'), 0)
        const load = await readBusData(path.replace(/_DF_branch\.csv$/, '_DF_load.csv'), 0)

        return {
          ok: true,
          busId: busId,
          header: header,
          rows: rows,
          count: rows.length,
          genHeader: gen.header,
          genRows: gen.rows,
          genCount: gen.count,
          loadHeader: load.header,
          loadRows: load.rows,
          loadCount: load.count,
        }
      },

      async runAclf(args) {
        const shell = ctx.get('shell')
        if (shell === undefined) return { ok: false, error: 'shell service unavailable' }

        const format = args && args.format === 'psse' ? 'psse' : 'ieee'
        const caseInput = args && typeof args.input === 'string' ? args.input : ''
        if (caseInput.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(caseInput)) {
          return { ok: false, error: 'Invalid case path: ' + caseInput }
        }

        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }

        const python = root + '/.venv/bin/python'
        const wspace = root + '/wspace'
        const slash = caseInput.lastIndexOf('/')
        const parent = slash >= 0 ? caseInput.slice(0, slash) : ''
        const stem = caseInput.slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
        const infoRel = parent + '/result/' + stem + '_network_info.txt'

        const command = python + ' ../src/ipss_cmd.py aclf ' + format + ' ' + caseInput
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

      async runReport(args) {
        const shell = ctx.get('shell')
        if (shell === undefined) return { ok: false, error: 'shell service unavailable' }

        const casePath = args && typeof args.input === 'string' ? args.input : ''
        if (casePath.indexOf('..') !== -1 || !/^data\/[A-Za-z0-9_.\/-]+\.(ieee|raw|RAW)$/.test(casePath)) {
          return { ok: false, error: 'Invalid case path: ' + casePath }
        }

        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }

        const python = root + '/.venv/bin/python'
        const wspace = root + '/wspace'
        const slash = casePath.lastIndexOf('/')
        const parent = slash >= 0 ? casePath.slice(0, slash) : ''
        const stem = casePath.slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
        const resultDir = parent + '/result'

        let displayName = args && typeof args.displayName === 'string' && args.displayName.trim() !== '' ? args.displayName.trim() : stem
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
        const fs = ctx.get('fs')
        if (fs !== undefined) {
          try {
            const target = await fs.resolve(wspace + '/' + resultDir + '/NERC_TPL_001_5_Report.md')
            markdown = await fs.readText(target)
          } catch (e) {
            markdown = null
          }
        }

        return { ok: true, markdown: markdown, resultDir: resultDir, input: casePath, displayName: displayName }
      },

      async getAclfOptions(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
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
      },

      async saveAclfOptions(args) {
        const fs = ctx.get('fs')
        if (fs === undefined) return { ok: false, error: 'fs service unavailable' }
        const config = args && args.config && typeof args.config === 'object' ? args.config : null
        if (config === null) return { ok: false, error: 'missing options payload' }
        const root = resolveWorkspaceRoot(args && args.sessionId)
        if (root === '') return { ok: false, error: 'could not resolve the session workspace root' }
        try {
          const target = await fs.resolve(root + '/config/aclf_run.json')
          await fs.writeText(target, JSON.stringify(config, null, 2) + '\n')
          return { ok: true }
        } catch (e) {
          return { ok: false, error: 'failed to write config/aclf_run.json: ' + (e && e.message ? e.message : String(e)) }
        }
      },
    }

    for (const method of METHODS) {
      ctx.effect(() => harness.handle(NAMESPACE + '/' + method, (args) => handlers[method](args || {})))
    }
  },
}
