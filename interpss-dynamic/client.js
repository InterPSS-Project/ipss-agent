return {
  inject: ['slots', 'timer'],
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
    let diagramSeq = 0
    let diagramLoadSeq = 0
    // The diagram the Diagram tab last opened. Kept beside `lastSelection` because it has
    // to outlive the view: switching to another conversation view unmounts this one, and
    // coming back should land on the same diagram rather than the folder's first.
    let diagramChoice = ''
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

    // The case the InterPSS tab has selected, derived from its picker state. The InterPSS
    // tab owns "the current simulation case"; the Diagram tab only follows it, so the
    // selection is shared here rather than being asked of the Host. One conversation view
    // is mounted at a time, so a plain module-level value is enough: the Diagram tab seeds
    // from it when it mounts, and every `onCaseChanged` keeps it current.
    function selectionCaseInput() {
      if (lastSelection.mode === 'custom') return lastSelection.customInput.trim()
      const p = PRESETS[Number(lastSelection.mode)]
      return p ? p.input : ''
    }
    let selectedCaseInput = selectionCaseInput()

    // Adopt a case the Host holds into the shared selection. The InterPSS picker does this
    // with its own UI bookkeeping (`adoptBridgeCase`); the Diagram tab needs only the
    // picker state to follow, so that opening the InterPSS tab lands on the same case.
    function adoptSelectedCase(input) {
      const selection = bridgeCaseSelection(input)
      lastSelection.mode = selection.mode
      lastSelection.customInput = selection.customInput === '' ? lastSelection.customInput : selection.customInput
      lastSelection.customFormat = selection.customFormat
      selectedCaseInput = input
    }

    // Which diagram the Diagram tab shows for a case: the one the user last opened
    // (`remembered`) while it is still in the folder, else the first. An empty folder is
    // null, which the tab renders as "no diagram yet" rather than as an empty preview.
    // Pure — the remembered path is passed in — so the guard can exercise it directly.
    function drawioTabChoice(files, remembered) {
      if (!Array.isArray(files) || files.length === 0) return null
      const kept = files.find((f) => f !== null && typeof f === 'object' && f.path === remembered)
      if (kept !== undefined) return kept.path
      const first = files[0]
      return first !== null && typeof first === 'object' && typeof first.path === 'string' && first.path !== ''
        ? first.path
        : null
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
    // The draw.io app mark, drawn inline: the toolbar must work offline and the app page CSP
    // cannot be assumed, so there is no remote image here. Orange tile, white two-node flow.
    const drawioAppIcon = React.createElement('svg',
      { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { display: 'block' } },
      React.createElement('rect', { x: 0.75, y: 0.75, width: 14.5, height: 14.5, rx: 3.5, fill: '#F08705' }),
      React.createElement('path', { d: 'M4.3 4.3h3v3h-3z M8.7 8.7h3v3h-3z', fill: '#FFFFFF' }),
      React.createElement('path', { d: 'M7.3 5.8h2.9v2.9', fill: 'none', stroke: '#FFFFFF', strokeWidth: 1.2 }),
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

    // A percent as the tooltip says it: one decimal at most, and no pointless `.0` (`59%`, not
    // `59.0%`). Anything that is not a number is "not available", and the line is left out.
    function loadingText(value) {
      const n = parseFloat(String(value === undefined || value === null ? '' : value).trim())
      if (!Number.isFinite(n)) return null
      return (Math.round(n * 10) / 10) + '%'
    }

    // `extra.contingencyLoading` is the worst contingency loading for this branch, which only the
    // Diagram tab has (it reads the CA result table for the flags); the connection diagram passes
    // nothing and simply gets no contingency line. The base-case loading comes from the branch table
    // the row itself came from, so it shows wherever that table is the source -- and neither line
    // appears for a table without those columns.
    function branchTooltip(r, extra) {
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
      const basecase = loadingText(r[24])
      const contingency = extra === undefined || extra === null ? null : loadingText(extra.contingencyLoading)
      if (basecase !== null || contingency !== null) {
        lines.push('')
        if (basecase !== null) lines.push('Basecase Loading(%): ' + basecase)
        if (contingency !== null) lines.push('Contingency Loading(%): ' + contingency)
      }
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

    // Clicking a header sorts by it (ascending first); clicking the sorted one flips the
    // direction. Pure, so the panel's state change stays a one-liner. Shared by the tab's
    // result table and the ACLF explorer card, so it lives in the tab body.
    function nextCsvSort(column, desc, clicked) {
      const name = String(clicked === null || clicked === undefined ? '' : clicked).trim()
      if (name === '') return { column: column, desc: desc === true }
      if (column !== null && String(column).toLowerCase() === name.toLowerCase()) {
        return { column: column, desc: !(desc === true) }
      }
      return { column: name, desc: false }
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

    // `decimals` maps a SOURCE column index (not a position in `idx`) to the decimal
    // places its cell shows — for the columns the CSV carries as full-precision floats
    // (PFrom2To / QFrom2To / QGen), so they read like the bus table instead of 17
    // digits. `formatValue` shortens only a value carrying more decimals than asked,
    // so an already-short column is left exactly as the Host sent it.
    function renderConnTable(header, rows, idx, decimals) {
      const cols = idx || [4, 6, 7, 9, 11, 12, 13, 14, 19, 20, 24]
      const places = decimals || {}
      const hdr = cols.map((i) => (header && header[i] != null ? header[i] : ''))
      return React.createElement('table', { style: tableStyle },
        React.createElement('thead', null,
          React.createElement('tr', null, hdr.map((h, i) => React.createElement('th', { key: i, style: thStyle }, h))),
        ),
        React.createElement('tbody', null,
          (rows || []).map((r, ri) => React.createElement('tr', { key: ri },
            cols.map((i) => {
              const raw = r[i] != null ? r[i] : ''
              const d = places[i]
              return React.createElement('td', { key: i, style: tdStyle }, d != null ? formatValue(raw, d) : raw)
            }),
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

    // --- draw.io preview -------------------------------------------------------
    // The Diagram tab reads a .drawio file over `interpss/readDrawio` and renders it as
    // inline SVG. The renderer is deliberately self-contained and offline:
    // the harness forbids frames (`frame-src 'none'` in the preview CSP) and the app
    // page CSP cannot be assumed, so an embedded draw.io viewer is not an option. It
    // covers the subset these workspaces' diagrams use — rounded rectangles, ellipses,
    // text labels, groups and orthogonal edges — and degrades an unknown shape to a
    // rectangle instead of failing.

    // draw.io stores a diagram either as plain XML or as base64(raw-deflate(uri-encoded
    // XML)). Both round-trip here; the compressed form needs DecompressionStream.
    function diagramXmlFrom(raw) {
      const text = String(raw === null || raw === undefined ? '' : raw).trim()
      if (text === '') return Promise.reject(new Error('the diagram file is empty'))
      if (/<mxGraphModel|<mxfile/i.test(text)) return Promise.resolve(text)
      if (typeof DecompressionStream !== 'function') {
        return Promise.reject(new Error('this diagram is stored compressed and DecompressionStream is unavailable — re-save it uncompressed in draw.io'))
      }
      let bytes
      try {
        const bin = atob(text.replace(/\s+/g, ''))
        bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
      } catch (e) {
        return Promise.reject(new Error('unrecognized diagram encoding'))
      }
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Response(stream).text().then(
        (xml) => { try { return decodeURIComponent(xml) } catch (e) { return xml } },
        () => { throw new Error('could not inflate the diagram — re-save it uncompressed in draw.io') },
      )
    }

    function styleMap(style) {
      const out = {}
      const parts = String(style === null || style === undefined ? '' : style).split(';')
      for (const part of parts) {
        if (part === '') continue
        const eq = part.indexOf('=')
        if (eq === -1) out[part] = '1'
        else out[part.slice(0, eq)] = part.slice(eq + 1)
      }
      return out
    }

    function numOr(value, fallback) {
      const n = typeof value === 'number' ? value : parseFloat(value)
      return Number.isFinite(n) ? n : fallback
    }

    // A cell label is plain text or light HTML; keep the line structure, drop the markup.
    function labelLines(value) {
      if (value === null || value === undefined || value === '') return []
      return String(value)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#10;/g, '\n')
        .replace(/&amp;/gi, '&')
        .split('\n')
    }

    // mxGraph's default stroke, for a cell whose style names no strokeColor. It was a
    // slate gray, which painted the 2 edges in this workspace's diagram that omit
    // strokeColor in a different color from the other 25 (docs/oneline-diagram-process.md).
    const DRAWIO_STROKE = '#000000'
    const DRAWIO_TEXT = '#111827'
    const DRAWIO_PAD = 20
    // The preview is O(cells) React elements, so this bounds what it will attempt. A 2000-bus case
    // has to fit — Texas 2K is 2000 bars + 3220 branches + 861 transformer symbols = ~10.7k cells
    // — and 20000 leaves room above that without letting a pathological file lock the tab up.
    const DRAWIO_MAX_CELLS = 20000
    // Tooltip hit areas. A branch is a 1.5px line and a bus bar is 6px wide, so the drawn
    // geometry is impractical to hover; each interactive cell also emits an invisible shape
    // with this stroke width, or a transparent rect padded by this many scene units.
    const DRAWIO_HIT_STROKE = 10
    const DRAWIO_HIT_PAD = 4

    // A draw.io model carries its own palette, and these one-line diagrams are ink on paper:
    // white surfaces, black strokes and text, a few greys. Painting that literally drops a
    // glaring white slab with black lines into the dark theme. The grayscale part of the
    // palette is therefore re-expressed as theme tokens — paper -> the app surface, ink ->
    // the app foreground, mid greys -> the secondary label colour — so the preview follows
    // the active theme in both directions. Tokens rather than a computed colour on purpose:
    // both palettes ship in the stylesheets, so this needs no theme detection, no extra
    // service dependency, and it re-colours instantly when the theme switches.
    //
    // Only near-grayscale values are re-mapped. A saturated colour is left exactly as
    // authored, because a deliberately coloured element (a red bus, a blue tie) must keep
    // its identity in either theme.
    const DRAWIO_PAPER = 'var(--dsw-alias-bg-layer-1)'
    const DRAWIO_INK = 'var(--dsw-alias-label-primary)'
    const DRAWIO_MID = 'var(--dsw-alias-label-secondary)'

    function drawioHexBytes(color) {
      if (typeof color !== 'string') return null
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
      if (m === null) return null
      const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    }

    // Grayscale in -> a theme token out; anything else (a colour, 'none', an already-token
    // value) passes through untouched.
    function drawioThemeColor(color) {
      const rgb = drawioHexBytes(color)
      if (rgb === null) return color
      const r = rgb[0] / 255
      const g = rgb[1] / 255
      const b = rgb[2] / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const lum = (max + min) / 2
      const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lum - 1))
      // The extremes are decided by lightness ALONE, before the saturation test: HSL
      // saturation is ill-conditioned near black and white, so draw.io's default near-black
      // text colour #111827 computes as 39% "saturated" while reading as plain ink. Testing
      // saturation first left every default label near-black on a dark canvas.
      if (lum >= 0.9) return DRAWIO_PAPER
      if (lum <= 0.18) return DRAWIO_INK
      if (sat > 0.25) return color
      return DRAWIO_MID
    }

    // --- the one-line diagram config (0.6.26) --------------------------------
    // config/net_diagram.json holds three flag families for the PREVIEW: the bus voltage band and
    // its colour, and a flow percent + colour for the base case and for contingencies. The file is
    // the Host's to write (the gear dialog asks it to); this side only needs the same defaults and
    // the same validation, so a missing or broken file still paints the familiar red, and a value
    // the dialog accepts is a value the Host will keep.
    const DRAWIO_NET_DEFAULTS = {
      Bus_flag_upper_limit: 1.1,
      Bus_flag_lower_limit: 0.9,
      Bus_flag_color: 'red',
      Basecase_branch_flow_flag_percent: 80.0,
      Basecase_branch_flow_flag_color: 'green',
      Contingency_branch_flow_flag_percent: 100.0,
      Contingency_branch_flow_flag_color: 'blue',
      Show_birdseye_view: true,
    }
    const DRAWIO_COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([^)]*\)|hsla?\([^)]*\))$/i
    // The seven keys the dialog edits, in the order the file carries them, with the label the
    // dialog shows and the bounds the form checks. One table drives the form, the validation and
    // the sanitizer, so they cannot drift apart.
    const DRAWIO_NET_FIELDS = [
      { key: 'Bus_flag_upper_limit', label: 'Bus flag: upper limit (pu)', kind: 'number', min: 0.05, max: 5.0, step: 0.01 },
      { key: 'Bus_flag_lower_limit', label: 'Bus flag: lower limit (pu)', kind: 'number', min: 0.05, max: 5.0, step: 0.01 },
      { key: 'Bus_flag_color', label: 'Bus flag colour', kind: 'color' },
      { key: 'Basecase_branch_flow_flag_percent', label: 'Base-case branch flow flag (%)', kind: 'number', min: 0, max: 1000, step: 1 },
      { key: 'Basecase_branch_flow_flag_color', label: 'Base-case branch colour', kind: 'color' },
      { key: 'Contingency_branch_flow_flag_percent', label: 'Contingency branch flow flag (%)', kind: 'number', min: 0, max: 1000, step: 1 },
      { key: 'Contingency_branch_flow_flag_color', label: 'Contingency branch colour', kind: 'color' },
      { key: 'Show_birdseye_view', label: 'Show the birdseye view', kind: 'boolean' },
    ]

    // Server values pasted over the defaults, with every unknown key kept: the file is hand-editable
    // and a save must not throw away what the dialog does not show.
    function drawioNetConfig(raw) {
      const out = Object.assign({}, DRAWIO_NET_DEFAULTS)
      const src = raw !== null && raw !== undefined && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      for (const key of Object.keys(src)) out[key] = src[key]
      for (const field of DRAWIO_NET_FIELDS) {
        const value = out[field.key]
        if (field.kind === 'number') {
          const n = Number(value)
          out[field.key] = Number.isFinite(n) ? Math.min(field.max, Math.max(field.min, n)) : DRAWIO_NET_DEFAULTS[field.key]
        } else if (field.kind === 'boolean') {
          // A switch is on unless it was explicitly turned off: `false`, or the word, from a hand edit.
          const off = value === false || value === 0 || String(value).trim().toLowerCase() === 'false'
          const on = value === true || value === 1 || String(value).trim().toLowerCase() === 'true'
          out[field.key] = off ? false : (on ? true : DRAWIO_NET_DEFAULTS[field.key])
        } else {
          const text = typeof value === 'string' ? value.trim() : ''
          out[field.key] = DRAWIO_COLOR_RE.test(text) ? text : DRAWIO_NET_DEFAULTS[field.key]
        }
      }
      if (!(out.Bus_flag_lower_limit < out.Bus_flag_upper_limit)) {
        out.Bus_flag_lower_limit = DRAWIO_NET_DEFAULTS.Bus_flag_lower_limit
        out.Bus_flag_upper_limit = DRAWIO_NET_DEFAULTS.Bus_flag_upper_limit
      }
      return out
    }

    // The band, spelled the way every surface that mentions it must spell it: the filter dialog's
    // checkbox, its live count, the toolbar's filter label and the bus tooltip all read the config,
    // so a user who changes the band in the gear dialog sees that change everywhere at once (0.6.27).
    function drawioBandText(config) {
      const cfg = drawioNetConfig(config)
      return '|V| outside ' + cfg.Bus_flag_lower_limit + '\u2013' + cfg.Bus_flag_upper_limit + ' pu'
    }

    // The flow thresholds, spelled for the two surfaces that quote them: the Filter dialog's
    // checkboxes and the sentence that reports what the filter kept. `which` is 'basecase' or
    // 'contingency' -- the two families the dialog can filter on (0.6.32).
    function drawioLoadingThresholdText(config, which) {
      const cfg = drawioNetConfig(config)
      const pct = which === 'contingency'
        ? cfg.Contingency_branch_flow_flag_percent
        : cfg.Basecase_branch_flow_flag_percent
      return (which === 'contingency' ? 'contingency' : 'base-case') + ' loading \u2265 ' + pct + '%'
    }

    // What stops OK: one message per offending field, or none. Kept separate from the sanitizer
    // above, because a form should say WHY rather than silently clamp behind the user's back.
    function drawioNetConfigErrors(form) {
      const out = {}
      const src = form === null || form === undefined ? {} : form
      for (const field of DRAWIO_NET_FIELDS) {
        const value = src[field.key]
        if (field.kind === 'number') {
          const n = Number(value)
          if (String(value === null || value === undefined ? '' : value).trim() === '' || !Number.isFinite(n)) {
            out[field.key] = 'a number is required'
          } else if (n < field.min || n > field.max) {
            out[field.key] = 'must be between ' + field.min + ' and ' + field.max
          }
        } else if (field.kind === 'boolean') {
          // a switch is never wrong: it is on, or it is off
          continue
        } else {
          const text = typeof value === 'string' ? value.trim() : ''
          if (text === '') out[field.key] = 'a colour is required'
          else if (!DRAWIO_COLOR_RE.test(text)) out[field.key] = 'a CSS colour name, #hex or rgb()'
        }
      }
      const lower = Number(src.Bus_flag_lower_limit)
      const upper = Number(src.Bus_flag_upper_limit)
      if (out.Bus_flag_lower_limit === undefined && out.Bus_flag_upper_limit === undefined
        && Number.isFinite(lower) && Number.isFinite(upper) && !(lower < upper)) {
        out.Bus_flag_upper_limit = 'the upper limit must be above the lower limit'
      }
      return out
    }

    // A tiny CSV header lookup: the column index for `name`, or -1. Every table read here goes
    // through it, because a positional read would silently flag the wrong branches in a reordered
    // table (the same rule the voltage and area/zone columns follow).
    function drawioColIndex(header, name) {
      const cells = String(header === null || header === undefined ? '' : header).split(',')
      for (let i = 0; i < cells.length; i += 1) {
        if (String(cells[i]).trim().toLowerCase() === name) return i
      }
      return -1
    }

    // Loadings keyed the way the branch index keys them (both bus ids lowercased and sorted, joined
    // with `|`), each carrying the highest loading among parallel circuits (or among contingencies).
    // EVERY row is kept, whatever the display thresholds say: the tooltip quotes what the tables hold
    // -- "when available" -- while the paint and the status counts apply the configured thresholds.
    // Filtering here instead (0.6.30) hid a 70% contingency from the tooltip whenever the flag
    // threshold was 100%, which is exactly the case the tables are read for.
    function drawioMaxByPair(rows, percentAt, pairAt) {
      const out = {}
      if (percentAt < 0 || !Array.isArray(rows)) return out
      for (const line of rows) {
        const c = String(line).split(',')
        const loading = parseFloat(String(c[percentAt] === undefined ? '' : c[percentAt]).trim())
        if (!Number.isFinite(loading)) continue
        const pair = pairAt(c)
        if (pair === null) continue
        if (out[pair] === undefined || loading > out[pair]) out[pair] = loading
      }
      return out
    }

    // The base-case flags, from `<stem>_DF_branch.csv`: `FromBusID`/`ToBusID` give the pair, and
    // `Loading%` gives the loading, all by header NAME.
    function drawioBranchLoads(header, rows) {
      const iFrom = drawioColIndex(header, 'frombusid')
      const iTo = drawioColIndex(header, 'tobusid')
      const iLoading = drawioColIndex(header, 'loading%')
      return drawioMaxByPair(rows, iLoading, (c) => {
        const from = String(c[iFrom] === undefined ? '' : c[iFrom]).trim().toLowerCase()
        const to = String(c[iTo] === undefined ? '' : c[iTo]).trim().toLowerCase()
        if (iFrom < 0 || iTo < 0 || !drawioIsBusCell(from) || !drawioIsBusCell(to)) return null
        return [from, to].sort().join('|')
      })
    }

    // The contingency flags, from the CA result table `<stem>_DF_contingency.csv`: its `BranchID`
    // is `Bus1001->Bus1064(1)`, so the pair is the head of that string, and `LoadingPercent` is the
    // worst loading any contingency left on the branch. Both columns by header name.
    function drawioContingencyLoads(header, rows) {
      const iId = drawioColIndex(header, 'branchid')
      const iLoading = drawioColIndex(header, 'loadingpercent')
      return drawioMaxByPair(rows, iLoading, (c) => {
        if (iId < 0) return null
        const m = /^(bus\d+)\s*->\s*(bus\d+)/i.exec(String(c[iId] === undefined ? '' : c[iId]).trim())
        if (m === null) return null
        return [m[1].toLowerCase(), m[2].toLowerCase()].sort().join('|')
      })
    }

    // The paint map the renderer takes: cell id -> colour. Bus flags come from the band in the
    // config (via the same `drawioBusAlerts` the 0.6.18 annotation used), the two branch families
    // from the flow tables, and a branch flagged by a contingency outranks one flagged by its base
    // case. Buses and branches cannot collide -- a cell is either a bar/label or an edge/ring.
    function drawioFlagPaint(nodes, edges, config, busAlerts, branchLoads, contingencyLoads) {
      const out = {}
      const cfg = config === null || config === undefined ? DRAWIO_NET_DEFAULTS : config
      if (Array.isArray(nodes) && busAlerts !== null && busAlerts !== undefined) {
        for (const n of nodes) {
          const bus = drawioBusCellId(n)
          if (bus !== null && busAlerts[String(bus).toLowerCase()] === true) out[n.id] = cfg.Bus_flag_color
        }
      }
      if (!Array.isArray(edges)) return out
      const index = drawioRingIndex(nodes || [])
      for (const e of edges) {
        const ends = drawioEdgeBusPair(e, edges, index)
        if (ends === null) continue
        const key = ends.slice().sort().join('|')
        const contingency = contingencyLoads === null || contingencyLoads === undefined ? undefined : contingencyLoads[key]
        const basecase = branchLoads === null || branchLoads === undefined ? undefined : branchLoads[key]
        // The map holds every branch the tables mention; the thresholds decide what is painted, with
        // a contingency flag outranking a base-case one.
        if (contingency !== undefined && contingency >= cfg.Contingency_branch_flow_flag_percent) {
          out[e.id] = cfg.Contingency_branch_flow_flag_color
        } else if (basecase !== undefined && basecase >= cfg.Basecase_branch_flow_flag_percent) {
          out[e.id] = cfg.Basecase_branch_flow_flag_color
        }
      }
      return out
    }

    // The final paint map: the flags, with the search colour over the top -- a search is the
    // deliberate act, so a bus that is both flagged and searched shows as searched. Pure, so the
    // guard can hold the precedence still.
    function drawioMergedPaint(flagPaint, searchHits, searchColour) {
      const out = flagPaint === null || flagPaint === undefined ? {} : Object.assign({}, flagPaint)
      if (searchHits !== null && searchHits !== undefined) {
        for (const id of Object.keys(searchHits.buses || {})) out[id] = searchColour
        for (const id of Object.keys(searchHits.edges || {})) out[id] = searchColour
      }
      return Object.keys(out).length === 0 ? null : out
    }

    const drawioGearIcon = React.createElement('svg',
      { width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { display: 'block' } },
      React.createElement('circle', { cx: 8, cy: 8, r: 2.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
      React.createElement('path', {
        d: 'M8 1.4 L9.2 3.1 L11.3 2.6 L11.5 4.7 L13.5 5.6 L12.5 7.4 L13.5 9.2 L11.5 10.1 L11.3 12.2 '
          + 'L9.2 11.7 L8 13.4 L6.8 11.7 L4.7 12.2 L4.5 10.1 L2.5 9.2 L3.5 7.4 L2.5 5.6 L4.5 4.7 L4.7 2.6 L6.8 3.1 Z',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
      }),
    )

    // --- Render-time voltage annotation ---------------------------------------
    // A bus whose solved |V| is outside this band is painted red — bar, outline and `Bus-N` label
    // — by `DrawioDiagram`. The annotation is PAINT-TIME ONLY: it never touches the .drawio file,
    // the parsed scene keeps its authored colours, and the desktop app plus the generator's PNG
    // preview stay as authored. The colours are saturated on purpose: `drawioThemeColor` passes
    // them through unchanged, so a violation reads the same in the light and the dark theme.
    // The band and colour now come from config/net_diagram.json (0.6.26): `DRAWIO_NET_DEFAULTS`
    // below carries the shipped values and `drawioNetConfig` fills in whatever the file omits, so
    // with no config file at all the annotation is the red 0.9-1.1 pu it has always been.
    const DRAWIO_DEFAULT_V_BAND = [DRAWIO_NET_DEFAULTS.Bus_flag_lower_limit, DRAWIO_NET_DEFAULTS.Bus_flag_upper_limit]

    // The bus a node stands for — the bus half of `drawioHoverTarget`, without needing the
    // element->branch pairs: a bar carries `busN`, a `Bus-N` label stands in for its bar.
    function drawioBusCellId(node) {
      if (node === null || node === undefined) return null
      if (drawioIsBusId(node.id)) return node.id
      return drawioLabelBusId(node.lines)
    }

    // Strictly outside the band: the endpoints 0.9 and 1.1 are in band, and a value that is not a
    // finite number (a blank VoltMag, a `-` placeholder) is simply not annotated.
    function drawioVoltOutsideBand(volt, band) {
      const limits = Array.isArray(band) && band.length === 2 ? band : DRAWIO_DEFAULT_V_BAND
      const v = typeof volt === 'number' ? volt : parseFloat(volt)
      if (!Number.isFinite(v)) return false
      return v < limits[0] || v > limits[1]
    }

    // Which of `wantedIds` are out of band, as a plain lookup the renderer can index by bus id.
    // `busRows` are raw CSV lines (`readCsv` hands back the file's own text) and the columns are
    // found by NAME, never by position: `VoltAng` and `NomVolt` sit right beside `VoltMag`, and a
    // positional read would silently colour the wrong buses.
    function drawioVoltColumns(header) {
      const cells = String(header === null || header === undefined ? '' : header).split(',')
      const at = (name) => {
        for (let i = 0; i < cells.length; i += 1) {
          if (String(cells[i]).trim().toLowerCase() === name) return i
        }
        return -1
      }
      return { id: at('id'), volt: at('voltmag') }
    }

    function drawioBusAlerts(header, busRows, wantedIds, band) {
      const out = {}
      const cols = drawioVoltColumns(header)
      if (cols.id < 0 || cols.volt < 0 || !Array.isArray(busRows)) return out
      for (const line of busRows) {
        const c = String(line).split(',')
        const id = String(c[cols.id] || '').trim()
        if (id === '') continue
        if (wantedIds !== null && wantedIds !== undefined && wantedIds[id.toLowerCase()] !== true) continue
        if (drawioVoltOutsideBand(String(c[cols.volt] || '').trim(), band)) out[id.toLowerCase()] = true
      }
      return out
    }

    // --- Search and filter (0.6.23) -------------------------------------------
    // Both are paint-time overrides of the same kind as the voltage alert: a search paints what it
    // found, a filter skips what does not match, and neither touches the .drawio file, the parsed
    // scene or the draw.io desktop app. The rules live here, module-level and pure, because they
    // are the only part of the feature with behaviour worth pinning down in the guard -- the rest
    // is a dialog and a pair of buttons.
    const DRAWIO_MATCH_FILL = '#1F6FEB'

    const drawioIsBusCell = (id) => /^bus\d+$/i.test(String(id === null || id === undefined ? '' : id))

    // Which cells are a transformer's two rings, and which group holds them. The generated file
    // puts them in a `style=group` cell, and that is what a branch through a transformer has to be
    // resolved against: its two stub edges each go bus -> ring, so neither is a bus pair on its own.
    function drawioRingIndex(nodes) {
      const groupOf = {}
      const rings = {}
      for (const n of nodes) {
        if (n.parent !== undefined && n.parent !== null && n.parent !== '' && n.parent !== '1') groupOf[n.id] = n.parent
      }
      for (const n of nodes) {
        const g = groupOf[n.id]
        if (g !== undefined) {
          if (rings[g] === undefined) rings[g] = []
          rings[g].push(n.id)
        }
      }
      return { groupOf: groupOf, rings: rings }
    }

    // The bus pair an edge connects, or null when it cannot be resolved. A plain branch is
    // bus -> bus; a transformer branch is two stubs, so the ring's sibling stub supplies the other
    // bus (without this, search and filter would miss every branch through a transformer).
    function drawioEdgeBusPair(edge, edges, index) {
      // The parsed scene names these `source` / `target` (the draw.io cell attributes).
      if (drawioIsBusCell(edge.source) && drawioIsBusCell(edge.target)) {
        return [String(edge.source).toLowerCase(), String(edge.target).toLowerCase()]
      }
      const busEnd = drawioIsBusCell(edge.source) ? edge.source : (drawioIsBusCell(edge.target) ? edge.target : null)
      const ring = drawioIsBusCell(edge.source) ? edge.target : edge.source
      if (busEnd === null || ring === null || ring === undefined) return null
      const group = index.groupOf[ring]
      if (group === undefined) return null
      const siblings = index.rings[group] || []
      for (const e of edges) {
        if (e === edge) continue
        const other = siblings.indexOf(e.source) >= 0 ? e.source : (siblings.indexOf(e.target) >= 0 ? e.target : null)
        if (other === null) continue
        if (drawioIsBusCell(e.source) && e.target === other) return [String(busEnd).toLowerCase(), String(e.source).toLowerCase()]
        if (drawioIsBusCell(e.target) && e.source === other) return [String(busEnd).toLowerCase(), String(e.target).toLowerCase()]
      }
      return null
    }

    // What a search query matches, as cell-id lookups the renderer can paint from. The query is
    // one of: a bus number (`1001`), a bus id (`Bus-1001`, `Bus1001`), part of a bus name
    // (`ODESSA`, from the case's bus table), or a branch written with an arrow (`1001->1002`;
    // `-`, `/` and the unicode arrow are accepted too). A bus and a branch are tried together,
    // because `1001` is a valid bus on its own.
    function drawioSearchHits(query, nodes, edges, busNames) {
      const out = { buses: {}, edges: {}, nBus: 0, nBranch: 0, text: '' }
      const q = String(query === null || query === undefined ? '' : query).trim().toLowerCase()
      if (q === '') {
        out.text = 'Type a bus number, a name, or a branch like 1001->1002.'
        return out
      }
      const index = drawioRingIndex(nodes)
      const labels = {}
      for (const n of nodes) {
        const bus = drawioBusCellId(n)
        if (bus !== null && !drawioIsBusCell(n.id)) labels[String(bus).toLowerCase()] = n.id
      }
      const bars = {}
      for (const n of nodes) {
        if (drawioIsBusCell(n.id)) bars[String(n.id).toLowerCase()] = n.id
      }
      const hit = (busKey) => {
        if (out.buses[busKey] === true) return
        out.buses[busKey] = true
        out.nBus += 1
        if (bars[busKey] !== undefined) out.buses[bars[busKey]] = true
        if (labels[busKey] !== undefined) out.buses[labels[busKey]] = true
      }
      const pair = /^(\d+)\s*(?:->|\u2192|[-\u2013/])\s*(\d+)$/.exec(q)
      if (pair !== null) {
        const a = 'bus' + pair[1]
        const b = 'bus' + pair[2]
        if (bars[a] === undefined || bars[b] === undefined) {
          out.text = 'No branch between ' + pair[1] + ' and ' + pair[2] + ' in this diagram.'
          return out
        }
        hit(a)
        hit(b)
        for (const e of edges) {
          const ends = drawioEdgeBusPair(e, edges, index)
          if (ends === null) continue
          if ((ends[0] === a && ends[1] === b) || (ends[0] === b && ends[1] === a)) {
            out.edges[e.id] = true
            out.nBranch += 1
          }
        }
        out.text = out.nBranch === 0
          ? 'No branch drawn between ' + pair[1] + ' and ' + pair[2] + '.'
          : out.nBranch + (out.nBranch === 1 ? ' branch' : ' branches') + ' between ' + pair[1] + ' and ' + pair[2] + '.'
        return out
      }
      const num = /^bus-?(\d+)$/.exec(q)
      if (num !== null) {
        if (bars['bus' + num[1]] === undefined) {
          out.text = 'No Bus-' + num[1] + ' in this diagram.'
          return out
        }
        hit('bus' + num[1])
        out.text = 'Bus-' + num[1] + ' found.'
        return out
      }
      for (const key of Object.keys(bars)) {
        if (key === 'bus' + q) hit(key)
      }
      if (out.nBus === 0 && busNames !== null && busNames !== undefined) {
        for (const key of Object.keys(busNames)) {
          if (String(busNames[key]).toLowerCase().indexOf(q) >= 0 && bars[key] !== undefined) hit(key)
        }
      }
      out.text = out.nBus === 0
        ? 'Nothing matches "' + query + '".'
        : out.nBus + (out.nBus === 1 ? ' bus' : ' buses') + ' match "' + query + '".'
      return out
    }

    // What a filter hides: every bus outside the chosen area/zone -- and, when asked, outside the
    // |V| band -- plus the labels, branches and transformer symbols attached to those buses. A
    // branch is hidden when EITHER end is hidden, so nothing is left dangling into nothing.
    // Two KINDS of criterion, and the difference matters when they are combined (0.6.32):
    //
    //   - the bus criteria (area, zone, the voltage band) choose buses;
    //   - the flow criteria (base-case, contingency loading) choose branches.
    //
    // A bus criterion alone leaves the network of the chosen buses standing, exactly as before. A
    // flow criterion is the "only" kind: the branches that do not reach its threshold go, and so do
    // the buses that are not an end of a branch that stays -- otherwise "only branches >= 70%" would
    // still draw every bus. Combined, they narrow together: area 1 + base-case >= 70% is the
    // overloaded branches *inside* area 1.
    function drawioFilterHidden(filter, nodes, edges, meta, alerts, config, branchLoads, contingencyLoads) {
      const out = { ids: {}, nBuses: 0, nBranches: 0, text: '' }
      if (filter === null || filter === undefined) return out
      const index = drawioRingIndex(nodes)
      const cfg = drawioNetConfig(config)
      const bars = []
      for (const n of nodes) {
        if (drawioIsBusCell(n.id)) bars.push(String(n.id).toLowerCase())
      }
      const keep = {}
      const area = String(filter.area === undefined || filter.area === null ? '' : filter.area)
      const zone = String(filter.zone === undefined || filter.zone === null ? '' : filter.zone)
      const band = filter.outOfBand === true
      const flowBase = filter.basecaseLoading === true
      const flowCont = filter.contingencyLoading === true
      const flow = flowBase || flowCont
      for (const key of bars) {
        const info = meta !== null && meta !== undefined && meta.ofBus !== undefined ? meta.ofBus[key] : undefined
        let ok = true
        if (area !== '') ok = info !== undefined && String(info.area) === area
        if (ok && zone !== '') ok = info !== undefined && String(info.zone) === zone
        if (ok && band) ok = alerts !== null && alerts !== undefined && alerts[key] === true
        keep[key] = ok
      }
      // Phase B: the branch criteria, over the pairs the diagram draws (a transformer's two stubs are
      // one pair, the same granularity the flow flags count in).
      const loadOf = (loads, key) => (loads === null || loads === undefined ? undefined : loads[key])
      const flowOk = (key) => {
        if (!flow) return true
        if (flowBase) {
          const v = loadOf(branchLoads, key)
          if (v === undefined || v < cfg.Basecase_branch_flow_flag_percent) return false
        }
        if (flowCont) {
          const v = loadOf(contingencyLoads, key)
          if (v === undefined || v < cfg.Contingency_branch_flow_flag_percent) return false
        }
        return true
      }
      const pairs = {}
      const edgePair = {}
      for (const e of edges) {
        const ends = drawioEdgeBusPair(e, edges, index)
        if (ends === null) continue
        const key = ends.slice().sort().join('|')
        edgePair[e.id] = key
        pairs[key] = true
      }
      const edgeOk = {}
      const incident = {}
      for (const e of edges) {
        const key = edgePair[e.id]
        if (key === undefined) continue
        const ends = key.split('|')
        const ok = keep[ends[0]] !== false && keep[ends[1]] !== false && flowOk(key)
        edgeOk[e.id] = ok
        if (ok && flow) {
          incident[ends[0]] = true
          incident[ends[1]] = true
        }
      }
      // Phase C: a flow criterion narrows the buses to the ends of what survives (see above).
      const surv = {}
      for (const key of bars) {
        const ok = keep[key] !== false && (!flow || incident[key] === true)
        surv[key] = ok
        if (!ok) {
          out.nBuses += 1
          out.ids[key] = true
        }
      }
      for (const n of nodes) {
        const bus = drawioBusCellId(n)
        if (bus !== null && surv[String(bus).toLowerCase()] === false) out.ids[n.id] = true
      }
      for (const e of edges) {
        const key = edgePair[e.id]
        if (key === undefined) continue
        const ends = key.split('|')
        if (edgeOk[e.id] !== true || surv[ends[0]] === false || surv[ends[1]] === false) out.ids[e.id] = true
      }
      let nPairs = 0
      let nPairsKept = 0
      const counted = {}
      for (const key of Object.keys(edgePair)) {
        const pairKey = edgePair[key]
        if (counted[pairKey] === true) continue
        counted[pairKey] = true
        nPairs += 1
        const ends = pairKey.split('|')
        if (surv[ends[0]] !== false && surv[ends[1]] !== false && flowOk(pairKey)) nPairsKept += 1
      }
      out.totalBranches = nPairs
      out.keptBranches = nPairsKept
      out.nBranches = nPairs - nPairsKept
      // a transformer's rings have no bus of their own: hide them with the stub that was hidden
      for (const e of edges) {
        if (out.ids[e.id] !== true) continue
        const ring = drawioIsBusCell(e.source) ? e.target : e.source
        if (ring === null || ring === undefined) continue
        const group = index.groupOf[ring]
        for (const r of (group === undefined ? [] : index.rings[group] || [])) out.ids[r] = true
        if (group !== undefined) out.ids[group] = true
      }
      // The sentence names the area and zone the way the dialog's selects do; the toolbar's short
      // label stays numeric, because that row has no space for names.
      const nameOf = (list, num) => {
        for (const item of (meta !== null && meta !== undefined && Array.isArray(list) ? list : [])) {
          if (String(item.num) === String(num) && item.name !== '') return ' ' + item.name
        }
        return ''
      }
      const short = []
      const parts = []
      let busCriteria = false
      let branchCriteria = false
      if (area !== '') {
        short.push('area ' + area)
        parts.push('area ' + area + nameOf(meta === null || meta === undefined ? null : meta.areas, area))
        busCriteria = true
      }
      if (zone !== '') {
        short.push('zone ' + zone)
        parts.push('zone ' + zone + nameOf(meta === null || meta === undefined ? null : meta.zones, zone))
        busCriteria = true
      }
      if (band) {
        short.push(drawioBandText(config))
        parts.push(drawioBandText(config))
        busCriteria = true
      }
      if (flowBase) {
        short.push(drawioLoadingThresholdText(config, 'basecase'))
        parts.push(drawioLoadingThresholdText(config, 'basecase'))
        branchCriteria = true
      }
      if (flowCont) {
        short.push(drawioLoadingThresholdText(config, 'contingency'))
        parts.push(drawioLoadingThresholdText(config, 'contingency'))
        branchCriteria = true
      }
      out.label = short.join(', ')
      out.criteria = parts.join(', ')
      out.kept = bars.length - out.nBuses
      out.total = bars.length
      // A branch criterion is answered in branches -- counting buses there would say "all 2000 shown"
      // while the drawing shows a handful of overloaded lines. Both kinds together report both.
      const clause = []
      if (busCriteria || branchCriteria === false || out.nBuses > 0) clause.push(out.kept + ' of ' + out.total + ' buses')
      if (branchCriteria) clause.push(out.keptBranches + ' of ' + out.totalBranches + ' branches')
      out.text = parts.length === 0
        ? 'Nothing is filtered: every bus is shown.'
        : 'Showing ' + clause.join(' and ') + ' (' + out.criteria + ').'
      return out
    }

    // The bus table's area/zone/name columns, folded into the lookups a filter needs: the distinct
    // Area and Zone numbers with their names, and per bus its area, zone and name. Read by header
    // name like the voltage columns -- `AreaNum` sits beside `AreaName`, and a positional read
    // would silently filter on the wrong column. `into` lets the caller merge successive pages.
    function drawioBusMeta(header, rows, into) {
      const out = into || { areas: [], zones: [], ofBus: {} }
      const seenArea = {}
      const seenZone = {}
      for (const a of out.areas) seenArea[a.num] = true
      for (const z of out.zones) seenZone[z.num] = true
      const cells = String(header === null || header === undefined ? '' : header).split(',')
      const at = (name) => {
        for (let i = 0; i < cells.length; i += 1) {
          if (String(cells[i]).trim().toLowerCase() === name) return i
        }
        return -1
      }
      const iId = at('id')
      if (iId < 0 || !Array.isArray(rows)) return out
      const iName = at('name')
      const iArea = at('areanum')
      const iAreaName = at('areaname')
      const iZone = at('zonenum')
      const iZoneName = at('zonename')
      const cell = (c, i) => (i < 0 ? '' : String(c[i] === undefined ? '' : c[i]).trim())
      for (const line of rows) {
        const c = String(line).split(',')
        const key = String(c[iId] === undefined ? '' : c[iId]).trim().toLowerCase()
        if (key === '') continue
        const areaNum = cell(c, iArea)
        const zoneNum = cell(c, iZone)
        out.ofBus[key] = { area: areaNum, zone: zoneNum, name: cell(c, iName) }
        if (areaNum !== '' && seenArea[areaNum] !== true) {
          seenArea[areaNum] = true
          out.areas.push({ num: areaNum, name: cell(c, iAreaName) })
        }
        if (zoneNum !== '' && seenZone[zoneNum] !== true) {
          seenZone[zoneNum] = true
          out.zones.push({ num: zoneNum, name: cell(c, iZoneName), area: areaNum })
        }
      }
      out.areas.sort((x, y) => Number(x.num) - Number(y.num))
      out.zones.sort((x, y) => Number(x.num) - Number(y.num))
      return out
    }

    // What the search dialog tells the user, for THIS case (0.6.25): the bus count and the range
    // the diagram actually draws, a branch example built from two of its own numbers, and -- when
    // the case's result table carries names -- one of them to search on. Without that table it says
    // so, instead of suggesting a name search that cannot work.
    function drawioSearchHelp(scene, meta) {
      const nums = []
      if (scene !== null && scene !== undefined && Array.isArray(scene.nodes)) {
        for (const n of scene.nodes) {
          const m = /^bus(\d+)$/i.exec(String(n.id === null || n.id === undefined ? '' : n.id))
          if (m !== null) nums.push(Number(m[1]))
        }
      }
      nums.sort((a, b) => a - b)
      const uniq = nums.filter((v, i) => i === 0 || v !== nums[i - 1])
      let word = ''
      if (meta !== null && meta !== undefined && meta.ofBus !== undefined) {
        for (const key of Object.keys(meta.ofBus).sort()) {
          const full = String(meta.ofBus[key].name === undefined ? '' : meta.ofBus[key].name).trim()
          if (full !== '') {
            word = full.split(/\s+/)[0]
            break
          }
        }
      }
      if (uniq.length === 0) {
        return {
          placeholder: '1001, Bus-1001, 1001->1002',
          hint: 'A number or id finds one bus, 1001->1002 the branches between two, and part of a name finds every bus whose name contains it.',
        }
      }
      const first = uniq[0]
      const second = uniq.length > 1 ? uniq[1] : uniq[0]
      const pair = first + '->' + second
      const range = uniq.length === 1 ? 'Bus-' + first : 'Bus-' + first + ' to Bus-' + uniq[uniq.length - 1]
      const placeholder = [String(first), 'Bus-' + first].concat(word === '' ? [] : [word]).concat([pair]).join(', ')
      const hint = uniq.length + (uniq.length === 1 ? ' bus here (' : ' buses here (') + range + '). '
        + 'A number or id finds one bus, ' + pair + ' the branches between two'
        + (word === '' ? '; bus names need this case\u2019s ACLF result table, which is not there.'
          : ', and part of a name like "' + word + '" finds every bus whose name contains it.')
        + ' Matches are highlighted in the drawing.'
      return { placeholder: placeholder, hint: hint }
    }

    // The two toolbar icons, built the way the draw.io mark is: a small inline svg, so the buttons
    // stay crisps at any size and need no icon font or image request.
    const drawioSearchIcon = React.createElement('svg',
      { width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { display: 'block' } },
      React.createElement('circle', { cx: 6.8, cy: 6.8, r: 4.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
      React.createElement('path', { d: 'M10.4 10.4 L14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
    )
    const drawioFilterIcon = React.createElement('svg',
      { width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { display: 'block' } },
      React.createElement('path', { d: 'M1.6 2.2 H14.4 L9.4 8.2 V13.4 L6.6 12 V8.2 Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
    )

    // --- the birdseye view (0.6.28) ------------------------------------------
    // A whole-diagram thumbnail in the corner of the canvas, with the visible rectangle drawn on
    // it: at 200% on a 2000-bus drawing there is otherwise nothing to say where you are. It is NOT
    // a second DrawioDiagram -- that would double the DOM for 10k cells -- but two `<path>` strings,
    // one for every branch and one for every bar, which the browser paints as a single shape each.
    // The viewport frame is a real element on top, so the panning stays smooth.
    const DRAWIO_BIRDSEYE_MAX_ITEMS = 30000

    function drawioBirdseyePaths(scene) {
      const out = { bars: '', edges: '' }
      if (scene === null || scene === undefined) return out
      const bars = []
      const step = scene.nodes !== undefined && scene.nodes.length > DRAWIO_BIRDSEYE_MAX_ITEMS
        ? Math.ceil(scene.nodes.length / DRAWIO_BIRDSEYE_MAX_ITEMS) : 1
      for (let i = 0; i < (scene.nodes || []).length; i += step) {
        const n = scene.nodes[i]
        if (!drawioIsBusId(n.id) || n.kind !== 'rect') continue
        // every bar as its own subpath: `M x y h w v h h -w z`
        bars.push('M' + n.x + ' ' + n.y + 'h' + n.w + 'v' + n.h + 'h' + -n.w + 'z')
      }
      const edges = []
      const estep = (scene.edges || []).length > DRAWIO_BIRDSEYE_MAX_ITEMS
        ? Math.ceil(scene.edges.length / DRAWIO_BIRDSEYE_MAX_ITEMS) : 1
      for (let i = 0; i < (scene.edges || []).length; i += estep) {
        const pts = scene.edges[i].points || []
        if (pts.length < 2) continue
        let d = 'M' + pts[0].x + ' ' + pts[0].y
        for (let k = 1; k < pts.length; k += 1) d += 'L' + pts[k].x + ' ' + pts[k].y
        edges.push(d)
      }
      out.bars = bars.join('')
      out.edges = edges.join('')
      return out
    }

    // Where the canvas should look when a point at fractions (fx, fy) of the birdseye is clicked or
    // dragged: the same size window, centred there, and held inside the drawing so a click on the
    // thumbnail always lands on the diagram rather than on empty paper.
    function drawioBirdseyeRect(scene, rect, fx, fy) {
      if (scene === null || scene === undefined || rect === null || rect === undefined) return rect
      const vb = scene.viewBox
      const x = Number.isFinite(fx) ? Math.min(1, Math.max(0, fx)) : 0.5
      const y = Number.isFinite(fy) ? Math.min(1, Math.max(0, fy)) : 0.5
      const w = Math.min(rect.w, vb.w)
      const h = Math.min(rect.h, vb.h)
      const cx = vb.x + vb.w * x
      const cy = vb.y + vb.h * y
      const minX = vb.x
      const maxX = vb.x + vb.w - w
      const minY = vb.y
      const maxY = vb.y + vb.h - h
      return {
        x: maxX <= minX ? minX : Math.min(maxX, Math.max(minX, cx - w / 2)),
        y: maxY <= minY ? minY : Math.min(maxY, Math.max(minY, cy - h / 2)),
        w: w,
        h: h,
      }
    }

    // The thumbnail. Pointer events are captured here and never bubble: they must not also pan the
    // canvas underneath, which is why every handler stops propagation.
    function DrawioBirdseye(props) {
      const scene = props.scene
      const rect = props.rect
      const [grab, setGrab] = React.useState(false)
      const box = { position: 'absolute', right: '10px', bottom: '10px', width: '190px', height: '150px',
        background: DRAWIO_PAPER, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px',
        overflow: 'hidden', boxShadow: '0 2px 10px rgba(0, 0, 0, 0.25)', opacity: 0.94, cursor: 'crosshair' }
      return React.createElement('svg', {
        viewBox: scene.viewBox.x + ' ' + scene.viewBox.y + ' ' + scene.viewBox.w + ' ' + scene.viewBox.h,
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'aria-label': 'Birdseye view of the whole diagram',
        title: 'Birdseye view — click or drag to move the view',
        style: box,
        onPointerDown: (e) => {
          e.stopPropagation()
          e.preventDefault()
          setGrab(true)
          if (typeof e.currentTarget.setPointerCapture === 'function') {
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
          }
          props.onCentre(e)
        },
        onPointerMove: (e) => {
          e.stopPropagation()
          if (grab) props.onCentre(e)
        },
        onPointerUp: (e) => { e.stopPropagation(); setGrab(false) },
        onPointerCancel: (e) => { e.stopPropagation(); setGrab(false) },
        onPointerLeave: (e) => { e.stopPropagation(); if (grab) setGrab(false) },
      },
        React.createElement('path', { key: 'e', d: props.paths.edges, fill: 'none', stroke: DRAWIO_INK, strokeWidth: 1, vectorEffect: 'non-scaling-stroke', opacity: 0.45 }),
        React.createElement('path', { key: 'b', d: props.paths.bars, fill: DRAWIO_INK, opacity: 0.7 }),
        React.createElement('rect', {
          key: 'v',
          x: rect.x, y: rect.y, width: rect.w, height: rect.h,
          fill: DRAWIO_MATCH_FILL, fillOpacity: 0.18, stroke: DRAWIO_MATCH_FILL,
          strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke',
        }),
      )
    }

    // mxGraphModel -> a flat, React-free scene description: { viewBox, nodes, edges }.
    // Geometry is resolved to absolute coordinates so grouped cells (style=group, whose
    // children carry relative="1" geometry) land in the right place.
    function parseDrawioScene(xml) {
      const doc = new DOMParser().parseFromString(xml, 'text/xml')
      if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('the file is not valid draw.io XML')
      const cells = doc.getElementsByTagName('mxCell')
      if (cells.length === 0) throw new Error('no diagram cells found')
      if (cells.length > DRAWIO_MAX_CELLS) {
        throw new Error('this diagram has ' + cells.length + ' cells (limit ' + DRAWIO_MAX_CELLS + ') and is too large to preview')
      }

      const byId = {}
      for (let i = 0; i < cells.length; i += 1) byId[cells[i].getAttribute('id')] = cells[i]

      // The mxGeometry a cell owns. A descendant search would be wrong here: a `group`
      // cell has no geometry of its own but its children do, so the first descendant
      // would be a child's box and every offset below it would be applied twice.
      function ownGeometry(cell) {
        const kids = cell.children
        for (let i = 0; i < kids.length; i += 1) {
          if (kids[i].tagName === 'mxGeometry') return kids[i]
        }
        return null
      }

      // Absolute offset of a cell: every ancestor's own x/y accumulates down the parent
      // chain. The guard bounds a malformed/cyclic parent graph.
      function originOf(cell) {
        let x = 0
        let y = 0
        let cur = cell
        let guard = 0
        while (cur !== undefined && guard < 64) {
          guard += 1
          const parentId = cur.getAttribute('parent')
          const parent = parentId === null ? undefined : byId[parentId]
          if (parent === undefined || parent === cur) break
          const pg = ownGeometry(parent)
          if (pg === null) break
          x += numOr(pg.getAttribute('x'), 0)
          y += numOr(pg.getAttribute('y'), 0)
          cur = parent
        }
        return { x: x, y: y }
      }

      const rects = {}
      const nodes = []
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i]
        if (cell.getAttribute('vertex') !== '1') continue
        const g = ownGeometry(cell)
        if (g === null) continue
        const st = styleMap(cell.getAttribute('style'))
        // A `group` is a container, not a shape: it draws nothing itself, and its children
        // are positioned relative to it. Skipping it here is what keeps those children
        // (this workspace's transformer symbols, two ellipses each) in place without a
        // spurious box behind them.
        if (st.group !== undefined) continue
        const o = originOf(cell)
        const x = o.x + numOr(g.getAttribute('x'), 0)
        const y = o.y + numOr(g.getAttribute('y'), 0)
        const w = Math.max(1, numOr(g.getAttribute('width'), 0) || 120)
        const h = Math.max(1, numOr(g.getAttribute('height'), 0) || 60)
        const style = st
        const kind = style.ellipse !== undefined || style.shape === 'ellipse' ? 'ellipse' : (style.text !== undefined ? 'text' : 'rect')
        const node = {
          id: cell.getAttribute('id'),
          // The parent cell. A transformer symbol is two ellipses inside a `style=group`
          // cell, so the group id is what pairs them — not the `xfN`/`xfNb` spelling.
          parent: cell.getAttribute('parent'),
          // Document position. The renderer paints in this order — see DrawioDiagram.
          order: i,
          kind: kind,
          x: x, y: y, w: w, h: h,
          // `rounded` carries a VALUE, and draw.io's default (and this workspace's every file) is
          // `rounded=0`: the presence of the key used to mean "round", which turned every 6x52 bus
          // bar into a pill where draw.io draws a square (0.6.33).
          rounded: kind === 'rect' && style.rounded !== undefined && style.rounded !== '0',
          // draw.io rounds by `min(w, h) * arcSize`, arcSize defaulting to 15% -- not by a fixed 8.
          arcSize: Math.min(0.5, Math.max(0, numOr(style.arcSize, 15) / 100)),
          fill: style.fillColor !== undefined ? style.fillColor : null,
          stroke: style.strokeColor !== undefined ? style.strokeColor : DRAWIO_STROKE,
          strokeWidth: numOr(style.strokeWidth, 1),
          dashed: style.dashed === '1',
          fontColor: style.fontColor !== undefined ? style.fontColor : DRAWIO_TEXT,
          fontSize: numOr(style.fontSize, 12),
          bold: (numOr(style.fontStyle, 0) & 1) === 1,
          italic: (numOr(style.fontStyle, 0) & 2) === 2,
          lines: labelLines(cell.getAttribute('value')),
          // Where the label sits inside its own box, as draw.io's style says. Absent keys keep
          // draw.io's own defaults (centre / middle), so untagged text cells do not move.
          align: style.align === 'left' || style.align === 'right' ? style.align : 'center',
          vAlign: style.verticalAlign === 'top' || style.verticalAlign === 'bottom' ? style.verticalAlign : 'middle',
          spacing: Math.max(0, numOr(style.spacing, 2)),
          // A `text` cell has no fill of its own; `labelBackgroundColor` is the mask draw.io paints
          // behind the glyphs, and reading it is what keeps wires out of the text (0.6.33).
          labelBg: style.labelBackgroundColor !== undefined && style.labelBackgroundColor !== 'none'
            ? style.labelBackgroundColor : null,
        }
        rects[node.id] = node
        nodes.push(node)
      }

      const edges = []
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i]
        if (cell.getAttribute('edge') !== '1') continue
        const st = styleMap(cell.getAttribute('style'))
        const g = ownGeometry(cell)
        const src = rects[cell.getAttribute('source')]
        const tgt = rects[cell.getAttribute('target')]
        // exit/entry are fractions of the source/target box; absent means the centre, and
        // nodes are painted over the edge ends so the overlap is invisible.
        const sx = numOr(st.exitX, 0.5)
        const sy = numOr(st.exitY, 0.5)
        const tx = numOr(st.entryX, 0.5)
        const ty = numOr(st.entryY, 0.5)
        // `let`, not `const`: an edge that names no source/target CELL falls back to its
        // own sourcePoint/targetPoint mxPoints below, and to its Array points after that.
        // The workspace's diagram resolves every edge through a cell, so this branch is not
        // exercised there — but a draw.io diagram with a free-floating edge would throw
        // "Assignment to constant variable" and render no preview at all.
        let from = src === undefined ? null : { x: src.x + src.w * sx, y: src.y + src.h * sy }
        let to = tgt === undefined ? null : { x: tgt.x + tgt.w * tx, y: tgt.y + tgt.h * ty }
        const pts = []
        if (g !== null) {
          const arrays = g.getElementsByTagName('Array')
          for (let a = 0; a < arrays.length; a += 1) {
            if (arrays[a].getAttribute('as') !== 'points') continue
            const ps = arrays[a].getElementsByTagName('mxPoint')
            for (let p = 0; p < ps.length; p += 1) {
              pts.push({ x: numOr(ps[p].getAttribute('x'), 0), y: numOr(ps[p].getAttribute('y'), 0) })
            }
          }
          if (from === null) {
            const sp = g.getElementsByTagName('mxPoint')
            for (let p = 0; p < sp.length; p += 1) {
              if (sp[p].getAttribute('as') === 'sourcePoint') from = { x: numOr(sp[p].getAttribute('x'), 0), y: numOr(sp[p].getAttribute('y'), 0) }
              else if (sp[p].getAttribute('as') === 'targetPoint') to = { x: numOr(sp[p].getAttribute('x'), 0), y: numOr(sp[p].getAttribute('y'), 0) }
            }
          }
        }
        if (from === null && pts.length > 0) from = pts.shift()
        if (to === null && pts.length > 0) to = pts.pop()
        const points = []
        if (from !== null) points.push(from)
        for (const p of pts) points.push(p)
        if (to !== null) points.push(to)
        if (points.length < 2) continue

        let arrow = null
        if (st.endArrow !== 'none' && points.length >= 2) {
          const a = points[points.length - 2]
          const b = points[points.length - 1]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len > 0.001) {
            const ux = dx / len
            const uy = dy / len
            const size = 9
            const wing = 4
            arrow = [
              b.x + ',' + b.y,
              (b.x - ux * size - uy * wing) + ',' + (b.y - uy * size + ux * wing),
              (b.x - ux * size + uy * wing) + ',' + (b.y - uy * size - ux * wing),
            ].join(' ')
          }
        }
        const mid = points[Math.floor(points.length / 2)]
        edges.push({
          id: cell.getAttribute('id'),
          source: cell.getAttribute('source'),
          target: cell.getAttribute('target'),
          order: i,
          points: points,
          stroke: st.strokeColor !== undefined ? st.strokeColor : DRAWIO_STROKE,
          strokeWidth: numOr(st.strokeWidth, 1),
          dashed: st.dashed === '1',
          arrow: arrow,
          label: labelLines(cell.getAttribute('value')).join(' '),
          labelAt: mid,
        })
      }

      if (nodes.length === 0 && edges.length === 0) throw new Error('empty diagram — nothing to draw')

      // Bounding box over every drawn coordinate; the shared modulo root cell has no
      // geometry of its own, so it never contributes.
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      const extend = (x, y) => {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
      for (const n of nodes) { extend(n.x, n.y); extend(n.x + n.w, n.y + n.h) }
      for (const e of edges) { for (const p of e.points) extend(p.x, p.y) }
      if (!Number.isFinite(minX)) throw new Error('empty diagram — nothing to draw')
      return {
        viewBox: {
          x: minX - DRAWIO_PAD,
          y: minY - DRAWIO_PAD,
          w: Math.max(1, maxX - minX + DRAWIO_PAD * 2),
          h: Math.max(1, maxY - minY + DRAWIO_PAD * 2),
        },
        nodes: nodes,
        edges: edges,
      }
    }

    // A label sits inside its own box the way draw.io's style says: `align` and `verticalAlign`
    // pick the corner or the centre, `spacing` insets it from that edge (draw.io's default 2).
    // Text is never measured here -- the vertical anchors use the usual font metrics (ascent 0.8em,
    // descent 0.2em, line height 1.2em, the spacing the previous version already used per line) --
    // so a top-aligned line starts a hair inside the box rather than exactly on the glyph grid.
    // `middle` + `center` is byte-for-byte the old behaviour, which is what every bus label uses.
    function drawioLabel(node, key) {
      const lines = node.lines
      if (lines.length === 0) return null
      const spacing = Number.isFinite(node.spacing) ? node.spacing : 2
      const size = node.fontSize
      let x = node.x + node.w / 2
      let anchor = 'middle'
      if (node.align === 'left') {
        x = node.x + spacing
        anchor = 'start'
      } else if (node.align === 'right') {
        x = node.x + node.w - spacing
        anchor = 'end'
      }
      let y = node.y + node.h / 2
      let firstDy = lines.length > 1 ? (-(lines.length - 1) * 0.6) + 'em' : '0.32em'
      if (node.vAlign === 'top') {
        y = node.y + spacing + size * 0.8
        firstDy = '0'
      } else if (node.vAlign === 'bottom') {
        y = node.y + node.h - spacing - size * 0.2 - (lines.length - 1) * size * 1.2
        firstDy = '0'
      }
      const spans = lines.map((line, i) => React.createElement('tspan', {
        key: 't' + i,
        x: x,
        dy: i === 0 ? firstDy : '1.2em',
      }, line))
      return React.createElement('text', {
        key: key,
        x: x, y: y, textAnchor: anchor,
        fontSize: size, fontWeight: node.bold ? 600 : 400,
        fontStyle: node.italic ? 'italic' : 'normal', fill: drawioThemeColor(node.fontColor),
      }, spans)
    }

    // Pan/zoom for the preview. The renderer always draws the whole scene and only the
    // SVG viewBox moves, so a zoom step re-parses nothing and measures nothing. A
    // `rect` below is the visible rectangle in scene coordinates ({x,y,w,h}); null means
    // "fit", and a fit is simply the scene's own viewBox.
    const DRAWIO_MIN_ZOOM = 0.1
    const DRAWIO_MAX_ZOOM = 12
    // The percentages the zoom readout offers. Wheel and button zooming reach values in between
    // (745%, say), so the control shows the current level as an extra entry when it is not one of
    // these -- a readout that rounded to the nearest preset would be lying about the view.
    const DRAWIO_ZOOM_PRESETS = [25, 50, 75, 100, 125, 150, 200, 300, 400]

    function drawioFitRect(vb) {
      return { x: vb.x, y: vb.y, w: vb.w, h: vb.h }
    }

    // Bounds on the visible width, derived from the zoom limits. Expressed as widths
    // because that is what the rect carries; the height follows the width.
    function drawioZoomLimits(vb) {
      const w = Number.isFinite(vb.w) && vb.w > 0 ? vb.w : 1
      return { minW: w / DRAWIO_MAX_ZOOM, maxW: w / DRAWIO_MIN_ZOOM }
    }

    // Zoom by `factor` (>1 zooms in), holding the scene point at the window fractions
    // (fx, fy) -- both in [0,1] -- in place, so one wheel notch zooms about the cursor.
    // The height follows the width so the aspect ratio cannot drift, and an unmeasurable
    // input falls back to a centre anchor rather than throwing mid-gesture.
    function drawioZoomRect(rect, factor, fx, fy, limits) {
      const f = Number.isFinite(factor) && factor > 0 ? factor : 1
      const minW = limits && Number.isFinite(limits.minW) ? limits.minW : 1e-6
      const maxW = limits && Number.isFinite(limits.maxW) ? limits.maxW : 1e9
      let w = rect.w / f
      if (!Number.isFinite(w) || w <= 0) w = rect.w
      w = Math.min(maxW, Math.max(minW, w))
      const h = rect.h * (w / rect.w)
      const ax = Number.isFinite(fx) ? Math.min(1, Math.max(0, fx)) : 0.5
      const ay = Number.isFinite(fy) ? Math.min(1, Math.max(0, fy)) : 0.5
      return { x: rect.x + (rect.w - w) * ax, y: rect.y + (rect.h - h) * ay, w: w, h: h }
    }

    function drawioPanRect(rect, dx, dy) {
      const sx = Number.isFinite(dx) ? dx : 0
      const sy = Number.isFinite(dy) ? dy : 0
      return { x: rect.x + sx, y: rect.y + sy, w: rect.w, h: rect.h }
    }

    // One wheel notch -> one zoom factor, kept apart from the event so the guard test can
    // exercise the direction without a DOM.
    function drawioWheelFactor(deltaY) {
      const d = Number.isFinite(deltaY) ? deltaY : 0
      if (d === 0) return 1
      return d < 0 ? 1.15 : 1 / 1.15
    }

    // A bus bar's cell id is `busN` in the exported diagrams.
    function drawioIsBusId(id) {
      return typeof id === 'string' && /^bus\d+$/i.test(id)
    }

    // Map every interactive diagram element to the branch it belongs to, as a
    // `busa|busb` key of lowercased bus cell ids (so they compare with the table's BusN).
    //
    // A branch is either ONE edge between two bus bars, or a transformer symbol drawn as TWO
    // chained edges (\`bus4 -> xf8\` then \`xf8b -> bus7\`) joined through a group cell. So an
    // edge with a single bus end is paired with its sibling — the other edge whose endpoint
    // shares the same parent group — and both take the union of their bus ends. The
    // transformer NODES take their group's key too, so the symbol itself is hoverable.
    function drawioBranchPairs(scene) {
      const edgePair = {}
      const nodePair = {}
      if (scene === null || scene === undefined) return { edgePair: edgePair, nodePair: nodePair }
      const byId = {}
      for (const n of scene.nodes) byId[n.id] = n
      const busEndsOf = (e) => {
        const out = []
        for (const end of [e.source, e.target]) {
          if (drawioIsBusId(end)) out.push(String(end).toLowerCase())
        }
        return out
      }
      const keyOf = (ends) => (ends.length < 2 ? null : ends.slice().sort().join('|'))
      const groupOf = (cellId) => {
        const n = byId[cellId]
        return n === undefined ? null : n.parent
      }
      const edges = scene.edges
      for (let i = 0; i < edges.length; i += 1) {
        const e = edges[i]
        if (edgePair[e.id] !== undefined) continue
        const ends = busEndsOf(e)
        if (ends.length === 2) {
          edgePair[e.id] = keyOf(ends)
          continue
        }
        if (ends.length !== 1) continue
        const other = drawioIsBusId(e.source) ? e.target : e.source
        const group = groupOf(other)
        if (group === null || group === undefined) continue
        const family = [e]
        for (let j = 0; j < edges.length; j += 1) {
          const c = edges[j]
          if (c.id === e.id) continue
          if (groupOf(c.source) === group || groupOf(c.target) === group) family.push(c)
        }
        const union = []
        for (const f of family) for (const b of busEndsOf(f)) if (union.indexOf(b) === -1) union.push(b)
        const key = keyOf(union)
        if (key === null) continue
        for (const f of family) edgePair[f.id] = key
        for (const n of scene.nodes) if (n.parent === group) nodePair[n.id] = key
      }
      return { edgePair: edgePair, nodePair: nodePair }
    }

    // A bus label is the documented `Bus-N` text, so a label can stand in for its bar.
    function drawioLabelBusId(lines) {
      if (!Array.isArray(lines) || lines.length === 0) return null
      const m = /^Bus-(\d+)$/.exec(String(lines[0]).trim())
      return m === null ? null : 'bus' + m[1]
    }

    // What one diagram cell stands for: a bus (its bar, or the Bus-N label above it) or a
    // branch (an edge, or a transformer symbol sitting on one). null for a cell that carries
    // no data — the page background and the legend.
    function drawioHoverTarget(node, pairs) {
      if (drawioIsBusId(node.id)) return { kind: 'bus', id: node.id }
      const fromLabel = drawioLabelBusId(node.lines)
      if (fromLabel !== null) return { kind: 'bus', id: fromLabel }
      if (pairs !== null && pairs.nodePair[node.id] !== undefined) {
        return { kind: 'branch', key: pairs.nodePair[node.id] }
      }
      return null
    }

    // The Host matches a bus id EXACTLY against the table spelling (Bus1), while a diagram
    // cell is bus1. The branch table names every bus it touches, so it supplies the canonical
    // spelling; an isolated bus, which no branch mentions, falls back to capitalising the cell.
    function drawioCanonicalBusId(canonical, nodeId) {
      const lower = String(nodeId).toLowerCase()
      if (canonical !== null && canonical !== undefined && canonical[lower] !== undefined) return canonical[lower]
      return String(nodeId).replace(/^bus/i, 'Bus')
    }

    // A bus-pair key back to something a person reads: bus4|bus7 -> Bus 4 to Bus 7.
    function drawioPairLabel(key) {
      const parts = String(key).split('|')
      const num = (id) => String(id).replace(/^bus/i, '')
      return parts.length === 2 ? 'Bus ' + num(parts[0]) + ' to Bus ' + num(parts[1]) : 'Branch'
    }

    // The tooltip when there is nothing to quote: the element still identifies itself, and
    // the second line says why there is no data rather than looking broken.
    function drawioFallbackTip(label, hasData) {
      return label + '\n' + (hasData ? '(not found in the case result tables)' : '(no result data — run ACLF)')
    }

    function drawioZoomPercent(scene, rect) {
      if (scene === null || rect === null || !Number.isFinite(rect.w) || rect.w <= 0) return 100
      const pct = Math.round((scene.viewBox.w / rect.w) * 100)
      return Number.isFinite(pct) && pct > 0 ? pct : 100
    }

    function DrawioDiagram(props) {
      const scene = props.scene
      const vb = props.view || scene.viewBox
      // Tooltips are opt-in: with no hover prop the renderer emits exactly what it always
      // did — no hit areas and no handlers — so a diagram still renders on its own.
      const hover = props.hover || null
      // `paint` (0.6.26) maps a cell id to the colour it should take -- the bus's flag colour from
      // config/net_diagram.json, a branch's flow-flag colour, or the search blue -- and `hidden`
      // (0.6.23) skips a whole cell. Both are paint-time only: with neither, every colour below is
      // exactly what it always was, and the .drawio on disk never learns any of it.
      const paint = props.paint || null
      const hidden = props.hidden || null
      // draw.io paints in the model's own document order, interleaving vertices and edges.
      // That order is load-bearing: this workspace's diagram declares `bg`, an opaque
      // 900x760 white rectangle, BEFORE its branches. Drawing every edge up front and every
      // vertex afterwards therefore put the page fill on top of all 27 branches, and the
      // preview showed a one-line diagram with no lines in it at all.
      const painted = []
      for (let i = 0; i < scene.edges.length; i += 1) {
        const e = scene.edges[i]
        if (hidden !== null && hidden[e.id] === true) continue
        const edgeColour = paint === null ? null : paint[e.id]
        const points = e.points.map((p) => p.x + ',' + p.y).join(' ')
        const parts = []
        // The invisible wide-stroke twin that makes a 1.5px branch hoverable.
        if (hover !== null && hover.pairs !== undefined && hover.pairs.edgePair[e.id] !== undefined) {
          parts.push(React.createElement('polyline', {
            key: 'h',
            points: points,
            fill: 'none',
            stroke: 'transparent',
            strokeWidth: DRAWIO_HIT_STROKE,
            pointerEvents: 'stroke',
            onMouseEnter: (ev) => hover.onBranch(hover.pairs.edgePair[e.id], ev),
            onMouseMove: hover.onMove,
            onMouseLeave: hover.onLeave,
          }))
        }
        parts.push(React.createElement('polyline', {
          key: 'l',
          points: points,
          fill: 'none',
          stroke: edgeColour === null || edgeColour === undefined ? drawioThemeColor(e.stroke) : edgeColour,
          strokeWidth: edgeColour === null || edgeColour === undefined ? e.strokeWidth : e.strokeWidth + 1.5,
          strokeDasharray: e.dashed ? '6 4' : undefined,
        }))
        if (e.arrow !== null) parts.push(React.createElement('polygon', { key: 'a', points: e.arrow, fill: edgeColour === null || edgeColour === undefined ? drawioThemeColor(e.stroke) : edgeColour }))
        if (e.label !== '') {
          parts.push(React.createElement('text', {
            key: 't',
            x: e.labelAt.x + 4, y: e.labelAt.y - 4,
            fontSize: 10, fill: drawioThemeColor(DRAWIO_TEXT),
          }, e.label))
        }
        painted.push({ order: e.order === undefined ? i : e.order, el: React.createElement('g', { key: 'e' + i }, parts) })
      }
      for (let i = 0; i < scene.nodes.length; i += 1) {
        const n = scene.nodes[i]
        if (hidden !== null && hidden[n.id] === true) continue
        const colour = paint === null ? null : paint[n.id]
        const marked = colour !== null && colour !== undefined
        const parts = []
        // A flagged or matched bus takes its colour on the bar's fill and outline, and on the
        // `Bus-N` text — but NOT on the label's white paper box, which must stay white so it keeps
        // masking the wires under the text. The scene object is never modified; the colour is
        // chosen here.
        const isBar = drawioIsBusId(n.id)
        if (n.kind === 'ellipse') {
          parts.push(React.createElement('ellipse', {
            key: 's',
            cx: n.x + n.w / 2, cy: n.y + n.h / 2, rx: n.w / 2, ry: n.h / 2,
            fill: n.fill === null ? 'none' : drawioThemeColor(n.fill),
            stroke: marked ? colour : drawioThemeColor(n.stroke),
            strokeWidth: marked ? n.strokeWidth + 1 : n.strokeWidth,
            strokeDasharray: n.dashed ? '6 4' : undefined,
          }))
        } else if (n.kind === 'rect') {
          parts.push(React.createElement('rect', {
            key: 's',
            x: n.x, y: n.y, width: n.w, height: n.h,
            rx: n.rounded ? Math.min(n.w, n.h) * (Number.isFinite(n.arcSize) ? n.arcSize : 0.15) : 0,
            fill: marked && isBar ? colour : (n.fill === null ? 'none' : drawioThemeColor(n.fill)),
            stroke: marked && isBar ? colour : drawioThemeColor(n.stroke),
            strokeWidth: n.strokeWidth,
            strokeDasharray: n.dashed ? '6 4' : undefined,
          }))
        }
        // A `text` cell draws no box of its own, so draw.io's `labelBackgroundColor` is the only
        // mask behind its glyphs -- and without it the wires run straight through the text. Painted
        // before the label and never tinted: a flag or a search colours the glyphs, not the mask,
        // exactly as the `rect`-kind paper box behaves.
        if (n.kind === 'text' && n.lines.length > 0 && n.labelBg !== null && n.labelBg !== undefined) {
          parts.push(React.createElement('rect', {
            key: 'bg',
            x: n.x, y: n.y, width: n.w, height: n.h,
            fill: drawioThemeColor(n.labelBg), stroke: 'none',
          }))
        }
        const labelNode = marked && !isBar ? Object.assign({}, n, { fontColor: colour }) : n
        const label = drawioLabel(labelNode, 't')
        if (label !== null) parts.push(label)
        // A transparent padded rect, so a 6px bar or a 16px transformer ring is comfortable
        // to hover. Added after the drawn geometry so it wins the hit test inside this group.
        const target = hover === null ? null : drawioHoverTarget(n, hover.pairs === undefined ? null : hover.pairs)
        if (target !== null) {
          parts.push(React.createElement('rect', {
            key: 'h',
            x: n.x - DRAWIO_HIT_PAD, y: n.y - DRAWIO_HIT_PAD,
            width: n.w + DRAWIO_HIT_PAD * 2, height: n.h + DRAWIO_HIT_PAD * 2,
            fill: 'transparent', stroke: 'none', pointerEvents: 'all',
            onMouseEnter: (ev) => (target.kind === 'bus' ? hover.onBus(target.id, ev) : hover.onBranch(target.key, ev)),
            onMouseMove: hover.onMove,
            onMouseLeave: hover.onLeave,
          }))
        }
        painted.push({ order: n.order === undefined ? i : n.order, el: React.createElement('g', { key: 'n' + i }, parts) })
      }
      // A stable sort, so a model with no order recorded keeps edges before vertices.
      painted.sort((a, b) => a.order - b.order)
      const children = painted.map((p) => p.el)
      return React.createElement('svg', {
        viewBox: vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h,
        preserveAspectRatio: 'xMidYMid meet',
        style: { width: '100%', height: '100%', display: 'block' },
      }, children)
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
        // A dynamic Client half has no setInterval/window: the Cordis timer service owns
        // the repeat and its disposer is returned from this effect. The persistent
        // bundle's window-focus refresh has no equivalent here, so the poll is the only
        // trigger.
        const stopPolling = ctx.timer.interval(sync, 4000)
        return () => {
          alive = false
          stopPolling()
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
        // This tab owns the current case; the Diagram tab reads the shared value when it
        // mounts, so selecting a case here is what decides what that tab draws.
        selectedCaseInput = input
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
          return 'over loading threshold must be a percentage between 0 and 1000'
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
                // The over loading threshold the dialog shows; kept as typed so the input
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
            // 12 = QGen, the only gen column the model returns as a full-precision float
            return renderConnTable(connResult.genHeader, connResult.genRows, [3, 4, 6, 9, 10, 11, 12, 13, 14, 15], { 12: 4 })
          }
          return React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'No generators connected to this bus.')
        }
        if (connView === 'load') {
          if (connResult.loadRows && connResult.loadRows.length > 0) {
            return renderConnTable(connResult.loadHeader, connResult.loadRows, [3, 4, 5, 6, 7, 8, 9, 10])
          }
          return React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'No loads connected to this bus.')
        }
        // 19/20 = PFrom2To / QFrom2To; `idx` keeps its default column list
        return renderConnTable(connResult.header, connResult.rows, null, { 19: 4, 20: 4 })
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
            React.createElement('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, 'Over Loading Threshold(%):'),
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

    // --- Diagram tab --------------------------------------------------------
    // The one-line diagram of the case selected in the InterPSS tab, as its own
    // conversation view (order 2, between InterPSS and Trajectory) — one `readDrawio` RPC,
    // the self-contained SVG renderer, pan/zoom and the bus/branch tooltips, laid out
    // full-size. Since 0.6.9 it is the ONLY preview surface: the InterPSS tab's action row
    // no longer carries a **Diagram** button, and the modal that button opened is gone.
    // The case is deliberately NOT chosen here: the view follows the shared selection, so
    // the two tabs cannot disagree about the current case, and it adds no Host endpoint.
    function DiagramView(props) {
      const sessionId = props && props.sessionId
      const callRemote = props && props.callRemote
      const [caseInput, setCaseInput] = React.useState(selectedCaseInput)
      const [files, setFiles] = React.useState(null)
      const [filesLoading, setFilesLoading] = React.useState(false)
      const [filesError, setFilesError] = React.useState(null)
      const [path, setPath] = React.useState('')
      const [xml, setXml] = React.useState('')
      const [scene, setScene] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [view, setView] = React.useState('rendered')
      const [resultDir, setResultDir] = React.useState(null)
      const [branchFile, setBranchFile] = React.useState(null)
      const [busFile, setBusFile] = React.useState(null)
      // Which buses the renderer paints red: a lowercase `busN` -> true lookup built from the bus
      // result table's `VoltMag` column. Empty (or null) means "nothing to annotate", which is
      // also the state when the case has no results at all.
      const [busAlerts, setBusAlerts] = React.useState(null)
      // Pan/zoom of the rendered pane: the visible rectangle in scene coordinates, or null
      // for "fit the whole diagram". Declared with the other state, above every reader.
      const [rect, setRect] = React.useState(null)
      const [dragging, setDragging] = React.useState(false)
      const [tip, setTip] = React.useState(null)
      // The "edit in the local draw.io app" button: in flight while the Host launches, and the
      // one-line outcome under the toolbar. Neither belongs to a case, so they are cleared when
      // a different diagram is opened.
      const [editBusy, setEditBusy] = React.useState(false)
      const [editMsg, setEditMsg] = React.useState(null)
      // Search and filter (0.6.23). `dialog` is which modal is open; the dialog's own fields are
      // separate from what is APPLIED, so Cancel really does cancel (the applied value is only
      // written by OK). `busMeta` is the case's bus table (area/zone/name per bus), loaded on
      // demand when a dialog opens -- the drawing path itself never waits for it.
      const [dialog, setDialog] = React.useState(null)
      const [searchText, setSearchText] = React.useState('')
      const [searchQuery, setSearchQuery] = React.useState(null)
      const [filterArea, setFilterArea] = React.useState('')
      const [filterZone, setFilterZone] = React.useState('')
      const [filterOutOfBand, setFilterOutOfBand] = React.useState(false)
      // The two flow criteria (0.6.32): "only branches at or above a configured loading".
      const [filterBasecaseLoading, setFilterBasecaseLoading] = React.useState(false)
      const [filterContingencyLoading, setFilterContingencyLoading] = React.useState(false)
      const [filterApplied, setFilterApplied] = React.useState(null)
      const [busMeta, setBusMeta] = React.useState(null)
      const [busMetaLoading, setBusMetaLoading] = React.useState(false)
      // config/net_diagram.json (0.6.26): the flag thresholds and colours the Host hands back, the
      // dialog's draft copy of them, and the flow tables the branch flags are read from. The config
      // read never blocks the drawing: until it lands, the built-in defaults paint what 0.6.24 did.
      const [netConfig, setNetConfig] = React.useState(DRAWIO_NET_DEFAULTS)
      const [netConfigPath, setNetConfigPath] = React.useState('config/net_diagram.json')
      const [netConfigWarning, setNetConfigWarning] = React.useState(null)
      const [netConfigError, setNetConfigError] = React.useState(null)
      const [netConfigSaving, setNetConfigSaving] = React.useState(false)
      const [cfgForm, setCfgForm] = React.useState(null)
      const [conFile, setConFile] = React.useState(null)
      const [branchLoads, setBranchLoads] = React.useState(null)
      const [conLoads, setConLoads] = React.useState(null)
      const canvasRef = React.useRef(null)
      const dragRef = React.useRef(null)
      // Tooltip data keyed to the SELECTED case: the branch
      // table indexed by bus pair, the canonical BusN spelling the Host matches on, the bus
      // records `busConnections` hands back (filled lazily, one call per bus hovered), the
      // open scene's resolved branch pairs, and what is under the cursor right now so a
      // late answer can be dropped.
      const dataRef = React.useRef({ branch: null, canonical: null, busCache: {}, pairs: null, hovered: null })

      // Follow a case the Host loaded from chat. One shot rather than a poll: this view is
      // unmounted while the Chat view runs a tool, so a fresh mount is exactly the moment
      // the bridge answer can have changed, and the tab needs no timer of its own.
      React.useEffect(() => {
        let alive = true
        callRemote('getBridgeCase', { sessionId }).then(
          (res) => {
            if (!alive || res === null || res === undefined || res.ok !== true) return
            const input = typeof res.case === 'string' ? res.case : ''
            if (input === '' || input === bridgeCaseSeen) return
            bridgeCaseSeen = input
            if (input === selectedCaseInput) return
            adoptSelectedCase(input)
            setCaseInput(input)
          },
          () => {},
        )
        return () => { alive = false }
      }, [])

      // Everything the tab shows is keyed to the selected case: its `diagram/` folder for
      // the picker, and the result tables the tooltips quote. `diagramSeq` drops an answer
      // that arrives after the user has already moved off the case it belongs to.
      React.useEffect(() => {
        const seq = ++diagramSeq
        dataRef.current = { branch: null, canonical: null, busCache: {}, pairs: null, hovered: null }
        setFiles(null)
        setFilesError(null)
        setResultDir(null)
        setBranchFile(null)
        setBusFile(null)
        setConFile(null)
        setBusAlerts(null)
        setBranchLoads(null)
        setConLoads(null)
        setTip(null)
        setPath('')
        setXml('')
        setScene(null)
        setError(null)
        setRect(null)
        if (typeof caseInput !== 'string' || caseInput === '') {
          setFiles([])
          setFilesLoading(false)
          return undefined
        }
        setFilesLoading(true)
        callRemote('listDrawioFiles', { case: caseInput, sessionId }).then(
          (res) => {
            if (seq !== diagramSeq) return
            setFilesLoading(false)
            if (res === null || res === undefined || res.ok !== true) {
              setFiles([])
              setFilesError(res && res.error ? res.error : 'failed to list the case diagrams')
              return
            }
            const list = res.files || []
            setFiles(list)
            const next = drawioTabChoice(list, diagramChoice)
            if (next !== null) openDiagram(next)
          },
          (err) => {
            if (seq !== diagramSeq) return
            setFilesLoading(false)
            setFiles([])
            setFilesError(String(err && err.message ? err.message : err))
          },
        )
        callRemote('checkResult', { input: caseInput, sessionId }).then(
          (res) => {
            if (seq !== diagramSeq) return
            if (res === null || res === undefined || res.ok !== true || res.exists !== true) return
            setResultDir(typeof res.resultDir === 'string' ? res.resultDir : null)
            const branch = (res.files || []).find((f) => String(f).indexOf('_DF_branch.csv') !== -1)
            setBranchFile(branch === undefined ? null : branch)
            const bus = (res.files || []).find((f) => String(f).indexOf('_DF_bus.csv') !== -1)
            setBusFile(bus === undefined ? null : bus)
            const con = (res.files || []).find((f) => String(f).indexOf('_DF_contingency.csv') !== -1)
            setConFile(con === undefined ? null : con)
          },
          () => {},
        )
        return undefined
      }, [caseInput])

      // The tooltips quote `<case>/result/<stem>_DF_branch.csv`; index it by bus pair once
      // per result. Read in pages, and the LINES are split here because `readCsv` hands back
      // raw CSV rows while `branchTooltip` wants columns.
      React.useEffect(() => {
        dataRef.current.busCache = {}
        dataRef.current.hovered = null
        dataRef.current.branch = null
        dataRef.current.canonical = null
        if (branchFile === null || resultDir === null) return undefined
        const pair = new Map()
        const canonical = {}
        const allRows = []
        const page = (start, guard) => {
          if (guard > 20) return
          callRemote('readCsv', { path: resultDir + '/' + branchFile, sessionId: sessionId, start: start, limit: 5000 }).then(
            (res) => {
              if (res === null || res === undefined || res.ok !== true) return
              const rows = res.rows || []
              for (const line of rows) allRows.push(line)
              for (const line of rows) {
                const c = String(line).split(',')
                const from = String(c[4] || '').trim()
                const to = String(c[7] || '').trim()
                if (from === '' || to === '') continue
                canonical[from.toLowerCase()] = from
                canonical[to.toLowerCase()] = to
                const key = [from.toLowerCase(), to.toLowerCase()].sort().join('|')
                if (!pair.has(key)) pair.set(key, [])
                pair.get(key).push(c)
              }
              if (res.hasMore === true) { page(start + rows.length, guard + 1); return }
              dataRef.current.branch = pair
              dataRef.current.canonical = canonical
              // The same page loop feeds the base-case flow flags: the percent column and the two
              // bus columns are located by header NAME, so a reordered table cannot flag the wrong
              // branches.
              setBranchLoads(drawioBranchLoads(res.header, allRows))
            },
            () => {},
          )
        }
        page(0, 0)
        return undefined
      }, [branchFile, resultDir])

      // The render-time voltage annotation: read `<case>/result/<stem>_DF_bus.csv` and keep the
      // buses whose `VoltMag` is outside the band config/net_diagram.json sets (0.9-1.1 by default). The columns come from the file's own
      // header (never by position), the ids are lowercased so they match the diagram's `busN`
      // cells, and the paging stops early — a page that has answered for no bus the open scene
      // draws is the common case, which is what keeps a 2000-bus (or 78k-bus) table cheap.
      // Nothing in this path writes: the .drawio stays read-only for the whole feature.
      React.useEffect(() => {
        if (busFile === null || resultDir === null) { setBusAlerts(null); return undefined }
        let alive = true
        const wanted = {}
        if (scene !== null) {
          for (const n of scene.nodes) {
            const id = drawioBusCellId(n)
            if (id !== null) wanted[String(id).toLowerCase()] = true
          }
        }
        const hits = {}
        const page = (start, guard) => {
          if (guard > 20) return
          callRemote('readCsv', { path: resultDir + '/' + busFile, sessionId: sessionId, start: start, limit: 5000 }).then(
            (res) => {
              if (!alive) return
              if (res === null || res === undefined || res.ok !== true) { setBusAlerts(null); return }
              const rows = res.rows || []
              const found = drawioBusAlerts(res.header, rows, wanted,
                [netConfig.Bus_flag_lower_limit, netConfig.Bus_flag_upper_limit])
              for (const id of Object.keys(found)) hits[id] = true
              if (res.hasMore === true) { page(start + rows.length, guard + 1); return }
              setBusAlerts(hits)
            },
            () => { if (alive) setBusAlerts(null) },
          )
        }
        page(0, 0)
        return () => { alive = false }
      }, [busFile, resultDir, scene, netConfig.Bus_flag_lower_limit, netConfig.Bus_flag_upper_limit])

      // config/net_diagram.json (0.6.26), read once per case. It lives at the workspace root and the
      // Host hands back a sanitized copy, so this side never has to trust the file; a failure keeps
      // the built-in defaults and the diagram still draws.
      React.useEffect(() => {
        let alive = true
        callRemote('getNetDiagramOptions', { sessionId: sessionId }).then(
          (res) => {
            if (!alive) return
            if (res === null || res === undefined || res.ok !== true) {
              setNetConfigWarning(res && res.error ? String(res.error) : null)
              return
            }
            setNetConfig(drawioNetConfig(res.config))
            setNetConfigPath(typeof res.path === 'string' && res.path !== '' ? res.path : 'config/net_diagram.json')
            setNetConfigWarning(res.warning ? String(res.warning) : null)
          },
          (err) => { if (alive) setNetConfigWarning(String(err && err.message ? err.message : err)) },
        )
        return () => { alive = false }
      }, [caseInput])

      // The contingency flow flags: the CA result table, when the case has one. Its BranchID is
      // `Bus1001->Bus1064(1)`, so the pair is the head of the string; the loading column is located
      // by name like every other table read here.
      React.useEffect(() => {
        if (conFile === null || resultDir === null) { setConLoads(null); return undefined }
        let alive = true
        const all = []
        const page = (start, guard) => {
          if (guard > 20) return
          callRemote('readCsv', { path: resultDir + '/' + conFile, sessionId: sessionId, start: start, limit: 5000 }).then(
            (res) => {
              if (!alive) return
              if (res === null || res === undefined || res.ok !== true) { setConLoads(null); return }
              const rows = res.rows || []
              for (const line of rows) all.push(line)
              if (res.hasMore === true) { page(start + rows.length, guard + 1); return }
              setConLoads(drawioContingencyLoads(res.header, all))
            },
            () => { if (alive) setConLoads(null) },
          )
        }
        page(0, 0)
        return () => { alive = false }
      }, [conFile, resultDir])

      // The preview's read: fetch the .drawio, decode it
      // (plain or compressed) and resolve element -> branch once, not on every repaint.
      // `diagramLoadSeq` drops a diagram the user has already switched away from.
      function openDiagram(next) {
        if (typeof next !== 'string' || next === '') return
        diagramChoice = next
        const seq = ++diagramLoadSeq
        setPath(next)
        setXml('')
        setScene(null)
        setError(null)
        setView('rendered')
        setRect(null)
        setEditMsg(null)
        setLoading(true)
        callRemote('readDrawio', { path: next, sessionId }).then(
          (res) => {
            if (res === null || res === undefined || res.ok !== true) {
              throw new Error(res && res.error ? res.error : 'failed to read the diagram')
            }
            if (seq !== diagramLoadSeq) return null
            setXml(res.xml)
            return diagramXmlFrom(res.xml)
          },
        ).then(
          (text) => {
            if (text === null || seq !== diagramLoadSeq) return
            const parsed = parseDrawioScene(text)
            dataRef.current.pairs = drawioBranchPairs(parsed)
            setScene(parsed)
            setLoading(false)
          },
          (err) => {
            if (seq !== diagramLoadSeq) return
            setLoading(false)
            setError(String(err && err.message ? err.message : err))
          },
        )
      }

      // --- Tooltips -----------------------------------------------------------
      function branchPath() {
        return branchFile === null || resultDir === null ? null : resultDir + '/' + branchFile
      }

      function showTip(text, e) {
        setTip({ text: text, x: e.clientX, y: e.clientY })
      }
      function moveTip(e) {
        setTip((t) => (t ? { text: t.text, x: e.clientX, y: e.clientY } : t))
      }
      function hideTip() {
        setTip(null)
      }

      // Hand the open diagram to the local draw.io app. The browser cannot start a process, so
      // the Host does it — and `open` reports success as soon as the OS has the file, so a
      // success here means "launched", never "saved". A failure prints the Host's own reason
      // (which launcher it tried, and what that launcher said) instead of a bare error.
      function openInDrawio() {
        if (path === '' || editBusy) return
        setEditBusy(true)
        setEditMsg(null)
        const target = path
        callRemote('openDrawio', { path: target, sessionId }).then(
          (res) => {
            setEditBusy(false)
            if (res !== null && res !== undefined && res.ok === true) {
              setEditMsg({ ok: true, text: 'Launched draw.io' + (res.launcher ? ' (' + res.launcher + ')' : '') })
              return
            }
            setEditMsg({ ok: false, text: 'Could not launch draw.io: ' + (res && res.error ? res.error : 'unknown error') })
          },
          (err) => {
            setEditBusy(false)
            setEditMsg({ ok: false, text: 'Could not launch draw.io: ' + String(err && err.message ? err.message : err) })
          },
        )
      }

      // The bus tooltip the connection diagram shows, plus the one line that explains a red bar.
      // A colour alone is not accessible, and this is the surface a reader already opens for a bus.
      function diagramBusText(record) {
        const text = busTooltip(record)
        if (busAlerts === null) return text
        const id = record !== null && record !== undefined && record.id !== undefined ? String(record.id).toLowerCase() : ''
        if (id === '' || busAlerts[id] !== true) return text
        return text + '\n⚠ |V| outside ' + netConfig.Bus_flag_lower_limit + '\u2013' + netConfig.Bus_flag_upper_limit + ' pu'
      }

      // A cache hit answers instantly; otherwise the bus says who it is, one call fills the
      // cache for it AND its branch neighbours, and the tip is rewritten only if that same
      // bus is still under the cursor.
      function diagramBusTip(nodeId, event) {
        const data = dataRef.current
        const busId = drawioCanonicalBusId(data.canonical, nodeId)
        data.hovered = { kind: 'bus', id: busId }
        const known = data.busCache[busId]
        if (known !== undefined) {
          showTip(diagramBusText(known), event)
          return
        }
        showTip(drawioFallbackTip(String(busId), data.branch !== null), event)
        const target = branchPath()
        if (target === null) return
        callRemote('busConnections', { busId: busId, path: target, sessionId: sessionId }).then(
          (res) => {
            if (res === null || res === undefined || res.ok !== true) return
            for (const rec of (res.busRecords || [])) data.busCache[rec.id] = rec
            const now = data.hovered
            const filled = data.busCache[busId]
            if (filled === undefined || now === null || now.kind !== 'bus' || now.id !== busId) return
            setTip((t) => (t === null ? t : { text: diagramBusText(filled), x: t.x, y: t.y }))
          },
          () => {},
        )
      }

      // An edge, either half of a transformer chain, or the symbol itself. Parallel circuits
      // between one bus pair all match and are rendered one block each.
      function diagramBranchTip(key, event) {
        const data = dataRef.current
        data.hovered = { kind: 'branch', key: key }
        const rows = data.branch === null || data.branch === undefined ? undefined : data.branch.get(key)
        const contingency = conLoads === null || conLoads === undefined ? null : conLoads[key]
        showTip(rows === undefined || rows.length === 0
          ? drawioFallbackTip(drawioPairLabel(key), data.branch !== null)
          : rows.map((r) => branchTooltip(r, { contingencyLoading: contingency })).join('\n\n'), event)
      }

      // --- Pan / zoom ---------------------------------------------------------
      // One SVG with a moving viewBox: the wheel zooms about the
      // cursor, dragging pans, and Fit returns to the scene's own viewBox.
      function currentRect() {
        if (scene === null) return null
        return rect === null ? drawioFitRect(scene.viewBox) : rect
      }

      function metrics(r) {
        const el = canvasRef.current
        if (el === null || typeof el.getBoundingClientRect !== 'function') return null
        const box = el.getBoundingClientRect()
        if (!(box.width > 0) || !(box.height > 0)) return null
        const scale = Math.min(box.width / r.w, box.height / r.h)
        if (!Number.isFinite(scale) || scale <= 0) return null
        return { box: box, scale: scale, offX: (box.width - r.w * scale) / 2, offY: (box.height - r.h * scale) / 2 }
      }

      // `preserveAspectRatio="xMidYMid meet"` letterboxes the scene inside the element, so
      // the anchor is computed through the box actually drawn — the smaller of the two
      // ratios, centred — not the element's own box.
      function applyZoom(factor, clientX, clientY) {
        const r = currentRect()
        if (r === null) return
        const limits = drawioZoomLimits(scene.viewBox)
        const m = metrics(r)
        if (m === null) { setRect(drawioZoomRect(r, factor, 0.5, 0.5, limits)); return }
        const sx = r.x + (clientX - m.box.left - m.offX) / m.scale
        const sy = r.y + (clientY - m.box.top - m.offY) / m.scale
        setRect(drawioZoomRect(r, factor, (sx - r.x) / r.w, (sy - r.y) / r.h, limits))
      }

      function stepZoom(factor) {
        const r = currentRect()
        if (r === null) return
        setRect(drawioZoomRect(r, factor, 0.5, 0.5, drawioZoomLimits(scene.viewBox)))
      }

      // A percentage picked from the readout sets that zoom level about the centre of what is on
      // screen. The height comes from the scene's own aspect (not the rect's), so a sequence of
      // picks cannot drift the view into a letterbox, and the width is clamped by the same limits
      // the wheel uses -- which is why an extreme pick lands on the limit and the readout then
      // shows that limit rather than the number that was asked for.
      function setZoomPercent(pct) {
        if (scene === null || !Number.isFinite(pct) || pct <= 0) return
        const r = currentRect()
        if (r === null) return
        const vb = scene.viewBox
        const limits = drawioZoomLimits(vb)
        const w = Math.min(limits.maxW, Math.max(limits.minW, vb.w * 100 / pct))
        const h = w * (vb.h / vb.w)
        const cx = r.x + r.w / 2
        const cy = r.y + r.h / 2
        setRect({ x: cx - w / 2, y: cy - h / 2, w: w, h: h })
      }

      function fit() {
        setRect(null)
        dragRef.current = null
        setDragging(false)
      }

      // Registered natively rather than as onWheel so preventDefault is permitted: React
      // delegates wheel passively, which would scroll the panel while zooming.
      React.useEffect(() => {
        if (scene === null) return undefined
        const el = canvasRef.current
        if (el === null || typeof el.addEventListener !== 'function') return undefined
        const onWheel = (e) => {
          if (e.preventDefault) e.preventDefault()
          applyZoom(drawioWheelFactor(e.deltaY), e.clientX, e.clientY)
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
      }, [scene, rect])

      // A tip must not outlive the diagram it describes.
      React.useEffect(() => {
        setTip(null)
        dataRef.current.hovered = null
        return undefined
      }, [path])

      function pointerDown(e) {
        const r = currentRect()
        if (r === null) return
        const m = metrics(r)
        if (m === null) return
        dragRef.current = { x: e.clientX, y: e.clientY, scale: m.scale }
        setDragging(true)
        if (e.preventDefault) e.preventDefault()
      }

      function pointerMove(e) {
        const r = currentRect()
        const drag = dragRef.current
        if (r === null || drag === null) return
        const dx = (e.clientX - drag.x) / drag.scale
        const dy = (e.clientY - drag.y) / drag.scale
        dragRef.current = { x: e.clientX, y: e.clientY, scale: drag.scale }
        setRect(drawioPanRect(r, -dx, -dy))
      }

      function pointerUp() {
        dragRef.current = null
        setDragging(false)
      }

      const fileCount = files === null ? 0 : files.length
      const selectStyle = { padding: '0 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', height: '30px', boxSizing: 'border-box', maxWidth: '420px' }

      // The tab's top row: the case it follows on the left, and the one control that leaves the
      // app — the draw.io edit button — in the upper-right corner. The button is deliberately
      // NOT in the toolbar below (that row is view/zoom only) and deliberately not on a row of
      // its own at the bottom: the drawing is taller than the panel, so a bottom row lands below
      // the fold and the button looks like it vanished (0.6.13) or has to be pinned with sticky
      // (0.6.14). The header keeps it in view, beside the drawing's own controls.
      const editControls = path !== ''
        ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          editMsg !== null ? React.createElement('span', {
            style: { fontSize: '12px', maxWidth: '360px', textAlign: 'right', color: editMsg.ok ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-state-error-primary)' },
          }, editMsg.text) : null,
          React.createElement('button', {
            onClick: openInDrawio,
            disabled: editBusy,
            title: 'Edit this diagram in the local draw.io app',
            'aria-label': 'Edit this diagram in the local draw.io app',
            style: { ...btn, padding: '4px 7px', display: 'inline-flex', alignItems: 'center', opacity: editBusy ? 0.6 : 1, cursor: editBusy ? 'progress' : 'pointer' },
          }, drawioAppIcon),
          // The gear (0.6.26): config/net_diagram.json, the flag thresholds and colours the
          // drawing below is painted with. It sits in this row, not the toolbar, so the toolbar's
          // controls stay the ones the mock specifies.
          React.createElement('button', {
            onClick: openConfig,
            title: 'One-line diagram config options',
            'aria-label': 'One-line diagram config options',
            style: { ...btn, padding: '4px 7px', display: 'inline-flex', alignItems: 'center' },
          }, drawioGearIcon),
        )
        : null

      // --- search and filter (0.6.23) -----------------------------------------
      // Both dialogs need the case's bus table (area, zone, and a name to search on), so it is
      // fetched once, on demand: opening either dialog starts the read and OK stays disabled until
      // it lands. The drawing path itself never waits for it, so a 78k-bus case still opens fast.
      function ensureBusMeta() {
        if (busMeta !== null || busMetaLoading || busFile === null || resultDir === null) return
        setBusMetaLoading(true)
        let acc = { areas: [], zones: [], ofBus: {} }
        const page = (start, guard) => {
          if (guard > 20) {
            setBusMeta(acc)
            setBusMetaLoading(false)
            return
          }
          callRemote('readCsv', { path: resultDir + '/' + busFile, sessionId: sessionId, start: start, limit: 5000 }).then(
            (res) => {
              if (res === null || res === undefined || res.ok !== true) { setBusMetaLoading(false); return }
              const rows = res.rows || []
              acc = drawioBusMeta(res.header, rows, acc)
              if (res.hasMore === true) { page(start + rows.length, guard + 1); return }
              setBusMeta(acc)
              setBusMetaLoading(false)
            },
            () => setBusMetaLoading(false),
          )
        }
        page(0, 0)
      }

      function openSearch() {
        setSearchText(searchQuery === null ? '' : searchQuery)
        setDialog('search')
        ensureBusMeta()
      }

      function openFilter() {
        const f = filterApplied === null
          ? { area: '', zone: '', outOfBand: false, basecaseLoading: false, contingencyLoading: false }
          : filterApplied
        setFilterArea(f.area === undefined || f.area === null ? '' : String(f.area))
        setFilterZone(f.zone === undefined || f.zone === null ? '' : String(f.zone))
        setFilterOutOfBand(f.outOfBand === true)
        setFilterBasecaseLoading(f.basecaseLoading === true)
        setFilterContingencyLoading(f.contingencyLoading === true)
        setDialog('filter')
        ensureBusMeta()
      }

      function closeDialog() {
        setDialog(null)
      }

      // OK is what applies: the dialog's fields are the draft, so closing with Cancel leaves the
      // drawing exactly as it was.
      function applySearch() {
        const q = String(searchText).trim()
        setSearchQuery(q === '' ? null : q)
        setDialog(null)
      }

      function applyFilter() {
        const next = { area: filterArea, zone: filterZone, outOfBand: filterOutOfBand,
          basecaseLoading: filterBasecaseLoading, contingencyLoading: filterContingencyLoading }
        setFilterApplied(next.area === '' && next.zone === '' && next.outOfBand !== true
          && next.basecaseLoading !== true && next.contingencyLoading !== true ? null : next)
        setDialog(null)
      }

      // The gear dialog (0.6.26). The form is a draft, like the filter's: only OK sanitizes and
      // saves, and the drawing's flags follow the saved values when the Host answers.
      function openConfig() {
        setCfgForm(drawioNetConfig(netConfig))
        setNetConfigError(null)
        setDialog('config')
      }

      function applyConfig() {
        const errors = drawioNetConfigErrors(cfgForm)
        const keys = Object.keys(errors)
        if (keys.length > 0) {
          setNetConfigError('check ' + keys.length + (keys.length === 1 ? ' field: ' : ' fields: ') + keys.join(', '))
          return
        }
        setNetConfigSaving(true)
        setNetConfigError(null)
        callRemote('saveNetDiagramOptions', { config: cfgForm, sessionId: sessionId }).then(
          (res) => {
            setNetConfigSaving(false)
            if (res !== null && res !== undefined && res.ok === true) {
              setNetConfig(drawioNetConfig(res.config === undefined ? cfgForm : res.config))
              setNetConfigWarning(null)
              setDialog(null)
              return
            }
            setNetConfigError(res && res.error ? String(res.error) : 'failed to save ' + netConfigPath)
          },
          (err) => { setNetConfigSaving(false); setNetConfigError(String(err && err.message ? err.message : err)) },
        )
      }

      function clearSearchFilter() {
        setSearchQuery(null)
        setSearchText('')
        setFilterApplied(null)
      }

      // Both are pure functions of the scene plus the bus table, recomputed per render. Nothing
      // here writes: the highlight and the hiding are paint-time, like the voltage alert.
      const busNames = busMeta === null ? null : (function () {
        const names = {}
        for (const key of Object.keys(busMeta.ofBus)) names[key] = busMeta.ofBus[key].name
        return names
      })()
      const searchHits = searchQuery === null || scene === null
        ? null : drawioSearchHits(searchQuery, scene.nodes, scene.edges, busNames)
      const filterHits = filterApplied === null || scene === null
        ? null : drawioFilterHidden(filterApplied, scene.nodes, scene.edges, busMeta, busAlerts, netConfig,
          branchLoads, conLoads)
      // Everything that colours a cell, merged here rather than in the renderer, so precedence is
      // one readable rule: the flags first (bus, then base case, then contingency -- the last wins
      // inside drawioFlagPaint), and the search blue over the top, because a search is the
      // deliberate act. The renderer only sees cell id -> colour.
      const flagPaint = scene === null
        ? null : drawioFlagPaint(scene.nodes, scene.edges, netConfig, busAlerts, branchLoads, conLoads)
      const paintMap = drawioMergedPaint(flagPaint, searchHits, DRAWIO_MATCH_FILL)
      // The status line's counts, per family, with the thresholds the config set.
      // Built once per scene (not per zoom): two path strings for the whole drawing, or null when
      // there is nothing to show.
      const birdseyePaths = scene === null ? null : drawioBirdseyePaths(scene)
      // A click or drag on the thumbnail puts the same-size window where it landed, held inside the
      // drawing.
      function centreFromBirdseye(e) {
        if (scene === null || birdseyePaths === null) return
        const el = e && e.currentTarget !== undefined && e.currentTarget !== null ? e.currentTarget : null
        if (el === null || typeof el.getBoundingClientRect !== 'function') return
        const box = el.getBoundingClientRect()
        if (box.width <= 0 || box.height <= 0) return
        const vb = scene.viewBox
        // The svg meets the scene into its box, so the drawn area is inset when the aspects differ:
        // measure the scene's own edges by where the viewBox corners land.
        const scale = Math.min(box.width / vb.w, box.height / vb.h)
        const drawW = vb.w * scale
        const drawH = vb.h * scale
        const left = box.left + (box.width - drawW) / 2
        const top = box.top + (box.height - drawH) / 2
        const fx = (e.clientX - left) / (drawW || 1)
        const fy = (e.clientY - top) / (drawH || 1)
        setRect(drawioBirdseyeRect(scene, currentRect(), fx, fy))
      }

      const flagCounts = (function () {
        const buses = busAlerts === null ? 0 : Object.keys(busAlerts).length
        const above = (loads, threshold) => (loads === null || loads === undefined ? 0
          : Object.keys(loads).filter((k) => loads[k] >= threshold).length)
        const base = above(branchLoads, netConfig.Basecase_branch_flow_flag_percent)
        const cont = above(conLoads, netConfig.Contingency_branch_flow_flag_percent)
        if (buses + base + cont === 0) return null
        const parts = []
        if (buses > 0) parts.push(buses + (buses === 1 ? ' bus ' : ' buses ') + netConfig.Bus_flag_lower_limit + '\u2013' + netConfig.Bus_flag_upper_limit + ' pu')
        if (base > 0) parts.push(base + (base === 1 ? ' branch ' : ' branches ') + '\u2265' + netConfig.Basecase_branch_flow_flag_percent + '%')
        if (cont > 0) parts.push(cont + ' contingency \u2265' + netConfig.Contingency_branch_flow_flag_percent + '%')
        return 'flags: ' + parts.join(' \u00b7 ')
      })()
      // The dialog's own message previews the DRAFT, so changing Area or Zone updates it immediately
      // (0.6.24). The drawing still waits for OK: only the sentence is live.
      const draftHits = scene === null
        ? null : drawioFilterHidden({ area: filterArea, zone: filterZone, outOfBand: filterOutOfBand,
          basecaseLoading: filterBasecaseLoading, contingencyLoading: filterContingencyLoading },
        scene.nodes, scene.edges, busMeta, busAlerts, netConfig, branchLoads, conLoads)
      const statusText = searchHits !== null
        ? (searchHits.nBus + searchHits.nBranch === 0
          ? 'no match'
          : searchHits.nBus + (searchHits.nBus === 1 ? ' bus' : ' buses')
            + (searchHits.nBranch > 0
              ? ', ' + searchHits.nBranch + (searchHits.nBranch === 1 ? ' branch' : ' branches') : ''))
        : (filterHits !== null && filterHits.label !== '' ? 'filter: ' + filterHits.label : null)
      // A filter that names an area or a zone cannot be applied before the bus table arrives.
      const filterNeedsMeta = filterArea !== '' || filterZone !== ''

      const dialogShell = (title, bodyEl, onOk, okDisabled) => React.createElement('div', {
        style: { position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
      }, React.createElement('div', {
        role: 'dialog',
        'aria-label': title,
        style: { background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '18px', width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)' },
      },
        React.createElement('div', { style: { fontSize: '14px', fontWeight: 600 } }, title),
        bodyEl,
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
          React.createElement('button', { key: 'cancel', onClick: closeDialog, style: { ...btn, padding: '5px 14px' } }, 'Cancel'),
          React.createElement('button', {
            key: 'ok', onClick: onOk, disabled: okDisabled === true,
            style: { ...btn, padding: '5px 14px', borderColor: 'var(--dsw-alias-brand-primary)', opacity: okDisabled === true ? 0.5 : 1 },
          }, 'OK'),
        ),
      ))

      const fieldRow = (label, control) => React.createElement('label', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', fontSize: '12px' },
      }, React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, label), control)

      const hintStyle = { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' }
      // The search dialog's help is about THIS case: how many buses it draws, the range, a branch
      // example from its own numbers, and a name to try when its result table carries names.
      const searchHelp = drawioSearchHelp(scene, busMeta)
      const cfgErrors = dialog === 'config' ? drawioNetConfigErrors(cfgForm) : {}
      const cfgField = (field) => {
        const raw = cfgForm === null || cfgForm === undefined ? '' : cfgForm[field.key]
        const value = raw === null || raw === undefined ? '' : String(raw)
        const bad = cfgErrors[field.key] !== undefined
        const input = React.createElement('input', {
          value: value,
          'aria-label': field.label,
          onChange: (e) => setCfgForm(Object.assign({}, cfgForm, { [field.key]: e.target.value })),
          style: Object.assign({}, selectStyle, {
            width: '150px', minWidth: '150px', maxWidth: '150px', height: '28px',
            borderColor: bad ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-border-l1)',
          }),
        })
        const control = field.kind === 'color'
          ? React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, input,
            React.createElement('span', {
              title: value,
              style: { width: '14px', height: '14px', borderRadius: '3px', background: value === '' ? 'transparent' : value, border: '1px solid var(--dsw-alias-border-l1)' },
            }))
          : field.kind === 'boolean'
            // A switch is a checkbox, not a text box: `true`/`false` typed by hand is a config-file
            // job, and the sanitizer accepts both spellings for anyone who does it there.
            ? React.createElement('input', {
              type: 'checkbox',
              checked: raw === true || String(raw).trim().toLowerCase() === 'true',
              'aria-label': field.label,
              onChange: (e) => setCfgForm(Object.assign({}, cfgForm, { [field.key]: e.target.checked })),
              style: { width: '16px', height: '16px', margin: 0, cursor: 'pointer' },
            })
            : input
        return React.createElement('div', { key: field.key, style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          fieldRow(field.label, control),
          bad ? React.createElement('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-state-error-primary)', textAlign: 'right' } }, cfgErrors[field.key]) : null)
      }
      const cfgSection = (title, fields) => React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        React.createElement('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, title),
        fields.map(cfgField))
      const dialogEl = dialog === 'config'
        ? dialogShell('One-line diagram config options', React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          cfgSection('Bus flags', DRAWIO_NET_FIELDS.slice(0, 3)),
          cfgSection('Branch flow flags', DRAWIO_NET_FIELDS.slice(3, 7)),
          cfgSection('View', DRAWIO_NET_FIELDS.slice(7)),
          React.createElement('div', { style: hintStyle },
            'Writes ' + netConfigPath + ' \u2014 one flag style for every case. Flags are a preview: the .drawio keeps no colour.'),
          netConfigWarning !== null ? React.createElement('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)' } }, netConfigWarning) : null,
          netConfigError !== null ? React.createElement('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)' } }, netConfigError) : null,
        ), applyConfig, netConfigSaving)
        : dialog === 'search'
        ? dialogShell('Search the diagram', React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          React.createElement('input', {
            value: searchText,
            onChange: (e) => setSearchText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') applySearch() },
            placeholder: searchHelp.placeholder,
            'aria-label': 'Search the diagram',
            style: { ...selectStyle, width: '100%', maxWidth: 'none', height: '30px' },
          }),
          React.createElement('div', { style: hintStyle },
            busMetaLoading ? 'Loading the case\u2019s bus table\u2026 ' + searchHelp.hint : searchHelp.hint),
        ), applySearch, false)
        : dialog === 'filter'
          ? dialogShell('Filter the diagram', React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            fieldRow('Area', React.createElement('select', {
              value: filterArea,
              'aria-label': 'Area',
              onChange: (e) => { setFilterArea(e.target.value); setFilterZone('') },
              style: { ...selectStyle, minWidth: '200px', maxWidth: '240px', height: '28px' },
            }, [React.createElement('option', { key: 'all', value: '' }, 'All areas')].concat(
              (busMeta === null ? [] : busMeta.areas).map((a) => React.createElement('option', { key: a.num, value: a.num }, a.num + '  ' + a.name))))),
            fieldRow('Zone', React.createElement('select', {
              value: filterZone,
              'aria-label': 'Zone',
              onChange: (e) => setFilterZone(e.target.value),
              style: { ...selectStyle, minWidth: '200px', maxWidth: '240px', height: '28px' },
            }, [React.createElement('option', { key: 'all', value: '' }, 'All zones')].concat(
              (busMeta === null ? [] : busMeta.zones)
                .filter((z) => filterArea === '' || String(z.area) === filterArea)
                .map((z) => React.createElement('option', { key: z.num, value: z.num }, z.num + '  ' + z.name))))),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' } },
              React.createElement('input', {
                type: 'checkbox',
                checked: filterOutOfBand,
                'aria-label': 'Only buses outside the voltage band',
                onChange: (e) => setFilterOutOfBand(e.target.checked),
              }),
              'Only buses with ' + drawioBandText(netConfig)),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
              opacity: branchLoads === null ? 0.5 : 1 } },
              React.createElement('input', {
                type: 'checkbox',
                checked: filterBasecaseLoading,
                // No branch table in the result folder means no loading to compare: the criterion is
                // offered but not tappable, rather than silently emptying the drawing (0.6.32).
                disabled: branchLoads === null,
                'aria-label': 'Only branches at or above the base-case flow flag',
                onChange: (e) => setFilterBasecaseLoading(e.target.checked),
              }),
              'Only branches with ' + drawioLoadingThresholdText(netConfig, 'basecase')
                + (branchLoads === null ? ' (no branch table yet)' : '')),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
              opacity: conLoads === null ? 0.5 : 1 } },
              React.createElement('input', {
                type: 'checkbox',
                checked: filterContingencyLoading,
                disabled: conLoads === null,
                'aria-label': 'Only branches at or above the contingency flow flag',
                onChange: (e) => setFilterContingencyLoading(e.target.checked),
              }),
              'Only branches with ' + drawioLoadingThresholdText(netConfig, 'contingency')
                + (conLoads === null ? ' (no CA table yet)' : '')),
            React.createElement('div', { style: hintStyle },
              busMetaLoading || (filterNeedsMeta && busMeta === null)
                ? 'Loading the case\u2019s bus table\u2026'
                : (draftHits !== null && draftHits.label !== ''
                  ? draftHits.text
                  : 'Anything that does not match is hidden, along with its branches and transformer symbols; a branch loading filter also hides the buses that are not an end of a branch that stays. All areas and All zones bring the whole diagram back.')),
          ), applyFilter, busMetaLoading || (filterNeedsMeta && busMeta === null))
          : null

      const caseRow = React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, 'Simu Case'),
          React.createElement('span', { style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '12px' } },
            caseInput === '' ? '(none selected)' : caseInput),
          caseInput === ''
            ? React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
              'Select a case in the InterPSS tab and this view follows it.')
            : null,
        ),
        editControls,
      )

      // The picker only exists when there is something to pick: one diagram is already
      // open, and none is a state the body explains.
      const picker = fileCount > 1
        ? React.createElement('select', {
          value: path,
          onChange: (e) => openDiagram(e.target.value),
          style: selectStyle,
        }, files.map((f) => React.createElement('option', { key: f.path, value: f.path },
          f.path.slice(f.path.lastIndexOf('/') + 1) + (typeof f.size === 'number' ? '  (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)' : ''))))
        : null

      const toolbar = (path !== '' || picker !== null)
        ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
          picker,
          // `R` / `S` rather than `Rendered` / `Source` (0.6.17): this row is the drawing's
          // controls, and the two words took a third of it for the two most obvious buttons. The
          // tooltip and the accessible name carry the meaning the label no longer spells out.
          path !== '' ? React.createElement('button', { onClick: () => setView('rendered'), title: 'Rendered view', 'aria-label': 'Rendered view', style: { ...btn, padding: '4px 0', minWidth: '34px', borderColor: view === 'rendered' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' } }, 'R') : null,
          path !== '' ? React.createElement('button', { onClick: () => setView('source'), title: 'Source view — the raw draw.io XML', 'aria-label': 'Source view', style: { ...btn, padding: '4px 0', minWidth: '34px', borderColor: view === 'source' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)' } }, 'S') : null,
          path !== '' && view === 'rendered' && scene !== null ? React.createElement('button', { onClick: () => stepZoom(1 / 1.25), title: 'Zoom out', style: { ...btn, padding: '4px 10px' } }, '\u2212') : null,
          // The readout is the zoom picker (0.6.21): it shows the current level and sets it, and
          // since 0.6.22 it carries **Fit** as its last entry, so the row is `−`, the picker, `+`
          // and nothing else. A level reached with the wheel or a pinch is listed alongside the
          // presets, so going to 100% and back to the old 745% is one click either way.
          path !== '' && view === 'rendered' && scene !== null
            ? (function () {
              const pctNow = drawioZoomPercent(scene, rect)
              const fitted = rect === null
              const pcts = DRAWIO_ZOOM_PRESETS.indexOf(pctNow) >= 0 || fitted
                ? DRAWIO_ZOOM_PRESETS
                : DRAWIO_ZOOM_PRESETS.concat([pctNow]).sort((a, b) => a - b)
              const options = pcts.map((p) => React.createElement('option', { key: p, value: String(p) }, p + '%'))
              // `Fit` shows the whole page from its origin; picking 100% only rescales about the
              // current centre, which is a different view. While the view IS fitted (`rect === null`)
              // this is the selected entry, and the readout says so instead of claiming 100%.
              options.push(React.createElement('option', { key: 'fit', value: 'fit' }, 'Fit'))
              return React.createElement('select', {
                value: fitted ? 'fit' : String(pctNow),
                onChange: (e) => (e.target.value === 'fit' ? fit() : setZoomPercent(Number(e.target.value))),
                title: 'Zoom level',
                'aria-label': 'Zoom level',
                style: { ...selectStyle, height: '28px', minWidth: '78px', maxWidth: '96px', padding: '0 4px', textAlign: 'center', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
              }, options)
            })()
            : null,
          path !== '' && view === 'rendered' && scene !== null ? React.createElement('button', { onClick: () => stepZoom(1.25), title: 'Zoom in', style: { ...btn, padding: '4px 10px' } }, '+') : null,
          // Search and filter (0.6.23): two icon buttons after the zoom controls. Each opens a
          // dialog whose OK applies and whose Cancel throws the draft away. The filter button stays
          // lit while a filter is applied, and the status text clears both (a span, not a button --
          // the row's controls are the ones the mock specifies).
          path !== '' && view === 'rendered' && scene !== null
            ? React.createElement('button', {
              onClick: openSearch, title: 'Search the diagram', 'aria-label': 'Search the diagram',
              style: { ...btn, padding: '4px 8px', display: 'flex', alignItems: 'center' },
            }, drawioSearchIcon)
            : null,
          path !== '' && view === 'rendered' && scene !== null
            ? React.createElement('button', {
              onClick: openFilter, title: 'Filter the diagram', 'aria-label': 'Filter the diagram',
              style: { ...btn, padding: '4px 8px', display: 'flex', alignItems: 'center', borderColor: filterApplied === null ? 'var(--dsw-alias-border-l1)' : 'var(--dsw-alias-brand-primary)' },
            }, drawioFilterIcon)
            : null,
          path !== '' && view === 'rendered' && scene !== null && statusText !== null
            ? React.createElement('span', {
              onClick: clearSearchFilter,
              title: 'Clear the search and the filter',
              style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' },
            }, statusText + ' \u2715')
            : null,
          // The flag counts, tinted by the config's own colours and clickable to open the gear --
          // so what the thresholds are doing is visible without opening the dialog.
          path !== '' && view === 'rendered' && scene !== null && flagCounts !== null
            ? React.createElement('span', {
              onClick: openConfig,
              title: 'Flagged by config/net_diagram.json \u2014 click to change the thresholds',
              style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' },
            }, flagCounts)
            : null,
        )
        : null

      const body = caseInput === ''
        ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } },
          'No simulation case selected. Pick one in the InterPSS tab — its diagram folder is listed here automatically.')
        : filesError !== null
          ? React.createElement('pre', { style: { ...mono, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, filesError)
          // `files === null` is "the listing has not answered yet", so the first paint of a
          // selected case reads as a lookup rather than as a blank tab.
          : (filesLoading || files === null)
            ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'Looking for .drawio files…')
            : files.length === 0
              ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                'No .drawio file in this case\'s diagram folder yet.')
              : loading
                ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, 'Loading diagram…')
                : error !== null
                  ? React.createElement('pre', { style: { ...mono, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, error)
                  : view === 'source'
                    ? React.createElement('pre', { style: { ...mono, flex: '1 1 auto', overflow: 'auto', minHeight: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 } }, xml || '')
                    : scene !== null
                      ? React.createElement('div', {
                        ref: canvasRef,
                        onPointerDown: pointerDown,
                        onPointerMove: pointerMove,
                        onPointerUp: pointerUp,
                        onPointerCancel: pointerUp,
                        onPointerLeave: pointerUp,
                        // `position: relative` so the birdseye can sit in the corner of the canvas.
                        style: { position: 'relative', height: '70vh', minHeight: '320px', overflow: 'hidden', background: DRAWIO_PAPER, borderRadius: '6px', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' },
                      }, React.createElement(DrawioDiagram, {
                        scene: scene,
                        view: rect,
                        // Render-time only: neither the alert nor the search/filter overrides ever
                        // reach the file.
                        paint: paintMap,
                        hidden: filterHits === null ? null : filterHits.ids,
                        hover: {
                          pairs: dataRef.current.pairs,
                          onBus: diagramBusTip,
                          onBranch: diagramBranchTip,
                          onMove: moveTip,
                          onLeave: hideTip,
                        },
                      }), netConfig.Show_birdseye_view !== false ? React.createElement(DrawioBirdseye, {
                        // The whole drawing, with the visible rectangle on it. Its pointer events
                        // are stopped inside, so dragging the thumbnail never pans the canvas too.
                        scene: scene,
                        rect: currentRect(),
                        paths: birdseyePaths,
                        onCentre: centreFromBirdseye,
                      }) : null)
                      : null

      const tipEl = tip ? React.createElement('div', {
        style: {
          position: 'fixed', left: tip.x + 12, top: tip.y + 12,
          background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px',
          padding: '8px 10px', fontSize: '11px', lineHeight: '1.5', whiteSpace: 'pre',
          color: 'var(--dsw-alias-label-primary)', zIndex: 10000, pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)', maxWidth: '320px',
        },
      }, tip.text) : null

      // No title and no subtitle: the tab bar already names this view, and the first row
      // ("Simu Case <path>") says what is drawn. A heading here only pushed the diagram down.
      return React.createElement('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' } },
        caseRow,
        toolbar,
        body,
        tipEl,
        dialogEl,
      )
    }

    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'interpss', order: 1, label: 'InterPSS' },
      (props) => React.createElement(InterPssView, { sessionId: props && props.sessionId, callRemote: callRemote }),
    ))
    // Order 2 puts the Diagram tab between InterPSS (1) and Trajectory (10).
    slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'diagram', order: 2, label: 'Diagram' },
      (props) => React.createElement(DiagramView, { sessionId: props && props.sessionId, callRemote: callRemote }),
    ))
  },
}
