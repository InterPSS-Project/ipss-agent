// InterPSS persistent dual-face plugin — Client half (browser bundle).
//
// This is the browser half of `@deepseek-ai/dsh-interpss`, served at
// /plugins/@deepseek-ai/dsh-interpss/client.js. It registers the InterPSS tab
// in the `conversation.view` slot (between Chat and Trajectory) and calls the
// Host half through the `/api` RPC endpoints `interpss/<method>`.
//
// Rebuilt from interpss-dynamic/client-body.js: identical UI/behavior to the
// dynamic plugin (Load button, case/action rows, CA button + contingency CSV
// viewer, network-info panel, report dialog), with the persistent transport
// (connection.rpc.call over the /api Typert gateway) substituted for the
// dynamic host.call bridge.

window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-interpss",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
module.exports = {
  inject: ['slots'],
  apply(ctx) {
    const callRemote = (method, input) => {
      const connection = ctx.get('connection')
      if (connection === undefined) return Promise.reject(new Error('InterPSS: client connection service unavailable'))
      return connection.rpc.call('/api', 'interpss/' + method, { args: { input: input } }).then((result) => {
        if (result && result.ok) return result.value
        const message = (result && result.error && result.error.message) ? result.error.message : 'remote call failed'
        return Promise.reject(new Error(message))
      })
    }
    const PRESETS = [
      { label: 'IEEE 118-bus', format: 'ieee', input: 'data/ieee/Ieee118Bus/ieee118.ieee' },
      { label: 'IEEE 14-bus', format: 'ieee', input: 'data/ieee/Ieee14Bus/ieee14.ieee' },
      { label: 'Texas 2K-bus', format: 'psse', input: 'data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW' },
    ]

    let lastSelection = { mode: '0', customFormat: 'ieee', customInput: '' }
    let checkSeq = 0
    let reportSeq = 0
    // The bridge-held case this tab has already mirrored into its picker. A chat tool
    // can load another case while the tab shows one the user picked, so the picker
    // follows the bridge — but only when the bridge case *changes*, which leaves a
    // deliberate, not-yet-loaded picker choice alone.
    let bridgeCaseSeen = ''

    // Which picker state shows a case path: a preset index, or the custom-path row
    // (PSS/E for .raw, IEEE CDF otherwise). Pure, so the sync effect stays a one-liner.
    function bridgeCaseSelection(input) {
      const index = PRESETS.findIndex((p) => p.input === input)
      if (index >= 0) {
        return { mode: String(index), customInput: '', customFormat: PRESETS[index].format }
      }
      return {
        mode: 'custom',
        customInput: input,
        customFormat: /\.raw$/i.test(input) ? 'psse' : 'ieee',
      }
    }

    // Editable fields of the AC Loadflow Option dialog, keyed by the real
    // config/aclf_run.json property names. The value's JS type drives the form
    // control: boolean -> checkbox, number -> numeric input, string -> select.
    const OPT_DEFAULTS = {
      lfMethod: 'NR',
      polarCoordinate: true,
      tolerance: 1.0e-4,
      tolUnitType: 'PU',
      maxIterations: 20,
      nonDivergent: true,
      busLoadLowVoltAdj: true,
      vConstPMin: 0.7,
      vConstIMin: 0.5,
      checkGenQLimImmediate: false,
      autoSetZeroZBranch: true,
      turnOffIslandBus: true,
      autoTurnLine2Xfr: true,
      includeAdjustments: true,
      applyLimitControl: true,
      pvBusLimitControl: true,
      pqBusLimitControl: true,
      limitBackoffCheck: false,
      applyVoltAdjust: true,
      remoteQBusControl: true,
      switchedShuntAdjust: true,
      svcFactsAdjust: true,
      xfrTapControl: true,
      hvdcTapControl: true,
      applyDiscreteAdjust: true,
      applyPowerAdjust: true,
      psXfrPControl: true,
      optAlgo: 'CUBIC_EQN',
      variableUpdateLimit: false,
      deltaVAngLimit: 0.2,
      deltaVMagLimit: 0.1,
      stopNoSolutionFound: false,
      minScaleFactor: 0.01,
      limitCtrlStartPoint: 10,
      limitCtrlApplyType: 'DURING_ITERATION',
      limitCtrlTolearnceFactor: 10.0,
      voltAdjStartPoint: 10,
      voltAdjApplyType: 'DURING_ITERATION',
      voltAdjTolearnce: 0.005,
      dQ_dVThreshold: 1.0,
      powerAdjStartPoint: 10,
      powerAdjApplyType: 'POST_ITERATION',
      powerAdjTolearnceFactor: 10.0,
      pvLimitAccFactor: 1.0,
      reQBusAccFactor: 1.0,
      xfrTapAccFactor: 1.0,
      pqLimitAccFactor: 1.0,
      svcAccFactor: 1.0,
      psXfrPContrlAccFactor: 1.0,
    }

    const OPT_INT_KEYS = ['maxIterations', 'limitCtrlStartPoint', 'voltAdjStartPoint', 'powerAdjStartPoint']

    function buildOptForm(config) {
      const f = {}
      for (const k in OPT_DEFAULTS) {
        const d = OPT_DEFAULTS[k]
        const v = config ? config[k] : undefined
        if (typeof d === 'boolean') f[k] = v != null ? !!v : d
        else if (typeof d === 'number') f[k] = String(v != null && v !== '' ? v : d)
        else f[k] = (v != null && v !== '') ? v : d
      }
      if (f.tolUnitType === 'mVA') f.tolUnitType = 'MVA'
      // desktop-style scientific notation for the convergence tolerance
      if (f.tolerance !== '') {
        const t = parseFloat(f.tolerance)
        if (!isNaN(t)) f.tolerance = t.toExponential(1).toUpperCase()
      }
      return f
    }

    function configFromForm(form) {
      const next = {}
      for (const k in OPT_DEFAULTS) {
        const d = OPT_DEFAULTS[k]
        if (typeof d === 'boolean') next[k] = !!form[k]
        else if (typeof d === 'number') next[k] = OPT_INT_KEYS.indexOf(k) !== -1 ? Math.round(parseFloat(form[k])) : parseFloat(form[k])
        else next[k] = form[k]
      }
      if (next.tolUnitType === 'MVA') next.tolUnitType = 'mVA'
      return next
    }

    const mono = {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '12px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      margin: 0,
    }
    const panel = {
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: '8px',
      padding: '12px',
      marginTop: '12px',
      background: 'var(--dsw-alias-bg-layer-1)',
      overflowY: 'auto',
    }
    const btn = {
      padding: '0 14px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer',
      height: '34px',
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }
    const searchIcon = React.createElement('svg',
      { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      React.createElement('circle', { cx: 11, cy: 11, r: 8 }),
      React.createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }),
    )
    const gearIcon = React.createElement('svg',
      { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
      React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
      React.createElement('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }),
    )
    const thStyle = { position: 'sticky', top: 0, zIndex: 1, padding: '4px 8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-overlay)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }
    const tdStyle = { padding: '3px 8px', border: '1px solid var(--dsw-alias-border-l1)', whiteSpace: 'nowrap' }
    const tableStyle = { borderCollapse: 'collapse', fontSize: '12px', marginTop: '8px', width: '100%' }

    function formatValue(v, decimals) {
      const d = decimals != null ? decimals : 4
      const s = v == null ? '' : String(v)
      const t = s.trim()
      if (t === '') return s
      // only touch plain-decimal or scientific numeric strings (e.g. -0.51, 3.4E-4)
      if (!/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return s
      const mantissa = t.split(/[eE]/)[0]
      const dot = mantissa.indexOf('.')
      if (dot === -1) return s
      if (mantissa.length - dot - 1 <= d) return s
      const n = Number(t)
      if (!Number.isFinite(n)) return s
      return String(parseFloat(n.toFixed(d)))
    }

    function fmt(v, d) {
      const n = Number(v)
      if (!Number.isFinite(n)) return v == null ? '' : String(v)
      return n.toFixed(d)
    }

    function busTooltip(rec) {
      if (!rec) return 'Bus info'
      const lines = []
      lines.push('Bus Name: ' + (rec.name || ''))
      lines.push('BaseVolt: ' + fmt(rec.baseKV, 2))
      lines.push('Status: ' + (rec.status || ''))
      lines.push('')
      lines.push('Voltage (pu): ' + fmt(rec.voltMag, 4))
      lines.push('Angle (degrees): ' + fmt(rec.voltAng, 2))
      if (rec.genCount > 0) {
        lines.push('')
        lines.push('Bus GenCode: ' + (rec.genCode || ''))
        lines.push('Number of generators: ' + rec.genCount)
        lines.push('Gen ID: ' + (rec.genIds || []).join(', '))
      }
      if (rec.loadCount > 0) {
        lines.push('')
        lines.push('Bus LoadCode: ' + (rec.loadCode || ''))
        lines.push('Number of loads: ' + rec.loadCount)
        lines.push('Load ID: ' + (rec.loadIds || []).join(', '))
      }
      lines.push('')
      lines.push('Total Gen P (pu): ' + fmt(rec.totalGenP, 2))
      lines.push('Total Gen Q (pu): ' + fmt(rec.totalGenQ, 4))
      return lines.join('\n')
    }

    function fmt4(v) {
      const n = Number(v)
      if (!Number.isFinite(n)) return v == null ? '' : String(v)
      return String(parseFloat(n.toFixed(4)))
    }

    function pqText(p, q) {
      const pn = Number(p)
      const qn = Number(q)
      const pf = Number.isFinite(pn) ? String(parseFloat(pn.toFixed(4))) : String(p == null ? '' : p)
      const qf = Number.isFinite(qn) ? String(parseFloat(Math.abs(qn).toFixed(4))) : String(q == null ? '' : q)
      const sign = (Number.isFinite(qn) && qn < 0) ? ' - j' : ' + j'
      return pf + sign + qf
    }

    function branchTooltip(r) {
      if (!r) return 'Branch info'
      const isXfmr = r[12] === 'true'
      const lines = []
      lines.push('Branch ID: ' + (r[0] || ''))
      lines.push('Branch Type: ' + (isXfmr ? 'Transformer' : 'Line'))
      lines.push('Circuit: ' + (r[2] || ''))
      lines.push('Status: ' + (r[3] || ''))
      lines.push('')
      lines.push('From Bus: ' + (r[4] || '') + ' (' + (r[6] || '') + ')')
      lines.push('To Bus: ' + (r[7] || '') + ' (' + (r[9] || '') + ')')
      lines.push('')
      lines.push('Power From->To: ' + pqText(r[19], r[20]))
      lines.push('Power To->From: ' + pqText(r[21], r[22]))
      return lines.join('\n')
    }

    // A sortable header cell. Clicking hands the column name to the caller, which re-reads
    // the file through `readCsv` with that sort — the Host sorts the whole file before
    // slicing a page, so paging follows the order. The active column carries its direction.
    function csvHeaderCell(h, key, sort) {
      const label = String(h).trim()
      const column = sort !== null && sort !== undefined && typeof sort.column === 'string' ? sort.column : null
      const active = column !== null && column.toLowerCase() === label.toLowerCase()
      const onSort = sort !== null && sort !== undefined && typeof sort.onSort === 'function' ? sort.onSort : null
      return React.createElement('th', {
        key: key,
        onClick: onSort === null ? undefined : () => onSort(label),
        title: onSort === null ? undefined : 'Sort by ' + label,
        style: onSort === null ? thStyle : { ...thStyle, cursor: 'pointer', userSelect: 'none' },
      }, h + (active ? (sort.desc === true ? ' \u25bc' : ' \u25b2') : ''))
    }

    function renderCsvTable(header, rows, busCols, onBusDoubleClick, formatDecimals, sort) {
      if (!header) return null
      const headerCols = header.split(',')
      const isBusCol = (ci) => busCols && onBusDoubleClick && busCols.indexOf(ci) !== -1
      return React.createElement('table', { style: tableStyle },
        React.createElement('thead', null,
          React.createElement('tr', null, headerCols.map((h, i) => csvHeaderCell(h, i, sort))),
        ),
        React.createElement('tbody', null,
          (rows || []).map((r, ri) => React.createElement('tr', { key: ri }, r.split(',').map((c, ci) => {
            const display = formatDecimals != null ? formatValue(c, formatDecimals) : c
            if (isBusCol(ci)) {
              return React.createElement('td', {
                key: ci,
                style: { ...tdStyle, cursor: 'pointer', color: 'var(--dsw-alias-brand-primary)', textDecoration: 'underline' },
                title: 'Double-click to select bus',
                onDoubleClick: () => onBusDoubleClick(c),
              }, display)
            }
            return React.createElement('td', { key: ci, style: tdStyle }, display)
          }))),
        ),
      )
    }

    function renderBusTable(header, rows, selectedBus, onSelect, onContextMenu, sort) {
      if (!header) return null
      const headerCols = header.split(',')
      return React.createElement('table', { style: tableStyle },
        React.createElement('thead', null,
          React.createElement('tr', null, headerCols.map((h, i) => csvHeaderCell(h, i, sort))),
        ),
        React.createElement('tbody', null,
          (rows || []).map((r, ri) => {
            const cols = r.split(',')
            const id = cols[0]
            const isSel = selectedBus !== null && selectedBus === id
            return React.createElement('tr', {
              key: ri,
              onContextMenu: onContextMenu ? (e) => onContextMenu(e, id) : undefined,
              style: { cursor: 'context-menu', ...(isSel ? { background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)' } : null) },
            },
              cols.map((c, ci) => {
                if (ci === 0) {
                  return React.createElement('td', { key: ci, style: tdStyle },
                    React.createElement('button', {
                      onClick: () => onSelect(id),
                      style: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--dsw-alias-brand-primary)', textDecoration: 'underline', font: 'inherit', fontWeight: 600 },
                    }, c),
                  )
                }
                return React.createElement('td', { key: ci, style: tdStyle }, formatValue(c))
              }),
            )
          }),
        ),
      )
    }

    function renderConnTable(header, rows, idx) {
      const cols = idx || [4, 6, 7, 9, 11, 12, 13, 14, 19, 20, 24]
      const hdr = cols.map((i) => (header && header[i] != null ? header[i] : ''))
      return React.createElement('table', { style: tableStyle },
        React.createElement('thead', null,
          React.createElement('tr', null, hdr.map((h, i) => React.createElement('th', { key: i, style: thStyle }, h))),
        ),
        React.createElement('tbody', null,
          (rows || []).map((r, ri) => React.createElement('tr', { key: ri },
            cols.map((i) => React.createElement('td', { key: i, style: tdStyle }, r[i] != null ? r[i] : '')),
          )),
        ),
      )
    }

    function renderConnDiagram(busId, rows, busRecords, onBusDoubleClick, showTip, moveTip, hideTip) {
      const rowsArr = rows || []
      const recById = {}
      for (const r of (busRecords || [])) recById[r.id] = r
      const map = new Map()
      for (const r of rowsArr) {
        const from = r[4]
        const to = r[7]
        const other = from === busId ? to : from
        if (!other) continue
        if (!map.has(other)) map.set(other, [])
        map.get(other).push(r)
      }
      const ids = Array.from(map.keys())
      const N = ids.length
      const W = 640
      const H = 440
      const cx = W / 2
      const cy = H / 2
      const R = N <= 1 ? 130 : Math.min(W, H) / 2 - 90
      const nodeR = 14

      function pos(i) {
        const angle = N <= 1 ? 0 : (2 * Math.PI * i) / N - Math.PI / 2
        return { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) }
      }

      const edgeEls = []
      const labelEls = []
      const nodeEls = []

      ids.forEach((id, i) => {
        const p = pos(i)
        const branches = map.get(id)
        const isXfmr = branches.some((b) => b[12] === 'true')
        const tipProps = showTip ? {
          onMouseEnter: (e) => showTip(branchTooltip(branches[0]), e),
          onMouseMove: moveTip,
          onMouseLeave: hideTip,
        } : {}
        const dx = p.x - cx
        const dy = p.y - cy
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ux = dx / len
        const uy = dy / len
        const mx = (cx + p.x) / 2
        const my = (cy + p.y) / 2
        // Stop the branch line at the neighbor bus rim so the bus node sits on
        // top (in front) of the line rather than letting the line cross under it.
        const nx = p.x - nodeR * ux
        const ny = p.y - nodeR * uy
        if (isXfmr) {
          // Transformer symbol: two overlapping circles on the branch line.
          const tr = 5
          const co = 3.5
          const c1x = mx - co * ux
          const c1y = my - co * uy
          const c2x = mx + co * ux
          const c2y = my + co * uy
          const gsx = mx - (co + tr) * ux
          const gsy = my - (co + tr) * uy
          const gex = mx + (co + tr) * ux
          const gey = my + (co + tr) * uy
          edgeEls.push(React.createElement('line', { key: 'e' + i, x1: cx, y1: cy, x2: gsx, y2: gsy, stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1, ...tipProps }))
          edgeEls.push(React.createElement('line', { key: 'e' + i + 'b', x1: gex, y1: gey, x2: nx, y2: ny, stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1, ...tipProps }))
          labelEls.push(React.createElement('circle', { key: 'x1' + i, cx: c1x, cy: c1y, r: tr, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-label-primary)', strokeWidth: 1, ...tipProps }))
          labelEls.push(React.createElement('circle', { key: 'x2' + i, cx: c2x, cy: c2y, r: tr, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'var(--dsw-alias-label-primary)', strokeWidth: 1, ...tipProps }))
        } else {
          edgeEls.push(React.createElement('line', { key: 'e' + i, x1: cx, y1: cy, x2: nx, y2: ny, stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1, ...tipProps }))
        }
      })

      const centerTip = showTip ? {
        onMouseEnter: (e) => showTip(busTooltip(recById[busId]), e),
        onMouseMove: moveTip,
        onMouseLeave: hideTip,
      } : {}
      nodeEls.push(React.createElement('g', { key: 'c', ...centerTip },
        React.createElement('circle', { cx: cx, cy: cy, r: nodeR + 4, fill: 'var(--dsw-alias-brand-primary)', stroke: 'var(--dsw-alias-bg-overlay)', strokeWidth: 1 }),
        React.createElement('text', { x: cx, y: cy, fill: 'var(--dsw-alias-bg-base)', fontSize: 7, fontWeight: 700, textAnchor: 'middle', dy: '0.35em' }, busId),
      ))

      ids.forEach((id, i) => {
        const p = pos(i)
        const neighborProps = onBusDoubleClick ? {
          style: { cursor: 'pointer' },
          onDoubleClick: () => onBusDoubleClick(id),
        } : {}
        const tipProps = showTip ? {
          onMouseEnter: (e) => showTip(busTooltip(recById[id]), e),
          onMouseMove: moveTip,
          onMouseLeave: hideTip,
        } : {}
        nodeEls.push(React.createElement('g', { key: 'n' + i, ...neighborProps, ...tipProps },
          React.createElement('circle', { cx: p.x, cy: p.y, r: nodeR, fill: 'var(--dsw-alias-bg-layer-2)', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1 }),
          React.createElement('text', { x: p.x, y: p.y, fill: 'var(--dsw-alias-label-primary)', fontSize: 7, textAnchor: 'middle', dy: '0.35em' }, id),
        ))
      })

      return React.createElement('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + H, style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)', marginBottom: '8px' } },
        edgeEls,
        labelEls,
        nodeEls,
      )
    }

    const codeStyle = {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '12px',
      background: 'var(--dsw-alias-bg-layer-2)',
      padding: '1px 5px',
      borderRadius: '4px',
    }

    function renderInline(text) {
      const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
      return parts.map((part, i) => {
        if (part.indexOf('**') === 0 && part.lastIndexOf('**') === part.length - 2 && part.length > 4) {
          return React.createElement('strong', { key: i }, part.slice(2, -2))
        }
        if (part.indexOf('`') === 0 && part.lastIndexOf('`') === part.length - 1 && part.length > 2) {
          return React.createElement('code', { key: i, style: codeStyle }, part.slice(1, -1))
        }
        return part
      })
    }

    function renderMarkdownTable(rows) {
      const parse = (r) => String(r).replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim())
      const header = parse(rows[0])
      const body = rows.slice(2)
      return React.createElement('table', { style: tableStyle },
        React.createElement('thead', null,
          React.createElement('tr', null, header.map((h, i) => React.createElement('th', { key: i, style: thStyle }, renderInline(h)))),
        ),
        React.createElement('tbody', null,
          body.map((r, ri) => React.createElement('tr', { key: ri },
            parse(r).map((c, ci) => React.createElement('td', { key: ci, style: tdStyle }, renderInline(c))),
          )),
        ),
      )
    }

    function isBlockStart(line) {
      return /^(#{1,6}\s|```|[-*+]\s|\d+\.\s|\||>\s)/.test(line) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    }

    function renderMarkdown(text) {
      const lines = String(text).replace(/\r\n/g, '\n').split('\n')
      const blocks = []
      let i = 0
      while (i < lines.length) {
        const line = lines[i]
        if (line.trim() === '') { i++; continue }

        if (/^```/.test(line)) {
          const buf = []
          i++
          while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
          if (i < lines.length) i++
          blocks.push(React.createElement('pre', { key: 'b' + blocks.length, style: { ...mono, ...panel, marginTop: 0, maxHeight: 'none', overflowX: 'auto' } },
            React.createElement('code', null, buf.join('\n'))))
          continue
        }

        const h = /^(#{1,6})\s+(.*)$/.exec(line)
        if (h) {
          const level = h[1].length
          const tag = 'h' + level
          blocks.push(React.createElement(tag, { key: 'b' + blocks.length, style: { margin: level <= 2 ? '18px 0 8px' : '14px 0 6px', fontWeight: level <= 2 ? 700 : 600 } }, renderInline(h[2])))
          i++
          continue
        }

        if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          blocks.push(React.createElement('hr', { key: 'b' + blocks.length, style: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1)', margin: '16px 0' } }))
          i++
          continue
        }

        if (line.indexOf('|') === 0) {
          const rows = []
          while (i < lines.length && lines[i].indexOf('|') === 0) { rows.push(lines[i]); i++ }
          blocks.push(React.createElement('div', { key: 'b' + blocks.length, style: { overflowX: 'auto' } }, renderMarkdownTable(rows)))
          continue
        }

        if (line.indexOf('>') === 0) {
          const inner = []
          while (i < lines.length && lines[i].indexOf('>') === 0) {
            inner.push(lines[i].replace(/^>\s?/, ''))
            i++
          }
          blocks.push(React.createElement('blockquote', { key: 'b' + blocks.length, style: { borderLeft: '3px solid var(--dsw-alias-border-l1)', paddingLeft: '12px', margin: '10px 0', color: 'var(--dsw-alias-label-secondary)' } },
            renderMarkdown(inner.join('\n'))))
          continue
        }

        if (/^[-*+]\s+/.test(line)) {
          const items = []
          while (i < lines.length && /^[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*+]\s+/, '')); i++ }
          blocks.push(React.createElement('ul', { key: 'b' + blocks.length, style: { margin: '8px 0', paddingLeft: '22px' } },
            items.map((it, k) => React.createElement('li', { key: k, style: { margin: '3px 0' } }, renderInline(it)))))
          continue
        }

        if (/^\d+\.\s+/.test(line)) {
          const items = []
          while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++ }
          blocks.push(React.createElement('ol', { key: 'b' + blocks.length, style: { margin: '8px 0', paddingLeft: '22px' } },
            items.map((it, k) => React.createElement('li', { key: k, style: { margin: '3px 0' } }, renderInline(it)))))
          continue
        }

        const buf = [line]
        i++
        while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) { buf.push(lines[i]); i++ }
        blocks.push(React.createElement('p', { key: 'b' + blocks.length, style: { margin: '8px 0' } }, renderInline(buf.join(' '))))
      }
      return blocks
    }

    function InterPssView(props) {
      const sessionId = props && props.sessionId
      const callRemote = props && props.callRemote
      const [activated, setActivated] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        callRemote('isActivated', { sessionId }).then(
          (res) => { if (alive) setActivated(!!(res && res.activated)) },
          () => { if (alive) setActivated(false) },
        )
        return () => { alive = false }
      }, [])

      React.useEffect(() => {
        const initialMode = lastSelection.mode
        let input = ''
        if (initialMode === 'custom') {
          input = lastSelection.customInput.trim()
        } else {
          const p = PRESETS[Number(initialMode)]
          input = p ? p.input : ''
        }
        onCaseChanged(input)
      }, [])

      // Mirror the case the Host holds into the picker. A chat call to
      // interpss_case_load (or any tool that loads one) switches the model, and the tab
      // must not keep showing another case as "the current simulation case". Polled
      // because the Host cannot push into this view; `getBridgeCase` answers from the
      // Host's mirror, so it never starts the JVM and costs nothing.
      React.useEffect(() => {
        let alive = true
        // Switching between the Chat view and this tab unmounts and remounts the view,
        // which drops `caseLoaded`/`caseLoadedInfo`. The first answer therefore always
        // restores the confirmation when the picker already points at the loaded case —
        // otherwise the "✓ Loaded: …" line would vanish every time the user comes back.
        let first = true
        const sync = () => {
          callRemote('getBridgeCase', { sessionId }).then(
            (res) => {
              if (!alive || res === null || res === undefined || res.ok !== true) return
              const input = typeof res.case === 'string' ? res.case : ''
              if (input === '') return
              if (first) {
                first = false
                if (input === selectionInput()) {
                  bridgeCaseSeen = input
                  showLoaded(input, res)
                  return
                }
                // A different case: follow it only when this view has not already shown
                // it, so a deliberate pick the user has not loaded yet survives a switch.
                if (input === bridgeCaseSeen) return
                bridgeCaseSeen = input
                adoptBridgeCase(input, res)
                return
              }
              if (input === bridgeCaseSeen) return
              bridgeCaseSeen = input
              if (input === selectionInput()) {
                // Same case, but a Host load may still have published fresh counts: show
                // the confirmation rather than leaving the picker silent.
                showLoaded(input, res)
                return
              }
              adoptBridgeCase(input, res)
            },
            () => {},
          )
        }
        sync()
        const timer = setInterval(sync, 4000)
        const onFocus = () => sync()
        window.addEventListener('focus', onFocus)
        return () => {
          alive = false
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [])

      // The case the picker currently points at, read from the module-level selection
      // so the effect's closure never sees stale component state.
      function selectionInput() {
        if (lastSelection.mode === 'custom') return lastSelection.customInput.trim()
        const p = PRESETS[Number(lastSelection.mode)]
        return p ? p.input : ''
      }

      // Show a Host-loaded case: select its preset when one matches, otherwise the
      // custom-path row, and let onCaseChanged record the selection Host-side (which is
      // also what makes the next no-argument tool call resolve to this case).
      function adoptBridgeCase(input, info) {
        const selection = bridgeCaseSelection(input)
        lastSelection.mode = selection.mode
        lastSelection.customInput = selection.customInput === '' ? lastSelection.customInput : selection.customInput
        lastSelection.customFormat = selection.customFormat
        setMode(selection.mode)
        setCustomFormat(selection.customFormat)
        if (selection.mode === 'custom') setCustomInput(input)
        onCaseChanged(input)
        showLoaded(input, info)
      }

      // The tab's own Load button prints "✓ Loaded: N buses, M branches" and fills the
      // network-info panel. A load driven from chat must look the same, so mirror both
      // here — after onCaseChanged(), which clears these states.
      function showLoaded(input, info) {
        const counts = info === null || info === undefined ? {} : info
        setCaseLoading(false)
        setCaseLoadError(null)
        setCaseLoaded(true)
        setCaseLoadedInfo((counts.busCount != null ? counts.busCount : '?') + ' buses, ' +
          (counts.branchCount != null ? counts.branchCount : '?') + ' branches')
        callRemote('getNetworkInfo', { sessionId }).then(
          (res) => { if (res && res.ok && res.networkInfo) setCaseNetworkInfo(res.networkInfo) },
          () => {},
        )
      }

      const [mode, setMode] = React.useState(lastSelection.mode)
      const [customFormat, setCustomFormat] = React.useState(lastSelection.customFormat)
      const [customInput, setCustomInput] = React.useState(lastSelection.customInput)
      const [running, setRunning] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [showRaw, setShowRaw] = React.useState(false)
      const [cases, setCases] = React.useState(null)
      const [pickerOpen, setPickerOpen] = React.useState(false)
      const [loadingCases, setLoadingCases] = React.useState(false)
      const [csvSel, setCsvSel] = React.useState(null)
      // Sort of the open result table; the Contingency table opens worst-loading-first,
      // the DF tables open in file order. The Host applies it, so it survives paging.
      const [csvSort, setCsvSort] = React.useState({ column: null, desc: false })
      const [csvHeader, setCsvHeader] = React.useState(null)
      const [csvRows, setCsvRows] = React.useState([])
      const [csvTotal, setCsvTotal] = React.useState(0)
      const [csvHasMore, setCsvHasMore] = React.useState(false)
      const [csvLoading, setCsvLoading] = React.useState(false)
      const [csvLoadingMore, setCsvLoadingMore] = React.useState(false)
      const [csvError, setCsvError] = React.useState(null)
      const [selectedBus, setSelectedBus] = React.useState(null)
      const [connOpen, setConnOpen] = React.useState(false)
      const [connResult, setConnResult] = React.useState(null)
      const [connLoading, setConnLoading] = React.useState(false)
      const [connView, setConnView] = React.useState('diagram')
      const [diagramTip, setDiagramTip] = React.useState(null)
      const [ctxMenu, setCtxMenu] = React.useState(null)
      const [optOpen, setOptOpen] = React.useState(false)
      const [optTab, setOptTab] = React.useState('main')
      const [optLoading, setOptLoading] = React.useState(false)
      const [optConfig, setOptConfig] = React.useState(null)
      const [optForm, setOptForm] = React.useState(null)
      const [optSaving, setOptSaving] = React.useState(false)
      const [optError, setOptError] = React.useState(null)
      const [optSaved, setOptSaved] = React.useState(false)
      const [reportOpen, setReportOpen] = React.useState(false)
      const [reportLoading, setReportLoading] = React.useState(false)
      const [reportError, setReportError] = React.useState(null)
      const [reportMarkdown, setReportMarkdown] = React.useState(null)
      const [reportName, setReportName] = React.useState(null)
      const [reportType, setReportType] = React.useState('nerc')
      const [reportView, setReportView] = React.useState('rendered')
      const [reportAvailable, setReportAvailable] = React.useState(false)
      const [caseLoaded, setCaseLoaded] = React.useState(false)
      const [caseLoading, setCaseLoading] = React.useState(false)
      const [caseLoadError, setCaseLoadError] = React.useState(null)
      const [caseLoadedInfo, setCaseLoadedInfo] = React.useState(null)
      const [caseNetworkInfo, setCaseNetworkInfo] = React.useState(null)
      const [caRunning, setCaRunning] = React.useState(false)
      const [caError, setCaError] = React.useState(null)
      const [caResult, setCaResult] = React.useState(null)
      const [caOpen, setCaOpen] = React.useState(false)
      const [caLoading, setCaLoading] = React.useState(false)
      const [caForm, setCaForm] = React.useState(null)
      const [caFiles, setCaFiles] = React.useState(null)
      const [caFilesLoading, setCaFilesLoading] = React.useState(false)
      const [caPicker, setCaPicker] = React.useState(null)
      const [caSaving, setCaSaving] = React.useState(false)
      const [caDialogError, setCaDialogError] = React.useState(null)
      const [caWarning, setCaWarning] = React.useState(null)
      const [caCase, setCaCase] = React.useState(null)
      const [infoTab, setInfoTab] = React.useState('network')

      const isCustom = mode === 'custom'

      function clearResults() {
        setResult(null)
        setShowRaw(false)
        setCsvSel(null)
        setCsvHeader(null)
        setCsvRows([])
        setCsvTotal(0)
        setCsvHasMore(false)
        setCsvLoading(false)
        setCsvLoadingMore(false)
        setCsvError(null)
        setSelectedBus(null)
        setConnOpen(false)
        setConnResult(null)
        reportSeq++
        setReportAvailable(false)
        setReportOpen(false)
        setReportError(null)
        setReportMarkdown(null)
        setReportName(null)
        setReportView('rendered')
      }

      function onCaseChanged(input) {
        const seq = ++checkSeq
        clearResults()
        setCaseLoaded(false)
        setCaseLoadError(null)
        setCaseLoadedInfo(null)
        setCaseNetworkInfo(null)
        setCaRunning(false)
        setCaError(null)
        setCaResult(null)
        setInfoTab('network')
        if (input === '') return
        callRemote('checkResult', { input, sessionId }).then(
          (res) => {
            if (seq !== checkSeq) return
            if (res && res.ok && res.exists && res.converged) {
              setResult({
                ok: true,
                loaded: true,
                networkInfo: null,
                input: input,
                resultDir: res.resultDir,
                files: res.files,
              })
            }
          },
          () => {},
        )
        callRemote('checkResultFiles', { input, sessionId }).then(
          (res) => { if (seq !== checkSeq) return; setReportAvailable(!!(res && res.ok && res.available)) },
          () => {},
        )
      }

      function resolveCase() {
        if (isCustom) {
          const input = customInput.trim()
          const slash = input.lastIndexOf('/')
          const base = slash >= 0 ? input.slice(slash + 1) : input
          const displayName = base.replace(/\.(ieee|raw|RAW)$/, '')
          return { format: customFormat, input: input, displayName: displayName }
        }
        const p = PRESETS[Number(mode)]
        if (p === undefined) return null
        return { format: p.format, input: p.input, displayName: p.label }
      }

      function load() {
        const c = resolveCase()
        if (c === null || c.input === '') return
        setCaseLoading(true)
        setCaseLoaded(false)
        setCaseLoadError(null)
        setCaseLoadedInfo(null)
        setCaseNetworkInfo(null)
        callRemote('loadCase', { format: c.format, input: c.input, sessionId }).then(
          (res) => {
            setCaseLoading(false)
            if (res && res.ok) {
              setCaseLoaded(true)
              setCaseLoadError(null)
              setCaseLoadedInfo((res.busCount != null ? res.busCount : '?') + ' buses, ' + (res.branchCount != null ? res.branchCount : '?') + ' branches')
              callRemote('getNetworkInfo', { sessionId }).then(
                (r2) => { if (r2 && r2.ok && r2.networkInfo) setCaseNetworkInfo(r2.networkInfo) },
                () => {},
              )
            } else {
              setCaseLoaded(false)
              setCaseLoadError(res && res.error ? res.error : 'failed to load case')
            }
          },
          (err) => { setCaseLoading(false); setCaseLoaded(false); setCaseLoadError(String(err && err.message ? err.message : err)) },
        )
      }

      function run() {
        const c = resolveCase()
        if (c === null || c.input === '') return
        setRunning(true)
        clearResults()
        callRemote('runAclf', { format: c.format, input: c.input, sessionId }).then(
          (res) => {
            setRunning(false)
            setResult(res)
            if (res && res.ok && res.exitCode === 0) {
              if (res.networkInfo) setCaseNetworkInfo(res.networkInfo)
              callRemote('checkResultFiles', { input: c.input, sessionId }).then(
                (r2) => { setReportAvailable(!!(r2 && r2.ok && r2.available)) },
                () => {},
              )
            } else {
              setReportAvailable(false)
            }
          },
          (err) => { setRunning(false); setResult({ ok: false, error: String(err && err.message ? err.message : err) }); setReportAvailable(false) },
        )
      }

      // Run CA against an explicit case/configuration. `config` is null when the
      // host should use the case ca_run.json (or the discovered defaults).
      function runCaWith(c, config) {
        setCaRunning(true)
        setCaError(null)
        setCaResult(null)
        const payload = { format: c.format, input: c.input, sessionId }
        if (config !== null && config !== undefined) payload.config = config
        callRemote('runCa', payload).then(
          (res) => {
            setCaRunning(false)
            if (res && res.ok) {
              setCaError(null)
              setCaResult({ resultDir: res.resultDir, contingencyFile: res.contingencyFile, caSummary: res.caSummary || null, stdout: res.stdout || '', stderr: res.stderr || '' })
              if (res.caSummary) setInfoTab('ca')
            } else {
              setCaError(res && res.error ? res.error : 'contingency analysis failed')
            }
          },
          (err) => { setCaRunning(false); setCaError(String(err && err.message ? err.message : err)) },
        )
      }

      // --- Run Contingency Analysis dialog -----------------------------------
      // The CA button opens this dialog; OK saves the five-key config/ca_run.json in
      // the case folder and runs CA with it. Cancel writes nothing.

      function caCountFor(file, kind) {
        if (file === null || file === undefined) return null
        return kind === 'contingency' ? file.contingencyCount : file.monitoredCount
      }

      function caFileEntry(form, kind) {
        const rel = kind === 'contingency' ? form.contingencyFile : form.monitoredBranchFile
        const mode = kind === 'contingency' ? form.contingencyMode : form.monitorMode
        if (mode !== 'custom' || rel === null || caFiles === null) return null
        return caFiles.find((f) => f.path === rel) || null
      }

      function caBasename(rel) {
        if (typeof rel !== 'string') return ''
        const slash = rel.lastIndexOf('/')
        return slash >= 0 ? rel.slice(slash + 1) : rel
      }

      // The green line under a radio group, or the red error when the chosen
      // file does not carry that section's shape.
      function caMessage(kind) {
        if (caForm === null) return null
        const mode = kind === 'contingency' ? caForm.contingencyMode : caForm.monitorMode
        if (mode !== 'custom') return null
        const rel = kind === 'contingency' ? caForm.contingencyFile : caForm.monitoredBranchFile
        if (rel === null) {
          return { kind: 'hint', text: 'No file selected — click the search icon' }
        }
        // The folder listing arrives with (or just after) the config; until then
        // neither an error nor a count is known.
        if (caFiles === null) {
          return { kind: 'checking', text: 'Checking the case folder…' }
        }
        const entry = caFileEntry(caForm, kind)
        if (entry === null) {
          return { kind: 'error', text: caBasename(rel) + ' is not in the case folder' }
        }
        if (entry.error) {
          return { kind: 'error', text: caBasename(rel) + ': ' + entry.error }
        }
        const count = caCountFor(entry, kind)
        if (count === null) {
          return {
            kind: 'error',
            text: caBasename(rel) + (kind === 'contingency'
              ? ' is not a contingency file (no "contingencies" array)'
              : ' is not a monitored-branch file (no "monitored_branches" array)'),
          }
        }
        return {
          kind: 'ok',
          text: kind === 'contingency'
            ? 'User-defined contingencies: ' + count + ' (' + caBasename(rel) + ')'
            : 'Monitored branches: ' + count + ' (' + caBasename(rel) + ')',
        }
      }

      // Only the picked custom sections must be valid before OK runs.
      function caFormError() {
        if (caForm === null) return 'the run configuration is still loading'
        const threshold = Number(caForm.overloadThreshold)
        if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1000) {
          return 'violation check loading must be a percentage between 0 and 1000'
        }
        const kinds = ['contingency', 'monitored']
        for (const kind of kinds) {
          const mode = kind === 'contingency' ? caForm.contingencyMode : caForm.monitorMode
          if (mode !== 'custom') continue
          const message = caMessage(kind)
          if (message === null) continue
          if (message.kind === 'checking') return message.text
          if (message.kind === 'hint') return 'select a file for the ' + (kind === 'contingency' ? 'user-defined contingency' : 'monitored branches')
          if (message.kind === 'error') return message.text
        }
        return null
      }

      function loadCaFiles(c) {
        const target = c === undefined ? caCase : c
        if (target === null || target === undefined) return
        setCaFilesLoading(true)
        callRemote('listCaFiles', { input: target.input, sessionId }).then(
          (res) => { setCaFilesLoading(false); setCaFiles(res && res.ok ? res.files : []) },
          () => { setCaFilesLoading(false); setCaFiles([]) },
        )
      }

      function openCaDialog() {
        if (caOpen) {
          setCaOpen(false)
          return
        }
        const c = resolveCase()
        if (c === null || c.input === '') return
        setCaCase(c)
        setCaOpen(true)
        setCaPicker(null)
        setCaDialogError(null)
        setCaWarning(null)
        setCaForm(null)
        setCaLoading(true)
        setCaFiles(null)
        callRemote('getCaOptions', { input: c.input, sessionId }).then(
          (res) => {
            setCaLoading(false)
            if (res && res.ok && res.config) {
              setCaForm({
                contingencyMode: res.config.contingencyMode === 'custom' ? 'custom' : 'all',
                contingencyFile: res.config.contingencyFile || null,
                monitorMode: res.config.monitorMode === 'custom' ? 'custom' : 'all',
                monitoredBranchFile: res.config.monitoredBranchFile || null,
                // The violation-check loading the dialog shows; kept as typed so the input
                // behaves normally, validated and coerced on OK.
                overloadThreshold: typeof res.config.overloadThreshold === 'number'
                  ? String(res.config.overloadThreshold)
                  : '90',
              })
              setCaWarning(res.warning || null)
            } else {
              setCaDialogError(res && res.error ? res.error : 'failed to load the run configuration')
            }
          },
          (err) => { setCaLoading(false); setCaDialogError(String(err && err.message ? err.message : err)) },
        )
        loadCaFiles(c)
      }

      function setCaThreshold(value) {
        if (caForm === null) return
        setCaDialogError(null)
        setCaForm({ ...caForm, overloadThreshold: value })
      }

      function setCaMode(kind, mode) {
        if (caForm === null) return
        setCaDialogError(null)
        if (kind === 'contingency') {
          setCaForm({ ...caForm, contingencyMode: mode })
        } else {
          setCaForm({ ...caForm, monitorMode: mode })
        }
        if (mode === 'all') setCaPicker(null)
      }

      function toggleCaPicker(kind) {
        if (caPicker === kind) {
          setCaPicker(null)
          return
        }
        setCaPicker(kind)
        if (caFiles === null) loadCaFiles()
      }

      function chooseCaFile(kind, entry) {
        if (caForm === null) return
        setCaDialogError(null)
        if (kind === 'contingency') {
          setCaForm({ ...caForm, contingencyMode: 'custom', contingencyFile: entry.path })
        } else {
          setCaForm({ ...caForm, monitorMode: 'custom', monitoredBranchFile: entry.path })
        }
        setCaPicker(null)
      }

      function cancelCaDialog() {
        if (caSaving) return
        setCaOpen(false)
        setCaPicker(null)
        setCaDialogError(null)
        setCaWarning(null)
      }

      function okCaDialog() {
        if (caForm === null || caSaving) return
        const c = caCase
        if (c === null) return
        const invalid = caFormError()
        if (invalid !== null) {
          setCaDialogError(invalid)
          return
        }
        const payload = {
          contingencyMode: caForm.contingencyMode,
          contingencyFile: caForm.contingencyMode === 'custom' ? caForm.contingencyFile : null,
          monitorMode: caForm.monitorMode,
          monitoredBranchFile: caForm.monitorMode === 'custom' ? caForm.monitoredBranchFile : null,
          overloadThreshold: Number(caForm.overloadThreshold),
        }
        setCaSaving(true)
        setCaDialogError(null)
        callRemote('saveCaOptions', { input: c.input, config: payload, sessionId }).then(
          (res) => {
            setCaSaving(false)
            if (res && res.ok) {
              setCaOpen(false)
              setCaPicker(null)
              setCaWarning(null)
              runCaWith(c, payload)
            } else {
              setCaDialogError(res && res.error ? res.error : 'failed to save ca_run.json')
            }
          },
          (err) => { setCaSaving(false); setCaDialogError(String(err && err.message ? err.message : err)) },
        )
      }

      function runReport() {
        const c = resolveCase()
        if (c === null || c.input === '' || !reportAvailable) return
        const seq = ++reportSeq
        setReportLoading(true)
        setReportOpen(true)
        setReportError(null)
        setReportMarkdown(null)
        setReportName(c.displayName)
        setReportView('rendered')
        callRemote('runReport', { input: c.input, displayName: c.displayName, sessionId }).then(
          (res) => {
            if (seq !== reportSeq) return
            setReportLoading(false)
            if (res && res.ok) {
              setReportMarkdown(res.markdown || '')
              setReportName(res.displayName || c.displayName)
              setReportType(res.reportType === 'aclf' ? 'aclf' : 'nerc')
              setReportError(null)
            } else {
              setReportError(res && res.error ? res.error : 'failed to generate report')
            }
          },
          (err) => {
            if (seq !== reportSeq) return
            setReportLoading(false)
            setReportError(String(err && err.message ? err.message : err))
          },
        )
      }

      function openPicker() {
        if (pickerOpen) {
          setPickerOpen(false)
          return
        }
        setPickerOpen(true)
        if (cases === null) {
          setLoadingCases(true)
          callRemote('listCases', { sessionId }).then(
            (res) => { setLoadingCases(false); setCases(res && res.ok ? res.cases : []) },
            () => { setLoadingCases(false); setCases([]) },
          )
        }
      }

      function pickCase(c) {
        lastSelection.customFormat = c.format
        lastSelection.customInput = c.path
        setCustomFormat(c.format)
        setCustomInput(c.path)
        setPickerOpen(false)
        onCaseChanged(c.path)
      }

      function filePathForKind(kind) {
        if (kind === 'contingency' && caResult !== null) {
          return caResult.resultDir + '/' + caResult.contingencyFile
        }
        if (result === null) return null
        const fileName = result.files ? result.files.find((f) => f.indexOf('_DF_' + kind + '.csv') !== -1) : undefined
        if (fileName === undefined) return null
        return result.resultDir + '/' + fileName
      }

      function currentCsvPath() {
        if (csvSel === null) return null
        return filePathForKind(csvSel)
      }

      // The Contingency table is only useful worst-first; the DF tables keep file order.
      function defaultCsvSort(kind) {
        return kind === 'contingency' ? { column: 'LoadingPercent', desc: true } : { column: null, desc: false }
      }

      function loadCsvFirstPage(kind, sort) {
        setCsvHeader(null)
        setCsvRows([])
        setCsvTotal(0)
        setCsvHasMore(false)
        setCsvError(null)
        setCsvLoading(true)
        const path = filePathForKind(kind)
        if (path === null) {
          setCsvLoading(false)
          setCsvError('result file not found for ' + kind)
          return
        }
        callRemote('readCsv', {
          path: path,
          sessionId,
          start: 0,
          limit: 200,
          sortColumn: sort === null || sort === undefined ? null : sort.column,
          sortDesc: sort === null || sort === undefined ? false : sort.desc === true,
        }).then(
          (res) => {
            setCsvLoading(false)
            if (res && res.ok) {
              setCsvHeader(res.header)
              setCsvRows(res.rows || [])
              setCsvTotal(res.totalRows || 0)
              setCsvHasMore(!!res.hasMore)
              // Trust the Host's report of the sort it actually applied.
              setCsvSort({
                column: typeof res.sortColumn === 'string' && res.sortColumn !== '' ? res.sortColumn : null,
                desc: res.sortDesc === true,
              })
            } else {
              setCsvError(res && res.error ? res.error : 'failed to read result file')
            }
          },
          (err) => { setCsvLoading(false); setCsvError(String(err && err.message ? err.message : err)) },
        )
      }

      function openCsv(kind) {
        setSelectedBus(null)
        setConnOpen(false)
        setConnResult(null)
        if (csvSel === kind) {
          setCsvSel(null)
          setCsvHeader(null)
          setCsvRows([])
          setCsvError(null)
          setCsvSort({ column: null, desc: false })
          return
        }
        setCsvSel(kind)
        const sort = defaultCsvSort(kind)
        setCsvSort(sort)
        loadCsvFirstPage(kind, sort)
      }

      // A header click: same column flips the direction, a new column starts ascending,
      // and the open table re-reads its first page in the new order.
      function changeCsvSort(clicked) {
        const next = nextCsvSort(csvSort.column, csvSort.desc, clicked)
        setCsvSort(next)
        if (csvSel !== null) loadCsvFirstPage(csvSel, next)
      }

      const csvSortView = { column: csvSort.column, desc: csvSort.desc, onSort: changeCsvSort }

      function loadMoreCsv() {
        if (csvLoadingMore || !csvHasMore) return
        const path = currentCsvPath()
        if (path === null) return
        setCsvLoadingMore(true)
        callRemote('readCsv', {
          path,
          sessionId,
          start: csvRows.length,
          limit: 200,
          sortColumn: csvSort.column,
          sortDesc: csvSort.desc,
        }).then(
          (res) => {
            setCsvLoadingMore(false)
            if (res && res.ok) {
              setCsvHeader(res.header)
              setCsvRows((prev) => prev.concat(res.rows || []))
              setCsvTotal(res.totalRows || 0)
              setCsvHasMore(!!res.hasMore)
            }
          },
          () => { setCsvLoadingMore(false) },
        )
      }

      function handleCsvScroll(e) {
        const el = e.currentTarget
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
          loadMoreCsv()
        }
      }

      function selectBus(id) {
        setSelectedBus(id)
      }

      function busRowContextMenu(e, id) {
        e.preventDefault()
        e.stopPropagation()
        setSelectedBus(id)
        setCtxMenu({ x: e.clientX, y: e.clientY, busId: id })
      }

      function showConnections(busId, keepView) {
        const bid = busId !== undefined && busId !== null ? busId : selectedBus
        if (bid === null || bid === undefined) return
        setCtxMenu(null)
        setConnOpen(true)
        setConnResult(null)
        setConnLoading(true)
        if (!keepView) setConnView('diagram')
        const branchFile = result && result.files ? result.files.find((f) => f.indexOf('_DF_branch.csv') !== -1) : undefined
        if (branchFile === undefined) {
          setConnLoading(false)
          setConnResult({ error: 'branch file not found' })
          return
        }
        callRemote('busConnections', { busId: bid, path: result.resultDir + '/' + branchFile, sessionId }).then(
          (res) => { setConnLoading(false); setConnResult(res) },
          (err) => { setConnLoading(false); setConnResult({ error: String(err && err.message ? err.message : err) }) },
        )
      }

      function handleBusDoubleClick(busId) {
        if (busId === null || busId === undefined || busId === '') return
        if (busId === selectedBus) return
        selectBus(busId)
        showConnections(busId, true)
      }

      const LF_METHODS = [['NR', 'NR'], ['PQ', 'PQ'], ['GS', 'GS']]
      const APPLY_TYPES = [['DURING_ITERATION', 'DuringItr'], ['POST_ITERATION', 'PostItr']]
      const OPT_ALGOS = [['CUBIC_EQN', 'CubicEqn'], ['LINEAR_SEARCH', 'Linear Search'], ['BINARY_SEARCH', 'Binary Search']]

      function openOptions() {
        if (optOpen) {
          setOptOpen(false)
          return
        }
        setOptOpen(true)
        setOptTab('main')
        setOptError(null)
        setOptSaved(false)
        setOptConfig(null)
        setOptForm(null)
        setOptLoading(true)
        const c = resolveCase()
        callRemote('getAclfOptions', { input: c && c.input ? c.input : '', sessionId }).then(
          (res) => {
            setOptLoading(false)
            if (res && res.ok && res.config) {
              setOptConfig(res.config)
              setOptForm(buildOptForm(res.config))
            } else {
              setOptError(res && res.error ? res.error : 'failed to load ACLF options')
            }
          },
          (err) => { setOptLoading(false); setOptError(String(err && err.message ? err.message : err)) },
        )
      }

      function saveOptions() {
        if (optConfig === null || optForm === null) return
        setOptSaving(true)
        setOptError(null)
        const next = Object.assign({}, optConfig, configFromForm(optForm))
        const c = resolveCase()
        callRemote('saveAclfOptions', { config: next, input: c && c.input ? c.input : '', sessionId }).then(
          (res) => {
            setOptSaving(false)
            if (res && res.ok) {
              setOptSaved(true)
              setOptOpen(false)
            } else {
              setOptError(res && res.error ? res.error : 'failed to save ACLF options')
            }
          },
          (err) => { setOptSaving(false); setOptError(String(err && err.message ? err.message : err)) },
        )
      }

      const options = PRESETS.map((p, i) =>
        React.createElement('option', { key: i, value: String(i) }, p.label),
      )
      options.push(React.createElement('option', { key: 'custom', value: 'custom' }, 'Select…'))

      const selectStyle = { padding: '0 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', height: '34px', boxSizing: 'border-box', minWidth: '150px' }
      const caseRow = [
        React.createElement('span', { key: 'case-label', style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, 'Simu Case:'),
        React.createElement('select', { key: 'case', value: mode, onChange: (e) => { const m = e.target.value; lastSelection.mode = m; setMode(m); onCaseChanged(m === 'custom' ? customInput.trim() : (PRESETS[Number(m)] ? PRESETS[Number(m)].input : '')) }, style: selectStyle }, options),
        React.createElement('button', { key: 'load', onClick: load, disabled: caseLoading, title: 'Load the selected case into the simulation model', style: { ...btn, marginLeft: '8px', opacity: caseLoading ? 0.6 : 1 } }, caseLoading ? 'Loading…' : 'Load'),
        caseLoaded ? React.createElement('span', { key: 'caseloaded', style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' } }, '✓ Loaded: ' + (caseLoadedInfo || '')) : null,
      ]
      const caseInputRow = isCustom ? [
        React.createElement('select', { key: 'fmt', value: customFormat, onChange: (e) => { const f = e.target.value; lastSelection.customFormat = f; setCustomFormat(f); onCaseChanged(customInput.trim()) }, style: selectStyle },
          React.createElement('option', { value: 'ieee' }, 'IEEE CDF'),
          React.createElement('option', { value: 'psse' }, 'PSS/E RAW'),
        ),
        React.createElement('div', { key: 'pathbox', style: { display: 'flex', alignItems: 'stretch', width: '380px', maxWidth: '100%' } },
          React.createElement('input', {
            type: 'text',
            value: customInput,
            placeholder: 'data/ieee/Ieee118Bus/ieee118.ieee',
            onChange: (e) => { const v = e.target.value; lastSelection.customInput = v; setCustomInput(v); onCaseChanged(v.trim()) },
            style: { ...selectStyle, flex: '1 1 auto', minWidth: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' },
          }),
          React.createElement('button', {
            onClick: openPicker,
            title: pickerOpen ? 'Close case picker' : 'Pick a case file',
            'aria-label': pickerOpen ? 'Close case picker' : 'Pick a case file',
            style: { ...btn, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '34px', padding: 0 },
          }, searchIcon),
        ),
      ] : null
      const actionRow = [
        React.createElement('div', { key: 'run-group', style: { display: 'flex', alignItems: 'center' } },
          React.createElement('button', { onClick: run, disabled: running || !caseLoaded, style: { ...btn, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none', opacity: (running || !caseLoaded) ? 0.6 : 1 } }, running ? 'Running…' : 'ACLF'),
          React.createElement('button', {
            onClick: openOptions,
            disabled: !caseLoaded,
            title: 'AC Loadflow options',
            'aria-label': 'AC Loadflow options',
            style: { ...btn, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '7px 10px', opacity: !caseLoaded ? 0.6 : 1 },
          }, gearIcon),
          React.createElement('button', { onClick: openCaDialog, disabled: running || caRunning || !caseLoaded, title: 'Run DC contingency analysis', style: { ...btn, marginLeft: '12px', opacity: (running || caRunning || !caseLoaded) ? 0.6 : 1 } }, caRunning ? 'Running…' : 'CA'),
          React.createElement('button', { onClick: runReport, disabled: running || reportLoading || !reportAvailable, style: { ...btn, marginLeft: '12px', opacity: (running || reportLoading || !reportAvailable) ? 0.6 : 1 } }, reportLoading ? 'Generating…' : 'Report'),
        ),
        caseLoadError ? React.createElement('span', { key: 'caseloaderr', style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } }, '⚠ ' + caseLoadError) : null,
        optSaved ? React.createElement('span', { key: 'optsaved', style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' } }, '✓ Options saved') : null,
      ]

      let picker = null
      if (pickerOpen) {
        let pickerBody
        if (loadingCases) {
          pickerBody = React.createElement('div', { style: { padding: '12px', color: 'var(--dsw-alias-label-secondary)' } }, 'Loading cases…')
        } else if (cases !== null) {
          const filtered = cases.filter((c) => c && c.format === customFormat)
          if (filtered.length === 0) {
            pickerBody = React.createElement('div', { style: { padding: '12px', color: 'var(--dsw-alias-label-secondary)' } }, customFormat === 'psse' ? 'No PSS/E RAW (.raw) files found under wspace/data.' : 'No IEEE CDF (.ieee) files found under wspace/data.')
          } else {
            pickerBody = filtered.map((c) =>
              React.createElement('button', {
                key: c.path,
                onClick: () => pickCase(c),
                style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '12px' },
              },
                React.createElement('span', { style: { opacity: 0.65, marginRight: '10px' } }, c.format === 'psse' ? 'PSSE' : 'IEEE'),
                c.path,
              ),
            )
          }
        }
        picker = React.createElement('div', { style: { marginTop: '8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', maxHeight: '260px', overflowY: 'auto', background: 'var(--dsw-alias-bg-layer-1)' } }, pickerBody)
      }

      const csvPanel = (csvLoading || csvError !== null || csvHeader !== null) ? React.createElement('div', null,
        csvLoading ? React.createElement('div', { style: { marginTop: '8px', color: 'var(--dsw-alias-label-secondary)' } }, 'Loading…') : null,
        csvError ? React.createElement('pre', { style: { ...mono, ...panel, maxHeight: '200px' } }, csvError) : null,
        csvHeader !== null ? React.createElement('div', null,
          React.createElement('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, csvHasMore ? 'Showing ' + csvRows.length + ' of ' + csvTotal + ' rows (scroll for more)' : 'Total rows: ' + csvTotal),
          React.createElement('div', { style: { marginTop: '6px', maxHeight: '320px', overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)' }, onScroll: handleCsvScroll }, csvSel === 'bus' ? renderBusTable(csvHeader, csvRows, selectedBus, selectBus, busRowContextMenu, csvSortView) : (csvSel === 'gen' || csvSel === 'load') ? renderCsvTable(csvHeader, csvRows, [0], handleBusDoubleClick, undefined, csvSortView) : renderCsvTable(csvHeader, csvRows, undefined, undefined, csvSel === 'contingency' ? 2 : 4, csvSortView)),
          csvLoadingMore ? React.createElement('div', { style: { marginTop: '6px', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, 'Loading more…') : null,
          csvSel === 'bus' && selectedBus !== null ? React.createElement('div', { style: { marginTop: '8px' } },
            React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, 'Selected bus: ' + selectedBus),
          ) : null,
        ) : null,
      ) : null

      let body = null
      if (result !== null) {
        if (result.ok) {
          body = React.createElement('div', null,
            React.createElement('div', { style: { color: 'var(--dsw-alias-state-success-primary)', fontWeight: 600, marginBottom: '8px' } }, result.loaded ? 'Previous results found' : '✓ Load flow converged'),
            React.createElement('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, 'Results written to: ' + result.resultDir),
            React.createElement('div', { style: { marginTop: '4px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, 'Files: ' + (result.files ? result.files.join(', ') : '')),
            React.createElement('div', { style: { marginTop: '12px' } },
              React.createElement('div', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', marginBottom: '6px' } }, 'Explore result files:'),
              React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                (caResult !== null ? ['bus', 'branch', 'gen', 'load', 'contingency'] : ['bus', 'branch', 'gen', 'load']).map((kind) =>
                  React.createElement('button', {
                    key: kind,
                    onClick: () => openCsv(kind),
                    style: { ...btn, padding: '5px 10px', borderColor: csvSel === kind ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' },
                  }, kind.charAt(0).toUpperCase() + kind.slice(1)),
                ),
              ),
            ),
            result.loaded ? null : React.createElement('div', null,
              React.createElement('button', { onClick: () => setShowRaw(!showRaw), style: { ...btn, marginTop: '12px' } }, showRaw ? 'Hide log info' : 'Show log info'),
              showRaw ? React.createElement('pre', { style: { ...mono, ...panel, maxHeight: '240px' } }, '--- stdout ---\n' + result.stdout + '\n\n--- stderr ---\n' + result.stderr) : null,
            ),
          )
        } else {
          body = React.createElement('div', null,
            React.createElement('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontWeight: 600, marginBottom: '8px' } }, '✗ Load flow failed' + (result.exitCode !== null && result.exitCode !== undefined ? ' (exit ' + result.exitCode + ')' : '')),
            result.error ? React.createElement('pre', { style: { ...mono, ...panel } }, result.error) : null,
            result.timedOut ? React.createElement('div', { style: { marginTop: '8px' } }, 'Timed out.') : null,
            result.aborted ? React.createElement('div', { style: { marginTop: '8px' } }, 'Aborted.') : null,
            result.stdout ? React.createElement('pre', { style: { ...mono, ...panel, maxHeight: '240px' } }, result.stdout) : null,
            result.stderr ? React.createElement('pre', { style: { ...mono, ...panel, maxHeight: '240px' } }, result.stderr) : null,
          )
        }
      }

      function showDiagramTip(text, e) {
        setDiagramTip({ text: text, x: e.clientX, y: e.clientY })
      }
      function moveDiagramTip(e) {
        setDiagramTip((t) => (t ? { text: t.text, x: e.clientX, y: e.clientY } : t))
      }
      function hideDiagramTip() {
        setDiagramTip(null)
      }

      function renderConnBody() {
        if (connView === 'diagram') {
          return renderConnDiagram(connResult.busId || selectedBus, connResult.rows, connResult.busRecords, handleBusDoubleClick, showDiagramTip, moveDiagramTip, hideDiagramTip)
        }
        if (connView === 'gen') {
          if (connResult.genRows && connResult.genRows.length > 0) {
            return renderConnTable(connResult.genHeader, connResult.genRows, [3, 4, 6, 9, 10, 11, 12, 13, 14, 15])
          }
          return React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'No generators connected to this bus.')
        }
        if (connView === 'load') {
          if (connResult.loadRows && connResult.loadRows.length > 0) {
            return renderConnTable(connResult.loadHeader, connResult.loadRows, [3, 4, 5, 6, 7, 8, 9, 10])
          }
          return React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'No loads connected to this bus.')
        }
        return renderConnTable(connResult.header, connResult.rows)
      }

      function connCountLabel() {
        if (connView === 'gen') return (connResult.genCount || 0) + ' generator(s)'
        if (connView === 'load') return (connResult.loadCount || 0) + ' load(s)'
        return connResult.count + ' connection(s)'
      }

      const connModal = connOpen ? React.createElement('div', {
        style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
        onClick: () => setConnOpen(false),
      },
        React.createElement('div', {
          onClick: (e) => e.stopPropagation(),
          style: { background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '16px', width: '100%', maxWidth: '960px', height: '70vh', display: 'flex', flexDirection: 'column' },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' } },
            React.createElement('div', { style: { fontWeight: 600 } }, (selectedBus ? selectedBus : '') + ' — branch connections'),
            React.createElement('button', { onClick: () => setConnOpen(false), style: { ...btn, padding: '2px 9px', fontSize: '14px' } }, '✕'),
          ),
          connLoading ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'Loading…') :
          connResult && connResult.error ? React.createElement('pre', { style: { ...mono, maxHeight: '220px', overflow: 'auto' } }, connResult.error) :
          connResult && connResult.ok ? React.createElement('div', { style: { flex: '1 1 auto', overflow: 'auto', minHeight: 0 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' } },
              React.createElement('button', { onClick: () => setConnView('diagram'), style: { ...btn, padding: '4px 10px', borderColor: connView === 'diagram' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' } }, 'Diagram'),
              React.createElement('button', { onClick: () => setConnView('table'), style: { ...btn, padding: '4px 10px', borderColor: connView === 'table' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' } }, 'Branch'),
              React.createElement('button', { onClick: () => setConnView('gen'), style: { ...btn, padding: '4px 10px', borderColor: connView === 'gen' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' } }, 'Gen'),
              React.createElement('button', { onClick: () => setConnView('load'), style: { ...btn, padding: '4px 10px', borderColor: connView === 'load' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' } }, 'Load'),
              React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginLeft: 'auto' } }, connCountLabel()),
            ),
            renderConnBody(),
          ) : null,
        ),
      ) : null

      const ctxMenuEl = ctxMenu ? React.createElement('div', {
        style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 },
        onClick: () => setCtxMenu(null),
        onContextMenu: (e) => { e.preventDefault(); setCtxMenu(null) },
      },
        React.createElement('div', {
          onClick: (e) => e.stopPropagation(),
          style: {
            position: 'fixed', left: ctxMenu.x, top: ctxMenu.y,
            background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: '150px', padding: '4px 0', zIndex: 9999,
          },
        },
          React.createElement('button', {
            onClick: () => showConnections(ctxMenu.busId),
            style: { display: 'block', width: '100%', textAlign: 'left', padding: '7px 14px', background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: '13px' },
          }, 'Connection info'),
        ),
      ) : null

      const optInputStyle = { ...selectStyle, width: '100%' }
      const optRow = (label, control, indent) => React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px', marginLeft: indent || 0 } },
        React.createElement('span', { style: { width: '168px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', flexShrink: 0, lineHeight: '1.3' } }, label),
        React.createElement('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', gap: '8px', alignItems: 'center' } }, control),
      )
      const optCheck = (key, label, disabled, indent) => React.createElement('label', { key: key, style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: disabled ? 'default' : 'pointer', marginBottom: '6px', lineHeight: '1.3', opacity: disabled ? 0.5 : 1, marginLeft: indent || 0 } },
        React.createElement('input', { type: 'checkbox', checked: !!optForm[key], disabled: !!disabled, onChange: (e) => setOptForm({ ...optForm, [key]: e.target.checked }) }),
        label,
      )
      const optCheckPair = (items, disabled) => React.createElement('div', { key: items[0][0], style: { display: 'flex', alignItems: 'flex-start', gap: '24px', marginLeft: 48 } },
        items.map((it) => optCheck(it[0], it[1], disabled, 0)),
      )
      const optCheckBox = (key) => React.createElement('input', { type: 'checkbox', checked: !!optForm[key], onChange: (e) => setOptForm({ ...optForm, [key]: e.target.checked }) })
      const optCheckInline = (key, label) => React.createElement('label', { key: key, style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', marginLeft: '8px', whiteSpace: 'nowrap' } },
        React.createElement('input', { type: 'checkbox', checked: !!optForm[key], onChange: (e) => setOptForm({ ...optForm, [key]: e.target.checked }) }),
        label,
      )
      const optNum = (key, width, disabled) => React.createElement('input', { type: 'number', step: 'any', disabled: !!disabled, value: optForm[key], onChange: (e) => setOptForm({ ...optForm, [key]: e.target.value }), style: { ...optInputStyle, width: width || '120px', flex: '0 0 ' + (width || '120px'), opacity: disabled ? 0.5 : 1 } })
      const optSel = (key, opts, disabled, width) => React.createElement('select', { value: optForm[key], disabled: !!disabled, onChange: (e) => setOptForm({ ...optForm, [key]: e.target.value }), style: { ...optInputStyle, width: width || '100%', flex: width ? '0 0 auto' : undefined, opacity: disabled ? 0.5 : 1 } },
        opts.map((o) => React.createElement('option', { key: o[0], value: o[0] }, o[1])),
      )
      const optConstInline = (label, key, disabled) => React.createElement('div', { key: key, style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', marginLeft: '8px', whiteSpace: 'nowrap' } },
        React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, label + ':'),
        React.createElement('input', { type: 'number', step: 'any', disabled: !!disabled, value: optForm[key], onChange: (e) => setOptForm({ ...optForm, [key]: e.target.value }), style: { ...selectStyle, width: '70px', padding: '3px 6px', opacity: disabled ? 0.5 : 1 } }),
      )

      const optGroup = (title, fields) => React.createElement('div', { key: title, style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '12px 14px', marginBottom: '12px' } },
        React.createElement('div', { style: { fontWeight: 600, fontSize: '13px', marginBottom: '10px', color: 'var(--dsw-alias-label-primary)' } }, title),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '24px', rowGap: '10px' } },
          fields.map((f) => React.createElement('div', { key: f[0], style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', flexShrink: 0 } }, f[0]),
            f[1],
          )),
        ),
      )

      const OPT_TABS = [['main', 'Main'], ['nr', 'NR Config'], ['adj', 'Adj/Ctrl Setting']]

      function renderOptTab() {
        if (optForm === null) return null
        if (optTab === 'nr') {
          return React.createElement('div', null,
            optRow('Optimize Algorithm', optSel('optAlgo', OPT_ALGOS, undefined, '200px')),
            optCheck('variableUpdateLimit', 'Variable Update Limit'),
            optRow('Delta Voltage Ang Limit', optNum('deltaVAngLimit', '150px'), 44),
            optRow('Delta Voltage Mag Limit', optNum('deltaVMagLimit', '150px'), 44),
            optCheck('stopNoSolutionFound', 'Stop No Solution Found'),
            optRow('Min Scale Factor', optNum('minScaleFactor', '150px')),
          )
        }
        if (optTab === 'adj') {
          return React.createElement('div', null,
            optGroup('Limit Ctrl', [
              ['Limit Ctrl StartPoint', optNum('limitCtrlStartPoint', '150px', !optForm.applyLimitControl)],
              ['Limit Ctrl ErrFactor', optNum('limitCtrlTolearnceFactor', '150px', !optForm.applyLimitControl)],
              ['Limit Ctrl Apply Type', optSel('limitCtrlApplyType', APPLY_TYPES, !optForm.applyLimitControl)],
            ]),
            optGroup('Voltage Adj', [
              ['Voltage Adj StartPoint', optNum('voltAdjStartPoint', '150px', !optForm.applyVoltAdjust)],
              ['Voltage Adj Tolerance (PU)', optNum('voltAdjTolearnce', '150px', !optForm.applyVoltAdjust)],
              ['Voltage Adj Apply Type', optSel('voltAdjApplyType', APPLY_TYPES, !optForm.applyVoltAdjust)],
              ['dQ/dV Threshold', optNum('dQ_dVThreshold', '150px', !optForm.applyVoltAdjust)],
            ]),
            optGroup('Power Adj', [
              ['Power Adj StartPoint', optNum('powerAdjStartPoint', '150px', !optForm.applyPowerAdjust)],
              ['Power Adj ErrFactor', optNum('powerAdjTolearnceFactor', '150px', !optForm.applyPowerAdjust)],
              ['Power Adj Apply Type', optSel('powerAdjApplyType', APPLY_TYPES, !optForm.applyPowerAdjust)],
            ]),
            optGroup('Acceleration Factors', [
              ['PVLimit Ctrl AccFactor', optNum('pvLimitAccFactor', '150px', !optForm.applyPowerAdjust)],
              ['PQLimit Ctrl AccFactor', optNum('pqLimitAccFactor', '150px', !optForm.applyPowerAdjust)],
              ['ReQBus Adj AccFactor', optNum('reQBusAccFactor', '150px', !optForm.applyPowerAdjust)],
              ['SVC Ctrl AccFactor', optNum('svcAccFactor', '150px', !optForm.applyPowerAdjust)],
              ['Xfr Tap Ctrl AccFactor', optNum('xfrTapAccFactor', '150px', !optForm.applyPowerAdjust)],
              ['PSXfr Power Ctrl AccFactor', optNum('psXfrPContrlAccFactor', '150px', !optForm.applyPowerAdjust)],
            ]),
          )
        }
        return React.createElement('div', null,
          React.createElement('div', { style: { display: 'flex', gap: '28px', flexWrap: 'wrap' } },
            React.createElement('div', { style: { flex: '1 1 280px', minWidth: 0 } }, optRow('Loadflow Method', optSel('lfMethod', LF_METHODS))),
            React.createElement('div', { style: { flex: '1 1 280px', minWidth: 0 } }, optRow('Coordinate', React.createElement('select', { value: optForm.polarCoordinate ? 'polar' : 'xy', onChange: (e) => setOptForm({ ...optForm, polarCoordinate: e.target.value === 'polar' }), style: optInputStyle },
              React.createElement('option', { value: 'polar' }, 'Polar'),
              React.createElement('option', { value: 'xy' }, 'XY'),
            ))),
          ),
          optRow('Tolerance', [
            optNum('tolerance', '140px'),
            React.createElement('select', { value: optForm.tolUnitType, onChange: (e) => setOptForm({ ...optForm, tolUnitType: e.target.value }), style: { ...selectStyle, width: '90px', flex: '0 0 90px' } },
              React.createElement('option', { value: 'PU' }, 'PU'),
              React.createElement('option', { value: 'MVA' }, 'MVA'),
            ),
          ]),
          optRow('Max Iterations', [
            optNum('maxIterations', '140px'),
            optCheckInline('nonDivergent', 'Non-Divergent'),
          ]),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px', flexWrap: 'wrap' } },
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', width: '168px', flexShrink: 0 } },
              React.createElement('input', { type: 'checkbox', checked: !!optForm.busLoadLowVoltAdj, onChange: (e) => setOptForm({ ...optForm, busLoadLowVoltAdj: e.target.checked }) }),
              'Low Load Volt Adjust',
            ),
            optConstInline('ConstP Vmin', 'vConstPMin', !optForm.busLoadLowVoltAdj),
            optConstInline('ConstI Vmin', 'vConstIMin', !optForm.busLoadLowVoltAdj),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '28px', marginTop: '8px' } },
            React.createElement('div', { style: { flex: '1 1 0', minWidth: 0 } },
              optCheck('checkGenQLimImmediate', 'Apply PV Gen QLimit In Init'),
              optCheck('turnOffIslandBus', 'Turn Off Island Bus'),
            ),
            React.createElement('div', { style: { flex: '1 1 0', minWidth: 0 } },
              optCheck('autoSetZeroZBranch', 'Auto Set Zero-Z Branch'),
              optCheck('autoTurnLine2Xfr', 'Auto Turn Line to Xformer'),
            ),
          ),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', marginBottom: '6px', marginTop: '14px', fontWeight: 600, lineHeight: '1.3' } },
            React.createElement('input', { type: 'checkbox', checked: !!optForm.includeAdjustments, onChange: (e) => { setOptForm({ ...optForm, includeAdjustments: e.target.checked }); if (!e.target.checked) setOptTab('main') } }),
            'Include Adjustments/Controls',
          ),
          optCheck('applyLimitControl', 'Apply Limit Control', !optForm.includeAdjustments, 24),
          optCheckPair([['pvBusLimitControl', 'Apply PVBus Limit Control'], ['pqBusLimitControl', 'Apply PQBus Limit Control']], !optForm.includeAdjustments || !optForm.applyLimitControl),
          optCheck('limitBackoffCheck', 'Apply Limit Backoff Check', !optForm.includeAdjustments || !optForm.applyLimitControl, 48),
          optCheck('applyVoltAdjust', 'Apply Voltage Adjustment', !optForm.includeAdjustments, 24),
          optCheckPair([['remoteQBusControl', 'Apply PVBus RemoteQ Adjustment'], ['xfrTapControl', 'Apply Xformer Tap Control']], !optForm.includeAdjustments || !optForm.applyVoltAdjust),
          optCheckPair([['switchedShuntAdjust', 'Apply SwitchedShunt Adjustment'], ['svcFactsAdjust', 'Apply SVC Facts Adjustment']], !optForm.includeAdjustments || !optForm.applyVoltAdjust),
          optCheckPair([['hvdcTapControl', 'Apply HVDC Tap Control'], ['applyDiscreteAdjust', 'Apply Discrete Adjustments/Controls']], !optForm.includeAdjustments || !optForm.applyVoltAdjust),
          optCheck('applyPowerAdjust', 'Apply Power Adjustment', !optForm.includeAdjustments, 24),
          optCheck('psXfrPControl', 'Apply PSXfr PControl', !optForm.includeAdjustments || !optForm.applyPowerAdjust, 48),
        )
      }

      // --- Run Contingency Analysis dialog (rendering) ------------------------
      const caRadio = (kind, value, label) => {
        const mode = caForm === null ? 'all' : (kind === 'contingency' ? caForm.contingencyMode : caForm.monitorMode)
        return React.createElement('label', {
          key: value,
          style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', cursor: 'pointer', fontSize: '14px' },
        },
          React.createElement('input', {
            type: 'radio',
            name: 'ca-' + kind,
            checked: mode === value,
            onChange: () => setCaMode(kind, value),
            style: { width: '16px', height: '16px', margin: 0, accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
          }),
          React.createElement('span', null, label),
        )
      }

      const caSection = (kind, title, allLabel, customLabel) => {
        if (caForm === null) return null
        const mode = kind === 'contingency' ? caForm.contingencyMode : caForm.monitorMode
        const message = caMessage(kind)
        const children = [
          React.createElement('div', { key: 'title', style: { fontWeight: 600, fontSize: '15px', marginBottom: '4px' } }, title),
          caRadio(kind, 'all', allLabel),
          React.createElement('div', { key: 'custom', style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            caRadio(kind, 'custom', customLabel),
            React.createElement('button', {
              onClick: () => toggleCaPicker(kind),
              title: caPicker === kind ? 'Close the file selection' : 'Select a .json file',
              'aria-label': caPicker === kind ? 'Close the file selection' : 'Select a .json file',
              style: { ...btn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', padding: 0, opacity: mode === 'custom' ? 1 : 0.5 },
            }, searchIcon),
          ),
        ]
        if (caPicker === kind) {
          const rows = caFilesLoading
            ? [React.createElement('div', { key: 'loading', style: { padding: '10px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, 'Loading…')]
            : (caFiles === null || caFiles.length === 0)
              ? [React.createElement('div', { key: 'empty', style: { padding: '10px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, caFiles === null ? 'Loading…' : 'No .json files in this case folder')]
              : caFiles.map((f) => {
                const count = caCountFor(f, kind)
                const note = f.error ? f.error : (count !== null ? String(count) : '')
                return React.createElement('button', {
                  key: f.path,
                  onClick: () => chooseCaFile(kind, f),
                  style: { display: 'flex', justifyContent: 'space-between', gap: '14px', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '12px' },
                },
                  React.createElement('span', null, f.name),
                  note === '' ? null : React.createElement('span', { style: { opacity: 0.65 } }, note),
                )
              })
          children.push(React.createElement('div', {
            key: 'picker',
            style: { marginTop: '6px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', maxHeight: '200px', overflowY: 'auto', background: 'var(--dsw-alias-bg-layer-1)' },
          }, rows))
        }
        children.push(React.createElement('div', {
          key: 'message',
          style: {
            marginTop: '6px',
            fontSize: '12px',
            color: message === null || message.kind === 'hint' || message.kind === 'checking'
              ? 'var(--dsw-alias-label-secondary)'
              : (message.kind === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)'),
          },
        }, message === null ? '' : message.text))
        return React.createElement('div', { key: kind }, children)
      }

      const caModal = caOpen ? React.createElement('div', {
        style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
        onClick: cancelCaDialog,
      },
        React.createElement('div', {
          onClick: (e) => e.stopPropagation(),
          style: { background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '18px', width: '100%', maxWidth: '620px', maxHeight: '86vh', display: 'flex', flexDirection: 'column' },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' } },
            React.createElement('div', { style: { fontWeight: 600, fontSize: '16px' } }, 'Run Contingency Analysis'),
            React.createElement('button', { onClick: cancelCaDialog, style: { ...btn, padding: '2px 9px', fontSize: '14px' } }, '✕'),
          ),
          caForm !== null ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' } },
            React.createElement('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, 'Violation Check Loading (%):'),
            React.createElement('input', {
              type: 'number',
              min: 1,
              max: 1000,
              step: 1,
              value: caForm.overloadThreshold,
              onChange: (e) => setCaThreshold(e.target.value),
              title: 'A monitored branch whose post-contingency loading reaches this percentage is reported',
              style: { width: '92px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', textAlign: 'center' },
            }),
          ) : null,
          caCase !== null ? React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '10px' } }, 'Case: ' + caCase.displayName) : null,
          caLoading ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'Loading…') :
          caForm === null ? React.createElement('pre', { style: { ...mono, maxHeight: '180px', overflow: 'auto' } }, caDialogError || 'no run configuration available') :
          React.createElement('div', { style: { flex: '1 1 auto', overflowY: 'auto', minHeight: 0 } },
            caSection('contingency', 'Define Contingency Branches:', 'Consider all N-1 contingencies', 'User-defined contingency'),
            React.createElement('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', margin: '14px 0' } }),
            caSection('monitored', 'Define Monitored Branches:', 'Monitor all branches (default)', 'Monitor selected branches'),
          ),
          caWarning !== null ? React.createElement('div', { style: { marginTop: '10px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } }, '⚠ ' + caWarning) : null,
          caDialogError !== null && caForm !== null ? React.createElement('div', { style: { marginTop: '10px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } }, '⚠ ' + caDialogError) : null,
          React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '12px' } },
            React.createElement('button', { onClick: cancelCaDialog, disabled: caSaving, style: { ...btn, padding: '6px 22px', opacity: caSaving ? 0.6 : 1 } }, 'Cancel'),
            React.createElement('button', { onClick: okCaDialog, disabled: caSaving || caLoading || caFilesLoading || caForm === null, style: { ...btn, padding: '6px 26px', borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)', fontWeight: 600, opacity: (caSaving || caLoading || caFilesLoading || caForm === null) ? 0.6 : 1 } }, caSaving ? 'Saving…' : 'OK'),
          ),
        ),
      ) : null

      const optModal = optOpen ? React.createElement('div', {
        style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
        onClick: () => { if (!optSaving) setOptOpen(false) },
      },
        React.createElement('div', {
          onClick: (e) => e.stopPropagation(),
          style: { background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '16px', width: '100%', maxWidth: '760px', height: '70vh', display: 'flex', flexDirection: 'column' },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' } },
            React.createElement('div', { style: { fontWeight: 600 } }, 'Run AC Loadflow'),
            React.createElement('button', { onClick: () => setOptOpen(false), style: { ...btn, padding: '2px 9px', fontSize: '14px' } }, '✕'),
          ),
          optLoading ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'Loading…') :
          optError ? React.createElement('pre', { style: { ...mono, maxHeight: '180px', overflow: 'auto' } }, optError) :
          optForm !== null ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
            React.createElement('div', { style: { display: 'flex', gap: '2px', borderBottom: '1px solid var(--dsw-alias-border-l1)', marginBottom: '12px' } },
              OPT_TABS.map((t) => {
                const tabDisabled = t[0] === 'adj' && !optForm.includeAdjustments
                return React.createElement('button', {
                  key: t[0],
                  onClick: () => { if (!tabDisabled) setOptTab(t[0]) },
                  disabled: tabDisabled,
                  style: { ...btn, padding: '6px 12px', border: 'none', borderBottom: optTab === t[0] ? '2px solid var(--dsw-alias-brand-primary)' : '2px solid transparent', borderRadius: 0, background: 'transparent', color: optTab === t[0] ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)', fontWeight: optTab === t[0] ? 600 : 400, opacity: tabDisabled ? 0.4 : 1, cursor: tabDisabled ? 'not-allowed' : 'pointer' },
                }, t[1])
              }),
            ),
            React.createElement('div', { style: { flex: '1 1 auto', overflowY: 'auto', minHeight: 0, paddingRight: '4px' } }, renderOptTab()),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '12px' } },
              React.createElement('button', { onClick: () => setOptOpen(false), disabled: optSaving, style: btn }, 'Close'),
              React.createElement('button', { onClick: saveOptions, disabled: optSaving, style: { ...btn, borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)', opacity: optSaving ? 0.6 : 1 } }, optSaving ? 'Saving…' : 'Save'),
            ),
          ) : null,
        ),
      ) : null

      const reportModal = reportOpen ? React.createElement('div', {
        style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
        onClick: () => { if (!reportLoading) setReportOpen(false) },
      },
        React.createElement('div', {
          onClick: (e) => e.stopPropagation(),
          style: { background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '16px', width: '100%', maxWidth: '960px', height: '82vh', display: 'flex', flexDirection: 'column' },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' } },
            React.createElement('div', { style: { fontWeight: 600, fontSize: '15px' } }, (reportType === 'aclf' ? 'AC Loadflow Report' : 'NERC TPL-001-5 Report') + (reportName ? ' — ' + reportName : '')),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              React.createElement('button', { onClick: () => setReportView('rendered'), style: { ...btn, padding: '4px 10px', borderColor: reportView === 'rendered' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' } }, 'Rendered'),
              React.createElement('button', { onClick: () => setReportView('source'), style: { ...btn, padding: '4px 10px', borderColor: reportView === 'source' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' } }, 'Source'),
              React.createElement('button', { onClick: () => setReportOpen(false), style: { ...btn, padding: '2px 9px', fontSize: '14px' } }, '✕'),
            ),
          ),
          reportLoading ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'Generating report…') :
          reportError ? React.createElement('pre', { style: { ...mono, flex: '1 1 auto', overflow: 'auto', minHeight: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 } }, reportError) :
          React.createElement('div', { style: { flex: '1 1 auto', overflowY: 'auto', minHeight: 0, fontSize: '13px', lineHeight: '1.55' } },
            reportView === 'source'
              ? React.createElement('pre', { style: { ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 } }, reportMarkdown || '')
              : React.createElement('div', null, renderMarkdown(reportMarkdown || '')),
          ),
        ),
      ) : null

      if (activated === null) {
        return React.createElement('div', { style: { padding: '20px', color: 'var(--dsw-alias-label-secondary)' } }, 'Checking workspace…')
      }
      if (activated === false) {
        return React.createElement('div', { style: { padding: '20px', color: 'var(--dsw-alias-label-secondary)' } }, 'InterPSS is not available in this workspace. Please install iPSS Agent from GitHub first')
      }

      const diagramTipEl = diagramTip ? React.createElement('div', {
        style: {
          position: 'fixed', left: diagramTip.x + 12, top: diagramTip.y + 12,
          background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px',
          padding: '8px 10px', fontSize: '11px', lineHeight: '1.5', whiteSpace: 'pre',
          color: 'var(--dsw-alias-label-primary)', zIndex: 10000, pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)', maxWidth: '320px',
        },
      }, diagramTip.text) : null

      const caSummary = caResult && typeof caResult.caSummary === 'string' ? caResult.caSummary : null
      const hasNetworkInfo = !!caseNetworkInfo
      const hasCaInfo = !!caSummary
      const showInfoTabs = hasNetworkInfo || hasCaInfo
      const activeInfoTab = (infoTab === 'ca' && hasCaInfo) || !hasNetworkInfo ? 'ca' : 'network'
      const infoTabButton = (key, label) => React.createElement('button', {
        key: key,
        onClick: () => setInfoTab(key),
        style: { ...btn, padding: '5px 12px', border: 'none', borderBottom: activeInfoTab === key ? '2px solid var(--dsw-alias-brand-primary)' : '2px solid transparent', borderRadius: 0, background: 'transparent', color: activeInfoTab === key ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)', fontWeight: activeInfoTab === key ? 600 : 400 },
      }, label)
      const infoTabsPanel = showInfoTabs ? React.createElement('div', { style: { marginTop: '16px' } },
        React.createElement('div', { style: { display: 'flex', gap: '2px', borderBottom: '1px solid var(--dsw-alias-border-l1)', marginBottom: '8px' } },
          hasNetworkInfo ? infoTabButton('network', 'Network info') : null,
          hasCaInfo ? infoTabButton('ca', 'CA info') : null,
        ),
        React.createElement('pre', { style: { ...mono, ...panel, marginTop: 0, maxHeight: '340px' } }, activeInfoTab === 'ca' ? caSummary : caseNetworkInfo),
      ) : null

      const caPanel = (caResult !== null || caError !== null) ? React.createElement('div', { style: { marginTop: '16px' } },
        caResult !== null ? React.createElement('div', null,
          React.createElement('div', { style: { color: 'var(--dsw-alias-state-success-primary)', fontWeight: 600, marginBottom: '8px' } }, '✓ Contingency analysis complete'),
        ) : null,
        caError !== null ? React.createElement('pre', { style: { ...mono, ...panel, maxHeight: '200px', marginTop: 0 } }, '⚠ ' + caError) : null,
      ) : null

      return React.createElement('div', { style: { padding: '20px', maxWidth: '860px' } },
        React.createElement('h2', { style: { margin: '0 0 4px' } }, 'InterPSS'),
        React.createElement('p', { style: { margin: '0 0 16px', color: 'var(--dsw-alias-label-secondary)' } }, 'Power system simulation in the native AI env and a local sandbox.'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' } },
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } }, caseRow),
          caseInputRow ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', width: '100%' } }, caseInputRow) : null,
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } }, actionRow),
        ),
        picker,
        infoTabsPanel,
        caPanel,
        body,
        csvPanel,
        connModal,
        ctxMenuEl,
        caModal,
        optModal,
        reportModal,
        diagramTipEl,
      )
    }

    // --- ACLF tool-card result explorer ---------------------------------------
    // Owns the whole card for the `interpss_run_aclf` Tool through the
    // session-scoped `tool.call.toolview` slot (keyed by the wire Tool name).
    // A registered key REPLACES the generic tool row, so this renders in every
    // state — running, error, or a replayed log with no usable metadata — and
    // adds the Bus / Branch / Gen / Load explorer when that metadata allows.
    // Rows come from the same `interpss/readCsv` RPC the tab's explorer uses.
    const EXPLORER_KINDS = [
      { kind: 'bus', label: 'Bus' },
      { kind: 'branch', label: 'Branch' },
      { kind: 'gen', label: 'Gen' },
      { kind: 'load', label: 'Load' },
    ]
    const EXPLORER_PAGE = 100

    // Narrow the persisted metadata. Anything unexpected simply means "no
    // explorer" rather than a throw: replay may carry an older shape, and a
    // running call has no metadata yet.
    function aclfCardMeta(block) {
      if (block === null || block === undefined) return null
      if (!('kind' in block)) return null // still running
      if (block.isError === true) return null
      const meta = block.meta
      if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
      if (meta.ok !== true) return null
      if (typeof meta.resultDir !== 'string' || meta.resultDir === '') return null
      if (!Array.isArray(meta.files)) return null
      const files = meta.files.filter((name) => typeof name === 'string')
      if (files.length === 0) return null
      return {
        case: typeof meta.case === 'string' ? meta.case : '',
        resultDir: meta.resultDir,
        files: files,
        converged: meta.converged === true,
      }
    }

    // Clicking a header sorts by it (ascending first); clicking the sorted one flips the
    // direction. Pure, so the panel's state change stays a one-liner.
    function nextCsvSort(column, desc, clicked) {
      const name = String(clicked === null || clicked === undefined ? '' : clicked).trim()
      if (name === '') return { column: column, desc: desc === true }
      if (column !== null && String(column).toLowerCase() === name.toLowerCase()) {
        return { column: column, desc: !(desc === true) }
      }
      return { column: name, desc: false }
    }

    function explorerPathForKind(meta, kind) {
      const name = meta.files.filter((f) => f.indexOf('_DF_' + kind + '.csv') !== -1)[0]
      return name === undefined ? null : meta.resultDir + '/' + name
    }

    // The call head sits on the block itself while running and on `block.call`
    // once settled. Arguments are model-produced JSON: parse defensively and
    // fall back to an empty object.
    function aclfCallArgs(block) {
      if (block === null || block === undefined) return {}
      const call = 'kind' in block ? block.call : block
      if (call === null || call === undefined || typeof call.argsRaw !== 'string') return {}
      try {
        const parsed = JSON.parse(call.argsRaw)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      } catch (e) {}
      return {}
    }

    // The settled result's text, joined across every text block so a card never
    // silently loses its summary when the content layout is not exactly one block.
    function toolResultText(block) {
      if (block === null || block === undefined || !('kind' in block)) return null
      if (!Array.isArray(block.content)) return null
      const parts = []
      for (const part of block.content) {
        if (part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') parts.push(part.text)
      }
      return parts.length === 0 ? null : parts.join('\n')
    }

    // Gate (deliberately hook-free so the panel's hook order never depends on
    // the running -> settled transition).
    function AclfResultCard(props) {
      const block = props === null || props === undefined ? null : props.block
      const settled = block !== null && block !== undefined && ('kind' in block)
      return React.createElement(AclfResultPanel, {
        settled: settled,
        isError: settled && block.isError === true,
        meta: aclfCardMeta(block),
        args: aclfCallArgs(block),
        text: toolResultText(block),
        sessionId: props === null || props === undefined ? undefined : props.sessionId,
        callRemote: props === null || props === undefined ? undefined : props.callRemote,
        openFile: props === null || props === undefined ? undefined : props.openFile,
      })
    }

    // The CA card reuses the ACLF explorer for its single Contingency result: the
    // contingency CSV is what the tab's own Contingency tab pages through, so the same
    // `interpss/readCsv` endpoint serves both.
    function caCardMeta(block) {
      if (block === null || block === undefined) return null
      if (!('kind' in block)) return null
      if (block.isError === true) return null
      const meta = block.meta
      if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
      if (meta.ok !== true) return null
      if (typeof meta.resultDir !== 'string' || meta.resultDir === '') return null
      if (typeof meta.contingencyCsv !== 'string' || meta.contingencyCsv === '') return null
      return {
        case: typeof meta.case === 'string' ? meta.case : '',
        resultDir: meta.resultDir,
        files: [meta.contingencyCsv],
      }
    }

    const CA_EXPLORER_KINDS = [{ kind: 'contingency', label: 'Contingency' }]

    function CaResultCard(props) {
      const block = props === null || props === undefined ? null : props.block
      const settled = block !== null && block !== undefined && ('kind' in block)
      return React.createElement(AclfResultPanel, {
        settled: settled,
        isError: settled && block.isError === true,
        meta: caCardMeta(block),
        args: aclfCallArgs(block),
        text: toolResultText(block),
        kinds: CA_EXPLORER_KINDS,
        rowLabel: 'Explore result',
        label: 'InterPSS contingency analysis',
        showReport: false,
        // Overload rows are only useful worst-first; the header stays clickable to flip it.
        defaultSort: 'LoadingPercent',
        defaultSortDesc: true,
        sessionId: props === null || props === undefined ? undefined : props.sessionId,
        callRemote: props === null || props === undefined ? undefined : props.callRemote,
        openFile: props === null || props === undefined ? undefined : props.openFile,
      })
    }

    // --- Simple text tool-card views ------------------------------------------
    // Owns the cards for the InterPSS tools whose whole result is a short text
    // block (`interpss_case_load`, `interpss_network_info`). The shipped generic
    // row hides a tool's output behind an expand toggle, which left these
    // summaries invisible in the conversation. Hook-free, and it always renders
    // (a registered key replaces the generic row, so returning null would leave
    // an empty cell).
    function simpleCardMeta(block) {
      if (block === null || block === undefined) return null
      if (!('kind' in block)) return null
      if (block.isError === true) return null
      const meta = block.meta
      if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
      if (meta.ok !== true) return null
      return {
        case: typeof meta.case === 'string' ? meta.case : '',
        source: typeof meta.source === 'string' ? meta.source : '',
      }
    }

    function toolTextCard(label) {
      return function ToolTextCard(props) {
        const block = props === null || props === undefined ? null : props.block
        const settled = block !== null && block !== undefined && ('kind' in block)
        const failed = settled && block.isError === true
        const meta = simpleCardMeta(block)
        const text = toolResultText(block)
        const children = []
        if (typeof text === 'string' && text !== '') {
          // The rendered result already names the case and its source.
          children.push(React.createElement('pre', {
            key: 'text',
            style: {
              ...mono,
              ...panel,
              marginTop: 0,
              maxHeight: '340px',
              color: failed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
            },
          }, text))
        } else {
          const caseLabel = meta !== null && meta.case !== '' ? meta.case : ''
          children.push(React.createElement('div', {
            key: 'title',
            style: {
              fontSize: '12px',
              fontWeight: 600,
              color: failed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
            },
          }, (failed ? label + ' failed' : label) +
            (caseLabel === '' ? '' : ' — ' + caseLabel) +
            (settled ? '' : ' · running…')))
        }
        return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', margin: '4px 0 4px 4px' } }, children)
      }
    }

    const NetworkInfoCard = toolTextCard('InterPSS network info')
    const CaseLoadCard = toolTextCard('InterPSS case load')
    const CaseSummaryCard = toolTextCard('InterPSS case summary')
    // The script result is short: the applied script, the model digest with its load/gen
    // deltas, the script's return value or its stdout, and the failure with its line.
    const RunGvyCard = toolTextCard('InterPSS run script')
    // CA result is a short text block too: threshold, counts, inputs, result file.

    // The chat report *is* the summary, so no `interpss_case_summary` card is shown:
    // every settled, successful block renders nothing at all, whichever scope it is.
    // A keyed toolview replaces the whole tool row, so returning null removes the row
    // with it; a failed call always renders its error, and an unsettled call or a
    // replayed block without metadata falls back to the text card.
    function CaseSummaryRow(props) {
      const block = props === null || props === undefined ? null : props.block
      if (block !== null && block !== undefined && ('kind' in block) && block.isError !== true) {
        const meta = block.meta
        if (meta !== null && typeof meta === 'object' && !Array.isArray(meta) && meta.ok === true) return null
      }
      return React.createElement(CaseSummaryCard, { block: block })
    }

    // Report heading text for a case path: its file stem.
    function aclfReportName(casePath) {
      const slash = String(casePath).lastIndexOf('/')
      return String(casePath).slice(slash + 1).replace(/\.(ieee|raw|RAW)$/, '')
    }

    // Shared by the ACLF card and the CA card: the CA card passes a single Contingency
    // scope and no Report button, everything else (paging, scroll, error handling) is
    // the same machinery.
    function AclfResultPanel(props) {
      const meta = props.meta
      const callRemote = props.callRemote
      const sessionId = props.sessionId
      const kinds = Array.isArray(props.kinds) && props.kinds.length > 0 ? props.kinds : EXPLORER_KINDS
      const rowLabel = typeof props.rowLabel === 'string' && props.rowLabel !== '' ? props.rowLabel : 'Explore results'
      const cardLabel = typeof props.label === 'string' && props.label !== '' ? props.label : 'InterPSS AC load flow'
      const showReport = props.showReport !== false
      // The Host sorts before slicing the page, so an opened scope can start sorted (the
      // CA card opens worst-loading-first) and a header click re-reads page 0 sorted.
      const [sortColumn, setSortColumn] = React.useState(
        typeof props.defaultSort === 'string' && props.defaultSort !== '' ? props.defaultSort : null,
      )
      const [sortDesc, setSortDesc] = React.useState(props.defaultSortDesc === true)
      const [kind, setKind] = React.useState(null)
      const [header, setHeader] = React.useState(null)
      const [rows, setRows] = React.useState([])
      const [total, setTotal] = React.useState(0)
      const [hasMore, setHasMore] = React.useState(false)
      const [loading, setLoading] = React.useState(false)
      const [loadingMore, setLoadingMore] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [reportRunning, setReportRunning] = React.useState(false)
      const [reportError, setReportError] = React.useState(null)
      // Scroll fires repeatedly while a page is in flight; the state guard alone
      // re-renders a frame later, so a ref also gates the fetch to avoid
      // appending the same page twice.
      const loadingMoreRef = React.useRef(false)

      // Generate the AC Loadflow Markdown report from this run's CSVs, then open
      // it in the file surface. `reportType: 'aclf'` is explicit so a case that
      // also has a contingency CSV still yields the load-flow report.
      function generateReport() {
        if (reportRunning || meta === null) return
        setReportRunning(true)
        setReportError(null)
        callRemote('runReport', {
          input: meta.case,
          displayName: aclfReportName(meta.case),
          reportType: 'aclf',
          sessionId: sessionId,
        }).then(
          (res) => {
            setReportRunning(false)
            if (res && res.ok) {
              if (typeof props.openFile === 'function') {
                props.openFile('wspace/' + (res.resultDir || meta.resultDir) + '/AC_Loadflow_Report.md')
              }
              return
            }
            setReportError(res && res.error ? res.error : 'failed to generate the AC Loadflow report')
          },
          (err) => { setReportRunning(false); setReportError(String(err && err.message ? err.message : err)) },
        )
      }

      // Read page 0 of one scope with the given sort. The response reports the sort the
      // Host actually applied, so a column it could not find leaves the UI honest.
      function loadScope(scopeKind, sort) {
        setHeader(null)
        setRows([])
        setTotal(0)
        setHasMore(false)
        setError(null)
        if (meta === null) { setError('result metadata is unavailable for this card'); return }
        const path = explorerPathForKind(meta, scopeKind)
        if (path === null) { setError('result file not found for ' + scopeKind); return }
        setLoading(true)
        callRemote('readCsv', {
          path: path,
          sessionId: sessionId,
          start: 0,
          limit: EXPLORER_PAGE,
          sortColumn: sort === null || sort === undefined ? null : sort.column,
          sortDesc: sort === null || sort === undefined ? false : sort.desc === true,
        }).then(
          (res) => {
            setLoading(false)
            if (res && res.ok) {
              setHeader(res.header || null)
              setRows(res.rows || [])
              setTotal(res.totalRows || 0)
              setHasMore(!!res.hasMore)
              setSortColumn(typeof res.sortColumn === 'string' && res.sortColumn !== '' ? res.sortColumn : null)
              setSortDesc(res.sortDesc === true)
            } else {
              setError(res && res.error ? res.error : 'failed to read the ' + scopeKind + ' results')
            }
          },
          (err) => { setLoading(false); setError(String(err && err.message ? err.message : err)) },
        )
      }

      function openKind(next) {
        if (kind === next) {
          setKind(null)
          setHeader(null)
          setRows([])
          setTotal(0)
          setHasMore(false)
          setError(null)
          return
        }
        setKind(next)
        loadScope(next, { column: sortColumn, desc: sortDesc })
      }

      // Sort by a header cell: same column flips the direction, a new column starts
      // ascending, and an open table re-reads its first page in the new order.
      function changeSort(clicked) {
        const next = nextCsvSort(sortColumn, sortDesc, clicked)
        setSortColumn(next.column)
        setSortDesc(next.desc)
        if (kind !== null) loadScope(kind, next)
      }

      function loadMore() {
        if (loadingMoreRef.current || !hasMore || meta === null) return
        const path = explorerPathForKind(meta, kind)
        if (path === null) return
        loadingMoreRef.current = true
        setLoadingMore(true)
        callRemote('readCsv', {
          path: path,
          sessionId: sessionId,
          start: rows.length,
          limit: EXPLORER_PAGE,
          sortColumn: sortColumn,
          sortDesc: sortDesc,
        }).then(
          (res) => {
            loadingMoreRef.current = false
            setLoadingMore(false)
            if (res && res.ok) {
              setRows((prev) => prev.concat(res.rows || []))
              setTotal(res.totalRows || 0)
              setHasMore(!!res.hasMore)
            }
          },
          () => { loadingMoreRef.current = false; setLoadingMore(false) },
        )
      }

      // Auto-load the next page when the table is scrolled to the bottom,
      // matching the InterPSS tab's explorer (no explicit Load more control).
      function handleTableScroll(e) {
        const el = e.currentTarget
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) loadMore()
      }

      const args = props.args === null || props.args === undefined ? {} : props.args
      const caseArg = typeof args.case === 'string' ? args.case : ''
      const caseLabel = meta !== null && meta.case !== '' ? meta.case : caseArg
      const failed = props.isError === true
      const smallBtn = { ...btn, height: '26px', padding: '0 10px', fontSize: '12px' }

      const children = []
      if (typeof props.text === 'string' && props.text !== '') {
        // The rendered result already names the case and the convergence state.
        children.push(React.createElement('pre', {
          key: 'text',
          style: {
            ...mono,
            ...panel,
            marginTop: 0,
            maxHeight: '260px',
            color: failed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
          },
        }, props.text))
      } else {
        children.push(React.createElement('div', {
          key: 'title',
          style: {
            fontSize: '12px',
            fontWeight: 600,
            color: failed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
          },
        }, (failed ? cardLabel + ' failed' : cardLabel) +
          (caseLabel === '' ? '' : ' — ' + caseLabel) +
          (props.settled === true ? '' : ' · running…')))
      }
      if (meta !== null) {
        const head = [
          React.createElement('span', { key: 'explore', style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, rowLabel),
          ...kinds.map((entry) => React.createElement('button', {
            key: entry.kind,
            onClick: () => openKind(entry.kind),
            style: { ...smallBtn, borderColor: kind === entry.kind ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' },
          }, entry.label)),
        ]
        if (showReport) {
          head.push(
            React.createElement('span', {
              key: 'sep',
              style: { width: '1px', alignSelf: 'stretch', margin: '2px 4px', background: 'var(--dsw-alias-border-l1)' },
            }),
            React.createElement('button', {
              key: 'report',
              onClick: generateReport,
              disabled: reportRunning,
              title: 'Generate the AC Loadflow report from this run',
              style: { ...smallBtn, opacity: reportRunning ? 0.6 : 1 },
            }, reportRunning ? 'Generating…' : 'Report'),
          )
        }
        children.push(React.createElement('div', {
          key: 'head',
          style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginTop: '8px' },
        }, head))
      }
      if (kind !== null) {
        const status = error !== null
          ? String(error)
          : (loading || loadingMore ? 'loading…' : (total > 0 ? rows.length + ' of ' + total + ' rows' : 'no rows'))
        children.push(React.createElement('div', {
          key: 'status',
          style: { ...mono, fontSize: '11px', marginTop: '6px', color: error !== null ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)' },
        }, status))
      }
      if (header && rows.length > 0) {
        const headerCols = String(header).split(',')
        children.push(React.createElement('div', {
          key: 'table',
          style: { marginTop: '6px', maxHeight: '320px', overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)' },
          onScroll: handleTableScroll,
        }, React.createElement('table', { style: { ...tableStyle, marginTop: 0 } },
          React.createElement('thead', null,
            React.createElement('tr', null, headerCols.map((h, i) => {
              const label = String(h).trim()
              const active = sortColumn !== null && String(sortColumn).toLowerCase() === label.toLowerCase()
              return React.createElement('th', {
                key: i,
                onClick: () => changeSort(label),
                title: 'Sort by ' + label,
                style: { ...thStyle, cursor: 'pointer', userSelect: 'none' },
              }, h + (active ? (sortDesc ? ' \u25bc' : ' \u25b2') : ''))
            }))),
          React.createElement('tbody', null,
            rows.map((line, ri) => React.createElement('tr', { key: ri },
              String(line).split(',').map((cell, ci) => React.createElement('td', { key: ci, style: tdStyle }, formatValue(cell)))))),
        )))
      }
      if (reportError !== null) {
        children.push(React.createElement('div', {
          key: 'report-error',
          style: { ...mono, fontSize: '11px', marginTop: '6px', color: 'var(--dsw-alias-state-error-primary)' },
        }, 'AC Loadflow report failed: ' + String(reportError)))
      }
      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', margin: '4px 0 4px 4px' } }, children)
    }

    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'interpss', order: 1, label: 'InterPSS' },
      (props) => React.createElement(InterPssView, { sessionId: props && props.sessionId, callRemote: callRemote }),
    ))
    slots.inject('tool.call.toolview', () => slots.register(
      { name: 'tool.call.toolview', key: 'interpss_run_aclf' },
      (props) => React.createElement(AclfResultCard, {
        block: props && props.block,
        sessionId: props && props.sessionId,
        callRemote: callRemote,
        openFile: props && props.openFile,
      }),
    ))
    slots.inject('tool.call.toolview', () => slots.register(
      { name: 'tool.call.toolview', key: 'interpss_network_info' },
      (props) => React.createElement(NetworkInfoCard, { block: props && props.block }),
    ))
    slots.inject('tool.call.toolview', () => slots.register(
      { name: 'tool.call.toolview', key: 'interpss_case_load' },
      (props) => React.createElement(CaseLoadCard, { block: props && props.block }),
    ))
    slots.inject('tool.call.toolview', () => slots.register(
      { name: 'tool.call.toolview', key: 'interpss_case_summary' },
      (props) => React.createElement(CaseSummaryRow, { block: props && props.block }),
    ))
    slots.inject('tool.call.toolview', () => slots.register(
      { name: 'tool.call.toolview', key: 'interpss_run_gvy' },
      (props) => React.createElement(RunGvyCard, { block: props && props.block }),
    ))
    slots.inject('tool.call.toolview', () => slots.register(
      { name: 'tool.call.toolview', key: 'interpss_run_ca' },
      (props) => React.createElement(CaResultCard, {
        block: props && props.block,
        sessionId: props && props.sessionId,
        callRemote: callRemote,
        openFile: props && props.openFile,
      }),
    ))
  },
}

    return module.exports;
  }
});
