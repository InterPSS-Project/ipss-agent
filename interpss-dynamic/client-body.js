return {
  inject: ['slots'],
  apply(ctx) {
    const callRemote = (method, input) => host.call('interpss/' + method, input || {}).then((value) => value)
    const PRESETS = [
      { label: 'IEEE 118-bus', format: 'ieee', input: 'data/ieee/Ieee118Bus/ieee118.ieee' },
      { label: 'IEEE 14-bus', format: 'ieee', input: 'data/ieee/Ieee14Bus/ieee14.ieee' },
      { label: 'Texas 2K-bus', format: 'psse', input: 'data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW' },
    ]

    let lastSelection = { mode: '0', customFormat: 'ieee', customInput: '' }
    let checkSeq = 0
    let reportSeq = 0

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
      padding: '7px 14px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer',
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

    function formatValue(v) {
      const s = v == null ? '' : String(v)
      const t = s.trim()
      if (t === '') return s
      // only touch plain-decimal or scientific numeric strings (e.g. -0.51, 3.4E-4)
      if (!/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return s
      const mantissa = t.split(/[eE]/)[0]
      const dot = mantissa.indexOf('.')
      if (dot === -1) return s
      if (mantissa.length - dot - 1 <= 4) return s
      const n = Number(t)
      if (!Number.isFinite(n)) return s
      return String(parseFloat(n.toFixed(4)))
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

    function renderCsvTable(header, rows, busCols, onBusDoubleClick, formatNumbers) {
      if (!header) return null
      const headerCols = header.split(',')
      const isBusCol = (ci) => busCols && onBusDoubleClick && busCols.indexOf(ci) !== -1
      return React.createElement('table', { style: tableStyle },
        React.createElement('thead', null,
          React.createElement('tr', null, headerCols.map((h, i) => React.createElement('th', { key: i, style: thStyle }, h))),
        ),
        React.createElement('tbody', null,
          (rows || []).map((r, ri) => React.createElement('tr', { key: ri }, r.split(',').map((c, ci) => {
            const display = formatNumbers ? formatValue(c) : c
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

    function renderBusTable(header, rows, selectedBus, onSelect, onContextMenu) {
      if (!header) return null
      const headerCols = header.split(',')
      return React.createElement('table', { style: tableStyle },
        React.createElement('thead', null,
          React.createElement('tr', null, headerCols.map((h, i) => React.createElement('th', { key: i, style: thStyle }, h))),
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
      const [reportView, setReportView] = React.useState('rendered')
      const [reportAvailable, setReportAvailable] = React.useState(false)

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
        if (input === '') return
        callRemote('checkResult', { input, sessionId }).then(
          (res) => {
            if (seq !== checkSeq) return
            if (res && res.ok && res.exists && res.converged) {
              setResult({
                ok: true,
                loaded: true,
                networkInfo: res.networkInfo,
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

      function currentCsvPath() {
        if (csvSel === null || result === null) return null
        const fileName = result && result.files ? result.files.find((f) => f.indexOf('_DF_' + csvSel + '.csv') !== -1) : undefined
        if (fileName === undefined) return null
        return result.resultDir + '/' + fileName
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
          return
        }
        setCsvSel(kind)
        setCsvHeader(null)
        setCsvRows([])
        setCsvTotal(0)
        setCsvHasMore(false)
        setCsvError(null)
        setCsvLoading(true)
        const fileName = result && result.files ? result.files.find((f) => f.indexOf('_DF_' + kind + '.csv') !== -1) : undefined
        if (fileName === undefined) {
          setCsvLoading(false)
          setCsvError('result file not found for ' + kind)
          return
        }
        callRemote('readCsv', { path: result.resultDir + '/' + fileName, sessionId, start: 0, limit: 200 }).then(
          (res) => {
            setCsvLoading(false)
            if (res && res.ok) {
              setCsvHeader(res.header)
              setCsvRows(res.rows || [])
              setCsvTotal(res.totalRows || 0)
              setCsvHasMore(!!res.hasMore)
            } else {
              setCsvError(res && res.error ? res.error : 'failed to read result file')
            }
          },
          (err) => { setCsvLoading(false); setCsvError(String(err && err.message ? err.message : err)) },
        )
      }

      function loadMoreCsv() {
        if (csvLoadingMore || !csvHasMore) return
        const path = currentCsvPath()
        if (path === null) return
        setCsvLoadingMore(true)
        callRemote('readCsv', { path, sessionId, start: csvRows.length, limit: 200 }).then(
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
        callRemote('getAclfOptions', { sessionId }).then(
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
        callRemote('saveAclfOptions', { config: next, sessionId }).then(
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

      const selectStyle = { padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' }
      const controls = [
        React.createElement('span', { key: 'case-label', style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, 'Simu Case:'),
        React.createElement('select', { key: 'case', value: mode, onChange: (e) => { const m = e.target.value; lastSelection.mode = m; setMode(m); onCaseChanged(m === 'custom' ? customInput.trim() : (PRESETS[Number(m)] ? PRESETS[Number(m)].input : '')) }, style: selectStyle }, options),
      ]
      if (isCustom) {
        controls.push(
          React.createElement('select', { key: 'fmt', value: customFormat, onChange: (e) => { const f = e.target.value; lastSelection.customFormat = f; setCustomFormat(f); onCaseChanged(customInput.trim()) }, style: { ...selectStyle, marginLeft: '8px' } },
            React.createElement('option', { value: 'ieee' }, 'IEEE CDF'),
            React.createElement('option', { value: 'psse' }, 'PSS/E RAW'),
          ),
          React.createElement('div', { key: 'pathbox', style: { display: 'flex', alignItems: 'stretch', marginLeft: '8px', flex: '1 1 260px', minWidth: 0 } },
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
        )
      }
      controls.push(
        React.createElement('div', { key: 'run-group', style: { display: 'flex', alignItems: 'center', marginLeft: '8px' } },
          React.createElement('button', { onClick: run, disabled: running, style: { ...btn, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none', opacity: running ? 0.6 : 1 } }, running ? 'Running…' : 'ACLF'),
          React.createElement('button', {
            onClick: openOptions,
            title: 'AC Loadflow options',
            'aria-label': 'AC Loadflow options',
            style: { ...btn, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '7px 10px' },
          }, gearIcon),
          React.createElement('button', { onClick: runReport, disabled: running || reportLoading || !reportAvailable, style: { ...btn, marginLeft: '12px', opacity: (running || reportLoading || !reportAvailable) ? 0.6 : 1 } }, reportLoading ? 'Generating…' : 'Report'),
        ),
        optSaved ? React.createElement('span', { key: 'optsaved', style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' } }, '✓ Options saved') : null,
      )

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

      let body = null
      if (result !== null) {
        if (result.ok) {
          body = React.createElement('div', null,
            React.createElement('div', { style: { color: 'var(--dsw-alias-state-success-primary)', fontWeight: 600, marginBottom: '8px' } }, '✓ Load flow converged'),
            result.networkInfo ? React.createElement('pre', { style: { ...mono, ...panel, maxHeight: '340px' } }, result.networkInfo) : null,
            React.createElement('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, 'Results written to: ' + result.resultDir),
            React.createElement('div', { style: { marginTop: '4px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, 'Files: ' + (result.files ? result.files.join(', ') : '')),
            React.createElement('div', { style: { marginTop: '12px' } },
              React.createElement('div', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', marginBottom: '6px' } }, 'Explore result files:'),
              React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                ['bus', 'branch', 'gen', 'load'].map((kind) =>
                  React.createElement('button', {
                    key: kind,
                    onClick: () => openCsv(kind),
                    style: { ...btn, padding: '5px 10px', borderColor: csvSel === kind ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' },
                  }, kind.charAt(0).toUpperCase() + kind.slice(1)),
                ),
              ),
            ),
            csvLoading ? React.createElement('div', { style: { marginTop: '8px', color: 'var(--dsw-alias-label-secondary)' } }, 'Loading…') : null,
            csvError ? React.createElement('pre', { style: { ...mono, ...panel, maxHeight: '200px' } }, csvError) : null,
            csvHeader !== null ? React.createElement('div', null,
              React.createElement('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, csvHasMore ? 'Showing ' + csvRows.length + ' of ' + csvTotal + ' rows (scroll for more)' : 'Total rows: ' + csvTotal),
              React.createElement('div', { style: { marginTop: '6px', maxHeight: '320px', overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)' }, onScroll: handleCsvScroll }, csvSel === 'bus' ? renderBusTable(csvHeader, csvRows, selectedBus, selectBus, busRowContextMenu) : (csvSel === 'gen' || csvSel === 'load') ? renderCsvTable(csvHeader, csvRows, [0], handleBusDoubleClick) : renderCsvTable(csvHeader, csvRows, undefined, undefined, true)),
              csvLoadingMore ? React.createElement('div', { style: { marginTop: '6px', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, 'Loading more…') : null,
              csvSel === 'bus' && selectedBus !== null ? React.createElement('div', { style: { marginTop: '8px' } },
                React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, 'Selected bus: ' + selectedBus),
              ) : null,
            ) : null,
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
      const optRow = (label, control) => React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px' } },
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
            optRow('Delta Voltage Ang Limit', optNum('deltaVAngLimit', '150px')),
            optRow('Delta Voltage Mag Limit', optNum('deltaVMagLimit', '150px')),
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
            React.createElement('div', { style: { fontWeight: 600, fontSize: '15px' } }, 'NERC TPL-001-5 Report' + (reportName ? ' — ' + reportName : '')),
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

      return React.createElement('div', { style: { padding: '20px', maxWidth: '860px' } },
        React.createElement('h2', { style: { margin: '0 0 4px' } }, 'InterPSS'),
        React.createElement('p', { style: { margin: '0 0 16px', color: 'var(--dsw-alias-label-secondary)' } }, 'Power system simulation in the native AI env and a local sandbox.'),
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } }, controls),
        picker,
        body,
        connModal,
        ctxMenuEl,
        optModal,
        reportModal,
        diagramTipEl,
      )
    }

    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'interpss', order: 1, label: 'InterPSS' },
      (props) => React.createElement(InterPssView, { sessionId: props && props.sessionId, callRemote: callRemote }),
    ))
  },
}
