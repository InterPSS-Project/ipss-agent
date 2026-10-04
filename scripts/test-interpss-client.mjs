// Client-half guard for the InterPSS tab (@deepseek-ai/dsh-interpss).
//
// Run before packing a new plugin version:
//
//   node scripts/test-interpss-client.mjs
//
// Why this exists: `node --check` only proves a file parses. Two whole classes of defect
// are invisible to it and only appear as a *blank tab* in the app, with nothing in the
// Host's diagnostic log (the failure is entirely client-side):
//
//   1. Render-time ordering errors, e.g. a `React.useEffect` dependency array — evaluated
//      during render — reading a `const` declared further down the same component
//      (`ReferenceError: Cannot access 'x' before initialization`). This shipped once, in
//      0.6.0. Any such throw unmounts InterPssView and the tab renders blank.
//   2. draw.io renderer regressions: the diagram is mxGraph XML, and the geometry rules
//      (group containers draw nothing but position their children; `endArrow=none` means
//      no arrowhead) are easy to get subtly wrong without ever throwing.
//
// Node has no DOMParser, so this file supplies a minimal one covering exactly what the
// renderer uses. It has no dependencies and does not need a browser.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BODY = join(ROOT, 'interpss-dynamic', 'client-body.js');
// The live per-case diagram the Diagram button loads (0.6.6 moved diagrams under the case),
// plus the result table the tooltips quote.
const DIAGRAM = join(ROOT, 'wspace', 'data', 'ieee', 'Ieee14Bus', 'diagram', 'ieee14-oneline.drawio');
// The style reference the case diagrams are copies of. It was renamed from
// `ieee14-oneline.drawio` (commit e1075429), and draw.io re-serialises a file it touches,
// so the two are no longer byte-identical — §11 compares what they PARSE to instead.
const TEMPLATE_DIAGRAM = join(ROOT, 'wspace', 'template', 'oneline-diagram.drawio');
const BRANCH_CSV = join(ROOT, 'wspace', 'data', 'ieee', 'Ieee14Bus', 'result', 'ieee14_DF_branch.csv');

let failures = 0;
function check(label, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  -> ' + detail : ''));
  if (!cond) failures += 1;
}

// --- minimal XML DOM -------------------------------------------------------
class El {
  constructor(tagName) { this.tagName = tagName; this.attrs = {}; this.kids = []; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  get children() { return this.kids; }
  getElementsByTagName(name) {
    const out = [];
    const walk = (n) => { for (const k of n.kids) { if (k.tagName === name) out.push(k); walk(k); } };
    walk(this);
    return out;
  }
}

function parseXml(text) {
  const root = new El('#document');
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i -= 1) { if (stack[i].tagName === m[1]) { stack.length = i; break; } }
    } else if (m[2]) {
      const el = new El(m[2]);
      const ar = /([\w.:-]+)\s*=\s*"([^"]*)"/g;
      let am;
      while ((am = ar.exec(m[3] || '')) !== null) el.attrs[am[1]] = am[2];
      stack[stack.length - 1].kids.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  return root;
}

class DOMParserShim {
  parseFromString(text) { return parseXml(text); }
}

// --- load the tab body -----------------------------------------------------
const body = readFileSync(BODY, 'utf8');
const from = body.indexOf('    const PRESETS = [');
const to = body.indexOf("    const slots = ctx.get('slots')");
if (from < 0 || to < 0) {
  console.error('could not slice the tab body out of ' + BODY + ' — did the markers change?');
  process.exit(1);
}
const slice = body.slice(from, to);

// A React just real enough to run one render. `activated` is the component's first
// useState, so overriding call 0 starts a render past the pre-activation guards.
function makeReact(overrides) {
  let call = 0;
  return {
    createElement: (type, props, ...kids) => ({ type, props, kids }),
    useState: (init) => {
      const i = call++;
      const v = Object.prototype.hasOwnProperty.call(overrides, i) ? overrides[i] : init;
      return [v, () => {}];
    },
    useRef: (init) => ({ current: init }),
    useEffect: () => {},
    Fragment: 'Fragment',
  };
}

function build(overrides) {
  const factory = new Function('React', 'host', 'ctx', 'DOMParser', 'Blob', 'Response', 'DecompressionStream', 'atob',
    slice + '\nreturn { InterPssView: InterPssView, DrawioDiagram: DrawioDiagram, parseDrawioScene: parseDrawioScene,'
      + ' diagramXmlFrom: diagramXmlFrom, styleMap: styleMap, labelLines: labelLines,'
      + ' drawioFitRect: drawioFitRect, drawioZoomLimits: drawioZoomLimits, drawioZoomRect: drawioZoomRect,'
      + ' drawioZoomPercent: drawioZoomPercent, DRAWIO_ZOOM_PRESETS: DRAWIO_ZOOM_PRESETS,'
      + ' drawioSearchHits: drawioSearchHits, drawioFilterHidden: drawioFilterHidden,'
      + ' drawioBusMeta: drawioBusMeta, drawioEdgeBusPair: drawioEdgeBusPair, drawioRingIndex: drawioRingIndex,'
      + ' drawioIsBusCell: drawioIsBusCell,'
      + ' drawioSearchHelp: drawioSearchHelp,'
      + ' DRAWIO_NET_DEFAULTS: DRAWIO_NET_DEFAULTS, DRAWIO_NET_FIELDS: DRAWIO_NET_FIELDS,'
      + ' drawioNetConfig: drawioNetConfig, drawioNetConfigErrors: drawioNetConfigErrors,'
      + ' drawioBranchLoads: drawioBranchLoads, drawioContingencyLoads: drawioContingencyLoads,'
      + ' drawioBandText: drawioBandText,'
      + ' drawioBirdseyePaths: drawioBirdseyePaths, drawioBirdseyeRect: drawioBirdseyeRect,'
      + ' DrawioBirdseye: DrawioBirdseye,'
      + ' drawioColIndex: drawioColIndex, drawioFlagPaint: drawioFlagPaint,'
      + ' drawioMergedPaint: drawioMergedPaint,'
      + ' drawioPanRect: drawioPanRect, drawioWheelFactor: drawioWheelFactor, drawioZoomPercent: drawioZoomPercent,'
      + ' drawioThemeColor: drawioThemeColor,'
      + ' drawioBranchPairs: drawioBranchPairs, drawioIsBusId: drawioIsBusId, drawioLabelBusId: drawioLabelBusId,'
      + ' drawioHoverTarget: drawioHoverTarget, drawioCanonicalBusId: drawioCanonicalBusId,'
      + ' drawioPairLabel: drawioPairLabel, drawioFallbackTip: drawioFallbackTip,'
      + ' drawioTabChoice: drawioTabChoice, DiagramView: DiagramView,'
      + ' drawioBusAlerts: drawioBusAlerts, drawioBusCellId: drawioBusCellId,'
      + ' drawioVoltOutsideBand: drawioVoltOutsideBand, drawioVoltColumns: drawioVoltColumns,'
      + ' DRAWIO_MAX_CELLS: DRAWIO_MAX_CELLS,'
      + ' DRAWIO_MATCH_FILL: DRAWIO_MATCH_FILL, DRAWIO_BIRDSEYE_FRAME: DRAWIO_BIRDSEYE_FRAME,'
      + ' busTooltip: busTooltip, branchTooltip: branchTooltip, loadingText: loadingText };');


  return factory(makeReact(overrides || {}), { call: () => Promise.resolve({}) }, { get: () => undefined },
    DOMParserShim, Blob, Response, DecompressionStream, atob);
}

// --- 1. the component must render ------------------------------------------
console.log('1. InterPssView renders (a throw here blanks the tab)');
const api = build({});
const props = { sessionId: 'test-session', callRemote: () => Promise.resolve({}) };
let pre = null;
try {
  pre = api.InterPssView(props);
  check('pre-activation render (activated=null) does not throw', pre !== null && pre !== undefined);
  if (pre && pre.type === 'div') {
    check('shows the pre-activation placeholder', (pre.kids || []).indexOf('Checking workspace…') >= 0);
  }
} catch (e) {
  check('pre-activation render (activated=null) does not throw', false, e.constructor.name + ': ' + e.message);
}
try {
  const full = build({ 0: true }).InterPssView(props);
  const flat = JSON.stringify(full, (k, v) => (typeof v === 'function' ? '[fn]' : v));
  check('full render tree (activated=true) does not throw', full !== null && full !== undefined);
  check('the action row carries the run, options, CA and Report buttons',
    ['ACLF', 'CA', 'Report'].every((label) => flat.indexOf('"' + label + '"') >= 0));
  check('the action row no longer carries a Diagram button (the Diagram tab replaced it)',
    flat.indexOf('"Diagram"') < 0);
} catch (e) {
  check('full render tree (activated=true) does not throw', false, e.constructor.name + ': ' + e.message);
}

// --- 2. pure helpers -------------------------------------------------------
console.log('\n2. style and label helpers');
const st = api.styleMap('rounded;fillColor=#dae8fc;strokeWidth=2;dashed=1');
check('styleMap splits keys and values', st.rounded === '1' && st.fillColor === '#dae8fc' && st.strokeWidth === '2');
check('styleMap tolerates empty input', Object.keys(api.styleMap('')).length === 0);
check('labelLines turns <br> into a line break', JSON.stringify(api.labelLines('a<br>b')) === '["a","b"]');
check('labelLines strips markup and entities', JSON.stringify(api.labelLines('<b>x</b>&amp;y')) === '["x&y"]');

// --- 3. the real diagram ---------------------------------------------------
console.log('\n3. parseDrawioScene on wspace/data/ieee/Ieee14Bus/diagram/ieee14-oneline.drawio');
const xml = readFileSync(DIAGRAM, 'utf8');
let scene = null;
try {
  scene = api.parseDrawioScene(xml);
  check('parses without throwing', true);
} catch (e) {
  check('parses without throwing', false, e.constructor.name + ': ' + e.message);
}
if (scene) {
  const kinds = scene.nodes.reduce((a, n) => { a[n.kind] = (a[n.kind] || 0) + 1; return a; }, {});
  check('45 vertices minus 5 group containers are drawn', scene.nodes.length === 40, scene.nodes.length);
  check('all 25 edges are drawn', scene.edges.length === 25, scene.edges.length);
  check('15 bus bars / 15 text labels / 10 transformer ellipses',
    kinds.rect === 15 && kinds.text === 15 && kinds.ellipse === 10, JSON.stringify(kinds));
  // group children carry geometry relative to their group, so they must land at the
  // group's own coordinates and not be offset twice. The group's position is read from the FILE
  // rather than hard-coded: the point is the parser's rule, not where the diagram's author put the
  // symbol — a case diagram is a file the draw.io button invites you to edit, and one such edit
  // moved this very group (x=462 -> x=503), which used to fail a hard-coded check.
  const groupGeometryOf = (src, id) => {
    const cell = new RegExp('<mxCell id="' + id + '"[^>]*>([\\s\\S]*?)</mxCell>').exec(src);
    if (cell === null) return null;
    const geom = /<mxGeometry\b([^>]*?)\/?>/.exec(cell[1]);
    if (geom === null) return null;
    const attr = (name) => {
      const m = new RegExp(name + '="([-\\d.]+)"').exec(geom[1]);
      return m === null ? 0 : parseFloat(m[1]);
    };
    return { x: attr('x'), y: attr('y') };
  };
  const xf15 = scene.nodes.find((n) => n.id === 'xf15');
  const xf15b = scene.nodes.find((n) => n.id === 'xf15b');
  const group3 = groupGeometryOf(xml, '3');
  check('a group child lands at its group origin',
    xf15 !== undefined && group3 !== null && xf15.x === group3.x && xf15.y === group3.y,
    (xf15 ? xf15.x + ',' + xf15.y : 'no xf15') + ' vs group ' + JSON.stringify(group3));
  check('its pair applies the relative offset',
    xf15b !== undefined && group3 !== null && xf15b.x === group3.x && xf15b.y === group3.y + 8,
    (xf15b ? xf15b.x + ',' + xf15b.y : 'no xf15b') + ' vs group ' + JSON.stringify(group3));
  check('no group container is drawn', !scene.nodes.some((n) => n.id === '3' || n.id === '7'));
  // A one-line diagram is undirected: every branch carries endArrow=none. Anything with an
  // arrowhead here came from a stray edge, and 0.6.4 removed the last two (a transformer
  // wired to the page background, which also drew long diagonals across the drawing).
  const arrows = scene.edges.filter((e) => e.arrow !== null).length;
  check('no branch carries an arrowhead', arrows === 0, arrows);
  // The transformer symbol is two interlocking rings. An opaque fill on the second ellipse
  // paints over the first one's inner arc, so the symbol rendered as a broken open arc plus
  // a circle — in the preview and in draw.io alike. Both rings must stay unfilled.
  const rings = scene.nodes.filter((n) => n.kind === 'ellipse');
  check('the transformer rings are unfilled so neither occludes the other',
    rings.length === 10 && rings.every((n) => n.fill === 'none'),
    rings.filter((n) => n.fill !== 'none').length + ' of ' + rings.length + ' filled');
  check('every node has a positive size', scene.nodes.every((n) => n.w > 0 && n.h > 0));
  check('every edge has at least 2 finite points',
    scene.edges.every((e) => e.points.length >= 2 && e.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))));
  const vb = scene.viewBox;
  check('the viewBox is finite and positive', Number.isFinite(vb.x) && vb.w > 0 && vb.h > 0, JSON.stringify(vb));
  check('the viewBox stays within the 900x760 page plus padding',
    vb.x >= -20 && vb.y >= -20 && vb.x + vb.w <= 920 && vb.y + vb.h <= 780, JSON.stringify(vb));
  // Paint order. This diagram declares `bg` — an opaque 900x760 white rectangle — BEFORE
  // its branches, so a renderer that draws every edge first and every vertex afterwards
  // hides all 27 branches behind the page fill (shipped in 0.6.3; the preview looked like a
  // one-line diagram with no lines).
  check('every node and edge records its document order',
    scene.nodes.every((n) => Number.isFinite(n.order)) && scene.edges.every((e) => Number.isFinite(e.order)));
  const bgNode = scene.nodes.find((n) => n.id === 'bg');
  check('the page background cell is the opaque white rect the fix exists for',
    bgNode !== undefined && bgNode.fill === '#FFFFFF' && bgNode.w >= 900 && bgNode.h >= 760,
    bgNode && bgNode.fill + ' ' + bgNode.w + 'x' + bgNode.h);
  check('the opaque page background precedes every branch in paint order',
    bgNode !== undefined && bgNode.order < Math.min.apply(null, scene.edges.map((e) => e.order)),
    bgNode && bgNode.order + ' < ' + Math.min.apply(null, scene.edges.map((e) => e.order)));

  console.log('\n4. DrawioDiagram builds the SVG');
  try {
    const svg = api.DrawioDiagram({ scene: scene });
    check('renders without throwing', svg !== null && svg.type === 'svg');
    const flat = JSON.stringify(svg, (k, v) => (typeof v === 'function' ? '[fn]' : v));
    check('no NaN or null coordinate reaches the SVG', flat.indexOf('NaN') < 0 && flat.indexOf('null,null') < 0);
    // the fake createElement does not flatten arrays, so the sole child is the array
    const kids = svg.kids.length === 1 && Array.isArray(svg.kids[0]) ? svg.kids[0] : svg.kids;
    check('one group per node and per edge', kids.length === scene.nodes.length + scene.edges.length,
      kids.length + ' vs ' + (scene.nodes.length + scene.edges.length));
    // the emitted order must BE the model order, not edges-then-vertices
    const orderAt = (c) => {
      const k = String(c.props.key);
      return k.charAt(0) === 'e' ? scene.edges[Number(k.slice(1))].order : scene.nodes[Number(k.slice(1))].order;
    };
    const seq = kids.map(orderAt);
    check('the SVG paints in non-decreasing document order',
      seq.every((v, i) => i === 0 || seq[i - 1] <= v), seq.slice(0, 8).join(','));
    const bgPos = kids.findIndex((c) => String(c.props.key) === 'n' + scene.nodes.findIndex((n) => n.id === 'bg'));
    const edgePos = kids.map((c, i) => (String(c.props.key).charAt(0) === 'e' ? i : -1)).filter((i) => i >= 0);
    check('the page background group is emitted before every branch group',
      bgPos >= 0 && edgePos.length === scene.edges.length && edgePos.every((i) => i > bgPos),
      'bg at ' + bgPos + ', edges ' + edgePos[0] + '..' + edgePos[edgePos.length - 1]);
    // pan/zoom passes an explicit view into the renderer; without one the scene's own
    // viewBox must still be used, since that is the "fit" state
    const fitted = api.DrawioDiagram({ scene: scene });
    check('DrawioDiagram defaults to the scene viewBox',
      fitted.props.viewBox === [vb.x, vb.y, vb.w, vb.h].join(' '), fitted.props.viewBox);
    const zoomed = api.DrawioDiagram({ scene: scene, view: { x: 1, y: 2, w: 3, h: 4 } });
    check('DrawioDiagram honours an explicit view', zoomed.props.viewBox === '1 2 3 4', zoomed.props.viewBox);
  } catch (e) {
    check('renders without throwing', false, e.constructor.name + ': ' + e.message);
  }
}

// A cell that names no strokeColor must fall back to mxGraph's own default (black). It was a
// slate gray, which painted the workspace diagram's 2 unstyled edges a different color from
// the other 25 — the "edge color is not correct" report. Those two turned out to be stray
// edges and were removed from the file, so this check now uses a synthetic diagram.
{
  const bare = '<mxfile><diagram><mxGraphModel><root>'
    + '<mxCell id="n1" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>'
    + '<mxCell id="e1" edge="1" parent="1" style="edgeStyle=none"><mxGeometry relative="1" as="geometry">'
    + '<mxPoint x="0" y="0" as="sourcePoint"/><mxPoint x="50" y="50" as="targetPoint"/></mxGeometry></mxCell>'
    + '</root></mxGraphModel></diagram></mxfile>';
  const bareScene = api.parseDrawioScene(bare);
  check('a cell with no strokeColor falls back to draw.io black',
    bareScene.edges.length === 1 && bareScene.edges[0].stroke === '#000000',
    bareScene.edges.length ? bareScene.edges[0].stroke : 'no edge parsed');
  check('that fallback covers vertices too',
    bareScene.nodes.length === 1 && bareScene.nodes[0].stroke === '#000000',
    bareScene.nodes.length ? bareScene.nodes[0].stroke : 'no node parsed');
}

// The preview must follow the app theme. Its models are ink-on-paper, so the grayscale
// part of the palette is re-expressed as theme tokens at paint time — the scene keeps the
// authored colours (asserted above) and the renderer translates them.
const PAPER = 'var(--dsw-alias-bg-layer-1)';
const INK = 'var(--dsw-alias-label-primary)';
const MID = 'var(--dsw-alias-label-secondary)';
check('a white paper surface becomes the theme surface', api.drawioThemeColor('#FFFFFF') === PAPER, api.drawioThemeColor('#FFFFFF'));
check('white in shorthand becomes the theme surface', api.drawioThemeColor('#fff') === PAPER, api.drawioThemeColor('#fff'));
check('black ink becomes the theme foreground', api.drawioThemeColor('#000000') === INK, api.drawioThemeColor('#000000'));
check('the default text colour is treated as ink', api.drawioThemeColor('#111827') === INK, api.drawioThemeColor('#111827'));
check('a mid grey becomes the secondary label colour', api.drawioThemeColor('#666666') === MID, api.drawioThemeColor('#666666'));
check('a dark grey outline becomes the secondary label colour', api.drawioThemeColor('#333333') === MID, api.drawioThemeColor('#333333'));
check('a light grey becomes the secondary label colour', api.drawioThemeColor('#CCCCCC') === MID, api.drawioThemeColor('#CCCCCC'));
// a deliberately coloured element must survive in either theme
check('a saturated colour is left exactly as authored',
  api.drawioThemeColor('#C0392B') === '#C0392B' && api.drawioThemeColor('#1F6FEB') === '#1F6FEB');
check('none and already-token values pass through',
  api.drawioThemeColor('none') === 'none' && api.drawioThemeColor(PAPER) === PAPER && api.drawioThemeColor(undefined) === undefined);

if (scene) {
  // and the renderer must actually use the mapping, not just define it
  const svg = api.DrawioDiagram({ scene: scene });
  const kids = svg.kids.length === 1 && Array.isArray(svg.kids[0]) ? svg.kids[0] : svg.kids;
  const shapeOf = (key) => {
    const g = kids.find((c) => String(c.props.key) === key);
    if (g === undefined) return null;
    const parts = Array.isArray(g.kids[0]) ? g.kids[0] : g.kids;
    return parts[0] ? parts[0].props : null;
  };
  const bgIdx = scene.nodes.findIndex((n) => n.id === 'bg');
  const bgShape = shapeOf('n' + bgIdx);
  check('the rendered page background uses the theme surface',
    bgShape !== null && bgShape.fill === PAPER, bgShape && bgShape.fill);
  const edgeShape = shapeOf('e0');
  check('the rendered branches use the theme foreground',
    edgeShape !== null && edgeShape.stroke === INK, edgeShape && edgeShape.stroke);
  const ringNode = scene.nodes.findIndex((n) => n.kind === 'ellipse');
  const ringShape = shapeOf('n' + ringNode);
  check('a transformer ring keeps fill none and takes the ink stroke',
    ringShape !== null && ringShape.fill === 'none' && ringShape.stroke === INK,
    ringShape && ringShape.fill + ' / ' + ringShape.stroke);
  // a text-kind vertex paints no shape, so its first part IS the label element
  const labelNode = scene.nodes.findIndex((n) => n.kind === 'text' && n.lines.length > 0);
  const labelShape = shapeOf('n' + labelNode);
  check('bus labels are painted in the theme foreground',
    labelShape !== null && labelShape.fill === INK, labelShape && labelShape.fill);
}

// --- 5. diagram pan/zoom math ----------------------------------------------
console.log('\n5. diagram pan/zoom');
if (scene) {
  const base = api.drawioFitRect(scene.viewBox);
  check('fit is exactly the scene viewBox',
    base.x === scene.viewBox.x && base.y === scene.viewBox.y && base.w === scene.viewBox.w && base.h === scene.viewBox.h,
    JSON.stringify(base));

  const limits = api.drawioZoomLimits(scene.viewBox);
  const zin = api.drawioZoomRect(base, 1.25, 0.5, 0.5, limits);
  check('a zoom step scales width and height by the factor',
    Math.abs(zin.w - base.w / 1.25) < 1e-9 && Math.abs(zin.h - base.h / 1.25) < 1e-9,
    zin.w.toFixed(3) + ' x ' + zin.h.toFixed(3));
  check('the aspect ratio never drifts', Math.abs((zin.w / zin.h) - (base.w / base.h)) < 1e-9);

  // the scene point under the cursor must not move — that is the whole point of the anchor
  const r0 = { x: 0, y: 0, w: 100, h: 50 };
  const anchor = api.drawioZoomRect(r0, 2, 0.25, 0.75, { minW: 1e-6, maxW: 1e9 });
  const px = r0.x + 0.25 * r0.w;
  const py = r0.y + 0.75 * r0.h;
  check('the anchored scene point stays under the cursor',
    Math.abs((px - anchor.x) / anchor.w - 0.25) < 1e-9 && Math.abs((py - anchor.y) / anchor.h - 0.75) < 1e-9,
    anchor.x + ',' + anchor.y + ' ' + anchor.w + 'x' + anchor.h);
  check('an off-centre anchor keeps the point at the same fraction from both edges',
    Math.abs((anchor.x + 0.25 * anchor.w) - px) < 1e-9 && Math.abs((anchor.y + 0.75 * anchor.h) - py) < 1e-9);

  const maxIn = api.drawioZoomRect(r0, 1e6, 0.5, 0.5, { minW: 10, maxW: 100 });
  const maxOut = api.drawioZoomRect(r0, 1e-6, 0.5, 0.5, { minW: 10, maxW: 100 });
  check('zoom clamps at the in limit', maxIn.w === 10, maxIn.w);
  check('zoom clamps at the out limit', maxOut.w === 100, maxOut.w);
  check('the real limits allow 0.1x to 12x',
    Math.abs(limits.maxW - scene.viewBox.w * 10) < 1e-9 && Math.abs(limits.minW - scene.viewBox.w / 12) < 1e-9,
    JSON.stringify(limits));
  check('a degenerate factor leaves the view alone',
    api.drawioZoomRect(r0, 0, 0.5, 0.5, null).w === r0.w && api.drawioZoomRect(r0, NaN, 0.5, 0.5, null).w === r0.w);

  const panned = api.drawioPanRect(r0, -12.5, 7.25);
  check('pan translates without resizing',
    panned.x === -12.5 && panned.y === 7.25 && panned.w === r0.w && panned.h === r0.h, JSON.stringify(panned));
  check('pan ignores a non-finite delta', api.drawioPanRect(r0, NaN, 0).x === 0);

  check('wheel up zooms in, wheel down zooms out',
    api.drawioWheelFactor(-100) > 1 && api.drawioWheelFactor(100) < 1 && api.drawioWheelFactor(0) === 1,
    api.drawioWheelFactor(-100));

  check('the zoom readout is 100% at fit', api.drawioZoomPercent(scene, base) === 100, api.drawioZoomPercent(scene, base));
  check('the zoom readout tracks the step', api.drawioZoomPercent(scene, zin) === 125, api.drawioZoomPercent(scene, zin));
  check('a null view reads as 100%', api.drawioZoomPercent(scene, null) === 100);
}

// --- 6. failure modes and the compressed storage form ----------------------
console.log('\n6. failure modes and compressed diagrams');
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
check('malformed XML is rejected', throws(() => api.parseDrawioScene('<mxfile><diagram>')) !== null);
check('an empty model is rejected',
  throws(() => api.parseDrawioScene('<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>')) !== null);
check('non-draw.io XML is rejected', throws(() => api.parseDrawioScene('<html><body>hi</body></html>')) !== null);

const enc = new TextEncoder();
async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const b64 = (u8) => Buffer.from(u8).toString('base64');
const plain = await api.diagramXmlFrom('<mxfile><diagram><mxGraphModel/></diagram></mxfile>');
check('plain XML passes through unchanged', plain.indexOf('<mxGraphModel/>') >= 0);
const uriEncoded = enc.encode(encodeURIComponent('<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>'));
const decoded = await api.diagramXmlFrom(b64(await deflateRaw(uriEncoded)));
check('base64+deflate+uri-encoded diagram round-trips', decoded.indexOf('<mxGraphModel>') >= 0);
check('empty input is rejected', (await api.diagramXmlFrom('').then(() => null, (e) => e.message)) !== null);
check('garbage input is rejected',
  (await api.diagramXmlFrom('not-base64-and-not-xml!!').then(() => null, (e) => e.message)) !== null);

// --- 7. render-time declaration order --------------------------------------
console.log('\n7. render-time declaration order (the 0.6.0 blank-tab defect)');
// A dependency array is evaluated *during* render, so an effect listing a binding that is
// declared further down the same component throws a TDZ ReferenceError. Because
// InterPssView is one component, that unmounts it and the tab renders blank, with nothing
// in the Host log. `node --check` cannot see it, and neither can the render checks above
// (the throwing path needs an effect to actually run), so assert the textual order.
function declaredAt(name) {
  const patterns = ['const [' + name + ',', 'const [' + name + ']', 'const ' + name + ' =',
    'let ' + name + ' =', 'function ' + name + '('];
  let best = -1;
  for (const p of patterns) {
    const i = slice.indexOf(p);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}
const effectRe = /React\.useEffect\(\(\) => \{[\s\S]*?\n      \}, \[([^\]]*)\]\)/g;
const orderBad = [];
let effectsSeen = 0;
let em;
while ((em = effectRe.exec(slice)) !== null) {
  effectsSeen += 1;
  const deps = em[1].split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
  for (const d of deps) {
    const at = declaredAt(d);
    if (at < 0) orderBad.push(d + ' has no declaration');
    else if (at > em.index) orderBad.push(d + ' is declared ' + (at - em.index) + ' chars after the effect');
  }
}
check('every effect was inspected, not silently skipped', effectsSeen >= 5, effectsSeen + ' effects');
check('every effect dependency is declared above its own effect',
  orderBad.length === 0, orderBad.slice(0, 4).join('; '));

// 8 retired (0.6.9). It rendered the InterPSS tab's diagram modal, and that modal is gone:
// the preview is the Diagram tab now, so section 12 carries the same render-time coverage
// for the view that replaced it. Nothing was renumbered — docs/persistent-plugin-rebuild.md
// and docs/oneline-diagram-process.md reference these sections by number.

// --- 9. the dynamic and persistent plugins are in sync ---------------------
console.log('\n9. the dynamic and persistent plugins are in sync');
// The persistent bundle is derived from the dynamic body, and this whole suite reads the
// dynamic body — so drift between them means the guard no longer describes what ships.
// Only the divergences documented in docs/persistent-plugin-rebuild.md are allowed; all
// of them are asserted explicitly below so a new one cannot slip in unnoticed.
const DYN_CLIENT = join(ROOT, 'interpss-dynamic', 'client.js');
const DYN_BODYP = join(ROOT, 'interpss-dynamic', 'client-body.js');
const LIB_CLIENT = join(ROOT, 'interpss-persistent', 'lib', 'client.js');
const DYN_HOST = join(ROOT, 'interpss-dynamic', 'index.js');
const DYN_HOSTB = join(ROOT, 'interpss-dynamic', 'host-body.js');
const LIB_HOST = join(ROOT, 'interpss-persistent', 'lib', 'index.js');
const rd = (p) => readFileSync(p, 'utf8');

// 9.1 the two dynamic client files are one artifact extracted twice
check('dynamic client.js and client-body.js are byte-identical', rd(DYN_CLIENT) === rd(DYN_BODYP));

// 9.2 the persistent tab body differs from the dynamic body ONLY by the documented
// transport/timer swap (§1.3): re-applying that swap must make them byte-identical
const PMARK = '    const PRESETS = [';
const DEND = "    const slots = ctx.get('slots')";
const LEND = '    // --- ACLF tool-card result explorer';
const PERSIST_TIMER = [
  '        const timer = setInterval(sync, 4000)',
  '        const onFocus = () => sync()',
  "        window.addEventListener('focus', onFocus)",
  '        return () => {',
  '          alive = false',
  '          clearInterval(timer)',
  "          window.removeEventListener('focus', onFocus)",
  '        }',
].join('\n');
const DYN_TIMER = [
  '        // A dynamic Client half has no setInterval/window: the Cordis timer service owns',
  '        // the repeat and its disposer is returned from this effect. The persistent',
  "        // bundle's window-focus refresh has no equivalent here, so the poll is the only",
  '        // trigger.',
  '        const stopPolling = ctx.timer.interval(sync, 4000)',
  '        return () => {',
  '          alive = false',
  '          stopPolling()',
  '        }',
].join('\n');
const dynBodyText = rd(DYN_BODYP);
const dynBodyRegion = dynBodyText.slice(dynBodyText.indexOf(PMARK), dynBodyText.indexOf(DEND));
const libClientText = rd(LIB_CLIENT);
const libBodyRegion = libClientText.slice(libClientText.indexOf(PMARK), libClientText.indexOf(LEND));
check('the persistent body carries the persistent timer form exactly once',
  libBodyRegion.split(PERSIST_TIMER).length - 1 === 1);
check('the dynamic body carries the dynamic timer form exactly once',
  dynBodyRegion.split(DYN_TIMER).length - 1 === 1);
check('the tab bodies are identical apart from the documented timer swap',
  libBodyRegion.split(PERSIST_TIMER).join(DYN_TIMER) === dynBodyRegion);
// the helper the tab body shares with the persistent-only ACLF explorer card must live in
// the body, not in the persistent-only region (hoisting hid this once and the guard stayed green)
const libTailRegion = libClientText.slice(libClientText.indexOf(LEND), libClientText.indexOf(DEND));
const leakedFns = [...libTailRegion.matchAll(/^    (?:async )?function ([\w$]+)/gm)]
  .map((m) => m[1])
  .filter((n) => new RegExp('\\b' + n + '\\b').test(libBodyRegion));
check('the tab body depends on nothing defined in the persistent-only region',
  leakedFns.length === 0, leakedFns.join(', '));

// 9.3 the dynamic host pair is one file with two export forms
check('dynamic index.js and host-body.js differ only in the export form',
  rd(DYN_HOST).split('export default {').join('return {') === rd(DYN_HOSTB));

// 9.4 both hosts expose the same client-facing method set
const methodsOf = (s) => {
  const m = /const METHODS = \[([^\]]*)\]/.exec(s);
  if (m === null) return null;
  return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean).join(',');
};
const dynMethods = methodsOf(rd(DYN_HOST));
check('both hosts declare the same METHODS list',
  dynMethods !== null && dynMethods === methodsOf(rd(LIB_HOST)), dynMethods);

// 9.5 features the tab exposes must exist on both host halves
const sharedHostFeatures = ['applyCsvSort', 'sortColumn', 'sortDesc', 'overloadThreshold'];
const missingFeature = [];
for (const f of sharedHostFeatures) {
  if (rd(DYN_HOST).indexOf(f) < 0) missingFeature.push('dynamic host lacks ' + f);
  if (rd(LIB_HOST).indexOf(f) < 0) missingFeature.push('persistent host lacks ' + f);
}
check('both hosts implement the shared features (CSV sort, CA overload threshold)',
  missingFeature.length === 0, missingFeature.join('; '));
// the sorter governs the row order, so require the two copies to be one implementation
function applyCsvSortOf(src) {
  const a = src.indexOf('// Sort CSV data rows by one header column.');
  const open = src.indexOf('{', src.indexOf('function applyCsvSort(', a));
  let depth = 0;
  let e = open;
  for (; e < src.length; e += 1) { if (src[e] === '{') depth += 1; else if (src[e] === '}') { depth -= 1; if (depth === 0) { e += 1; break; } } }
  return src.slice(a, e);
}
check('applyCsvSort is byte-identical in both hosts',
  applyCsvSortOf(rd(DYN_HOST)).length > 100 && applyCsvSortOf(rd(DYN_HOST)) === applyCsvSortOf(rd(LIB_HOST)));

// The draw.io launcher is shared by both hosts too: the Diagram tab's edit button asks the
// Host, and the Host must answer the same way whichever half is loaded. The dynamic half is an
// injected body with no imports, so neither copy may reach for node:child_process — the launch
// goes through the sandbox-aware `subprocess` service.
const SPAWN_MARK = '// --- Launch the local draw.io app';
const SPAWN_END = '// --- end draw.io launcher';
function drawioLauncherOf(src) {
  const a = src.indexOf(SPAWN_MARK);
  const b = src.indexOf(SPAWN_END);
  return a < 0 || b < 0 ? '' : src.slice(a, b);
}
check('the draw.io launcher is present in both hosts and byte-identical',
  drawioLauncherOf(rd(DYN_HOST)).length > 1000
  && drawioLauncherOf(rd(DYN_HOST)) === drawioLauncherOf(rd(LIB_HOST)),
  drawioLauncherOf(rd(DYN_HOST)).length + ' chars');
check('both hosts declare the openDrawio endpoint and launch through the subprocess service',
  dynMethods !== null && dynMethods.split(',').indexOf('openDrawio') >= 0
  && rd(LIB_HOST).indexOf('async openDrawio(') >= 0 && rd(DYN_HOST).indexOf('async openDrawio(') >= 0
  && rd(LIB_HOST).indexOf("get('subprocess')") >= 0 && rd(DYN_HOST).indexOf("get('subprocess')") >= 0
  // the comment above the launcher names node:child_process to say why it is NOT used, so look
  // for an actual import of it rather than for the word
  && rd(DYN_HOST).indexOf("'node:child_process'") < 0 && rd(LIB_HOST).indexOf("'node:child_process'") < 0);

// 9.6 the accepted divergences stay put: the chat tools are persistent-only (the dynamic
// host is an injected body with no imports, so it cannot carry node:fs helpers either)
check('the chat tools remain persistent-only',
  rd(LIB_HOST).indexOf('interpss_run_ca') >= 0 && rd(DYN_HOST).indexOf('interpss_run_ca') < 0);

// --- 10. the diagram listing, and no Diagram button on the InterPSS tab ---
console.log('\n10. the case diagram listing, and the InterPSS action row without a Diagram button');
// A diagram belongs to a case, so the Host lists <case>/diagram and the Diagram tab shows
// that answer. Both hosts must scope it there, and neither keeps the workspace-wide scanner
// the first version used.
check('both hosts scope the listing to the case diagram folder and dropped the workspace scan',
  rd(DYN_HOST).indexOf("'diagram'") >= 0 && rd(LIB_HOST).indexOf("'diagram'") >= 0
  && rd(DYN_HOST).indexOf('scanDrawio') < 0 && rd(LIB_HOST).indexOf('scanDrawio') < 0);
check('both hosts require a case argument for the listing',
  rd(DYN_HOST).indexOf('args.case') >= 0 && rd(LIB_HOST).indexOf('input.case') >= 0);

// 0.6.9 removed the InterPSS tab's Diagram button and the modal behind it, because the
// Diagram tab is the preview surface now. Both absences are asserted, so re-adding either
// one has to be a deliberate act rather than a merge artifact.
const findButton = (node, label) => {
  let hit = null;
  const walk = (n) => {
    if (hit !== null || n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const k of n) walk(k); return; }
    if (n.type === 'button' && (n.kids || []).indexOf(label) >= 0) { hit = n; return; }
    if (n.kids) walk(n.kids);
  };
  walk(node);
  return hit;
};
const fullRow = build({ 0: true }).InterPssView(props);
check('the InterPSS action row still carries ACLF, CA and Report',
  ['ACLF', 'CA', 'Report'].every((label) => findButton(fullRow, label) !== null));
check('the InterPSS action row has no Diagram button', findButton(fullRow, 'Diagram') === null);
check('the single-diagram shortcut helper went with the modal (no dead code left)',
  body.indexOf('drawioDirectPath') < 0 && body.indexOf('drawioFiles') < 0 && body.indexOf('drawioOpen') < 0);

// --- 11. diagram bus/branch tooltips ---------------------------------------
console.log('\n11. diagram bus/branch tooltips');
const partsOf = (g) => (Array.isArray(g.kids[0]) ? g.kids[0] : g.kids);
const groupsOf = (svg) => (svg.kids.length === 1 && Array.isArray(svg.kids[0]) ? svg.kids[0] : svg.kids);
// The template is the style contract the case diagrams are drawn from, and the two must stay the
// SAME DRAWING — same cells, same kinds, same edges. Geometry is deliberately NOT compared: a case
// diagram is a file the draw.io button invites you to open and edit, and once a symbol is nudged in
// draw.io (a local edit moved transformer group 3 from x=462 to x=503, leaving every id, kind and
// edge intact) an equality of coordinates fails for a change the workflow intends. What must not
// drift is the inventory the preview resolves against: the `busN` bars, `Bus-N` labels, the
// group-wrapped transformer rings and the undirected edges.
let templateScene = null;
try {
  templateScene = api.parseDrawioScene(readFileSync(TEMPLATE_DIAGRAM, 'utf8'));
} catch (e) {
  templateScene = null;
}
const drawingInventory = (s) => JSON.stringify({
  nodes: s.nodes.map((n) => n.id + ':' + n.kind).sort(),
  edges: s.edges.map((e) => e.id).sort(),
});
const sameInventory = templateScene !== null && scene !== null
  && drawingInventory(templateScene) === drawingInventory(scene);
check('the template and the live case diagram are the same drawing, hand edits aside', sameInventory,
  sameInventory ? undefined : (templateScene === null ? 'the template did not parse' : 'the two drawings differ'));

if (scene) {
  // the parser must keep what a tooltip needs
  const bar = scene.nodes.find((n) => n.id === 'bus1');
  const half = scene.nodes.find((n) => n.id === 'xf15');
  check('vertices keep their parent cell id',
    bar !== undefined && bar.parent === '1' && half !== undefined && half.parent === '3',
    (bar && bar.parent) + '/' + (half && half.parent));
  const e1 = scene.edges.find((e) => e.id === 'e1');
  check('edges keep id/source/target',
    e1 !== undefined && e1.source === 'bus1' && e1.target === 'bus2',
    e1 && e1.id + ':' + e1.source + '->' + e1.target);

  const pairs = api.drawioBranchPairs(scene);
  check('every edge resolves to a branch pair',
    scene.edges.every((e) => typeof pairs.edgePair[e.id] === 'string'),
    scene.edges.filter((e) => typeof pairs.edgePair[e.id] !== 'string').map((e) => e.id).join(','));
  check('a plain line resolves to its two buses', pairs.edgePair['e1'] === 'bus1|bus2', pairs.edgePair['e1']);
  check('both halves of a transformer branch resolve to the same pair',
    pairs.edgePair['e8a'] === 'bus4|bus7' && pairs.edgePair['e8b'] === 'bus4|bus7',
    pairs.edgePair['e8a'] + ' / ' + pairs.edgePair['e8b']);
  check('the transformer symbol itself resolves to its branch',
    pairs.nodePair['xf8'] === 'bus4|bus7' && pairs.nodePair['xf8b'] === 'bus4|bus7',
    pairs.nodePair['xf8'] + ' / ' + pairs.nodePair['xf8b']);
  check('the page background and the legend resolve to nothing',
    pairs.nodePair['bg'] === undefined && pairs.nodePair['legend'] === undefined);
  check('the resolver is defensive about an absent scene',
    api.drawioBranchPairs(null).edgePair !== undefined);

  // cross-check the resolved pairs against the result table the tooltips quote
  const csv = readFileSync(BRANCH_CSV, 'utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const head = csv[0].split(',');
  const iFrom = head.indexOf('FromBusID');
  const iTo = head.indexOf('ToBusID');
  const iX = head.indexOf('IsXfmr');
  const table = new Map();
  for (const line of csv.slice(1)) {
    const c = line.split(',');
    const key = [c[iFrom].toLowerCase(), c[iTo].toLowerCase()].sort().join('|');
    if (!table.has(key)) table.set(key, []);
    table.get(key).push(c);
  }
  check('the branch table and the diagram describe the same branch pairs',
    table.size === 20 && scene.edges.every((e) => table.has(pairs.edgePair[e.id])),
    'table ' + table.size + ' pairs, ' + scene.edges.length + ' edges');
  const xfRow = table.get('bus4|bus7');
  check('a transformer pair finds its transformer row',
    xfRow !== undefined && xfRow.length === 1 && xfRow[0][iX] === 'true',
    xfRow && xfRow[0][iX]);

  // hit areas: opt-in, invisible, and only on cells that carry data
  const noHover = groupsOf(api.DrawioDiagram({ scene: scene })).map(partsOf);
  check('without hover no hit area is emitted',
    noHover.every((parts) => parts.every((p) => p.props.key !== 'h')));

  const calls = [];
  const hover = {
    pairs: pairs,
    onBus: (id) => calls.push(['bus', id]),
    onBranch: (key) => calls.push(['branch', key]),
    onMove: () => {},
    onLeave: () => {},
  };
  const groups = groupsOf(api.DrawioDiagram({ scene: scene, hover: hover }));
  const byKey = {};
  for (const g of groups) byKey[g.props.key] = partsOf(g);
  const hitOf = (k) => (byKey[k] || []).find((p) => p.props.key === 'h');

  const i8a = scene.edges.findIndex((e) => e.id === 'e8a');
  const edgeHit = hitOf('e' + i8a);
  check('a branch emits a transparent wide-stroke hit line',
    edgeHit !== undefined && edgeHit.props.stroke === 'transparent'
    && edgeHit.props.strokeWidth >= 8 && edgeHit.props.pointerEvents === 'stroke',
    edgeHit && String(edgeHit.props.strokeWidth));
  edgeHit.props.onMouseEnter({ clientX: 1, clientY: 2 });
  check('hovering a branch reports its resolved bus pair',
    calls.length === 1 && calls[0][0] === 'branch' && calls[0][1] === 'bus4|bus7', JSON.stringify(calls));

  const iBus = scene.nodes.findIndex((n) => n.id === 'bus5');
  const busHit = hitOf('n' + iBus);
  check('a bus emits a padded transparent hit rect',
    busHit !== undefined && busHit.props.fill === 'transparent' && busHit.props.pointerEvents === 'all'
    && busHit.props.width === scene.nodes[iBus].w + 8, busHit && String(busHit.props.width));
  busHit.props.onMouseEnter({ clientX: 3, clientY: 4 });
  check('hovering a bus reports that bus',
    calls.length === 2 && calls[1][0] === 'bus' && calls[1][1] === 'bus5', JSON.stringify(calls));

  const iLabel = scene.nodes.findIndex((n) => n.kind === 'text' && n.lines.join('') === 'Bus-5');
  check('a Bus-N label stands in for its bar', hitOf('n' + iLabel) !== undefined);
  check('the legend and the background emit no hit area',
    hitOf('n' + scene.nodes.findIndex((n) => n.id === 'bg')) === undefined
    && hitOf('n' + scene.nodes.findIndex((n) => n.id === 'legend')) === undefined);

  check('a bus cell id is recognised',
    api.drawioIsBusId('bus12') && !api.drawioIsBusId('nm1') && !api.drawioIsBusId('bg') && !api.drawioIsBusId(null));
  check('a Bus-N label maps to its bar, other text does not',
    api.drawioLabelBusId(['Bus-7']) === 'bus7' && api.drawioLabelBusId(['vertical bus']) === null
    && api.drawioLabelBusId([]) === null);
  check('the canonical BusN spelling comes from the table',
    api.drawioCanonicalBusId({ bus3: 'Bus3' }, 'bus3') === 'Bus3');
  check('a bus no branch mentions falls back to the cell spelling',
    api.drawioCanonicalBusId({}, 'bus9') === 'Bus9' && api.drawioCanonicalBusId(null, 'bus9') === 'Bus9');
  check('a pair key reads as two buses', api.drawioPairLabel('bus4|bus7') === 'Bus 4 to Bus 7', api.drawioPairLabel('bus4|bus7'));
  check('the fallback tip distinguishes missing data from a missing row',
    api.drawioFallbackTip('Bus 4', false).indexOf('no result data') >= 0
    && api.drawioFallbackTip('Bus 4', true).indexOf('not found') >= 0);
  check('a data-free cell has no hover target',
    api.drawioHoverTarget(scene.nodes.find((n) => n.id === 'bg'), pairs) === null
    && api.drawioHoverTarget(scene.nodes.find((n) => n.id === 'legend'), pairs) === null);

  // The tooltip WORDING stays the connection diagram's, so the two cannot drift apart.
  const busTip = api.busTooltip({
    name: 'Bus 2     HV', baseKV: '132000.0', status: 'true', voltMag: '1.0450', voltAng: '-0.09',
    genCount: 1, genCode: 'NonGen', genIds: ['Bus2-G1'],
    loadCount: 1, loadCode: 'ConstP', loadIds: ['Bus2-L1'],
    totalGenP: 0.4, totalGenQ: 0.4355,
  });
  check('the bus tooltip carries the reference fields',
    ['Bus Name:', 'BaseVolt:', 'Status:', 'Voltage (pu):', 'Angle (degrees):',
      'Bus GenCode:', 'Number of generators:', 'Gen ID: Bus2-G1',
      'Bus LoadCode:', 'Number of loads:', 'Load ID: Bus2-L1',
      'Total Gen P (pu):', 'Total Gen Q (pu):'].every((f) => busTip.indexOf(f) >= 0),
    busTip.split('\n').length + ' lines');
  const xfRow2 = table.get('bus4|bus7')[0];
  const branchTip = api.branchTooltip(xfRow2);
  check('the branch tooltip names the transformer and both ends',
    branchTip.indexOf('Branch ID: Bus4->Bus7(1)') >= 0 && branchTip.indexOf('Branch Type: Transformer') >= 0
    && branchTip.indexOf('From Bus: Bus4') >= 0 && branchTip.indexOf('To Bus: Bus7') >= 0,
    branchTip.split('\n')[0]);
  check('both tooltip builders survive a missing record',
    api.busTooltip(null) === 'Bus info' && api.branchTooltip(null) === 'Branch info');
  // 0.6.30: the flow loadings. The base case comes from the branch table the row came from, the
  // contingency from the caller (only the Diagram tab reads the CA table), and neither line appears
  // when the value is not there -- "when available" is the whole rule.
  const loadedRow = xfRow2.slice();
  loadedRow[24] = '58.94';
  const loadedTip = api.branchTooltip(loadedRow, { contingencyLoading: 70 });
  check('the branch tooltip shows both loadings, in percent, one decimal at most',
    loadedTip.indexOf('Basecase Loading(%): 58.9%') > 0
    && loadedTip.indexOf('Contingency Loading(%): 70%') > 0
    && loadedTip.indexOf('58.94') < 0,
    loadedTip.split('\n').slice(-3).join(' | '));
  check('a whole number loses its pointless decimal',
    api.loadingText('59.0') === '59%' && api.loadingText(70) === '70%' && api.loadingText('118.25') === '118.3%'
    && api.loadingText('') === null && api.loadingText('n/a') === null && api.loadingText(undefined) === null);
  check('the base-case line shows without any contingency data, and vice versa',
    api.branchTooltip(loadedRow).indexOf('Basecase Loading(%): 58.9%') > 0
    && api.branchTooltip(loadedRow).indexOf('Contingency') < 0
    && api.branchTooltip(xfRow2, { contingencyLoading: 91 }).indexOf('Contingency Loading(%): 91%') > 0);
  check('neither line appears when the row carries no loading column',
    (function () {
      const bare = xfRow2.slice(0, 24);
      const tip = api.branchTooltip(bare);
      return tip.indexOf('Loading') < 0 && tip.indexOf('Power From->To') > 0;
    })());
  check('the connection diagram passes no contingency, so its tooltip is unchanged',
    slice.indexOf("showTip(branchTooltip(branches[0]), e)") >= 0
    && slice.indexOf('branchTooltip(r, { contingencyLoading: contingency })') >= 0);
}

// --- 12. the Diagram tab (a second conversation view, order 2) --------------
console.log('\n12. the Diagram tab follows the InterPSS selection');
// The tab exists only if it registers, and it must land between InterPSS (order 1) and
// Trajectory (order 10).
check('the Diagram tab is registered beside the InterPSS tab',
  /name: 'conversation\.view', id: 'diagram', order: 2, label: 'Diagram'/.test(body)
  && /name: 'conversation\.view', id: 'interpss', order: 1, label: 'InterPSS'/.test(body));
// The InterPSS tab owns "the current simulation case" and this tab only follows it. No
// render can observe that contract, so assert the wiring itself: the owning tab publishes
// the selection, the following tab seeds from it and adopts a case the Host loaded.
check('the InterPSS tab publishes its selection to the shared case',
  /function onCaseChanged\(input\) \{[\s\S]{0,400}?selectedCaseInput = input/.test(body));
check('the Diagram tab seeds from the shared case and follows a bridge-loaded one',
  body.indexOf('React.useState(selectedCaseInput)') >= 0 && body.indexOf('adoptSelectedCase(input)') >= 0);
check('the shared case defaults to the InterPSS preset rather than to nothing',
  /let selectedCaseInput = selectionCaseInput\(\)/.test(body) && /function selectionCaseInput\(\)/.test(body));

// Which diagram a case opens: the one the user last opened while it is still in the
// folder, else the first — and nothing at all for a case with no diagram.
const tabFiles = (n) => Array.from({ length: n }, (_, i) => ({ path: 'wspace/data/c/diagram/d' + i + '.drawio', size: 10 }));
check('the tab opens the first diagram of a case',
  api.drawioTabChoice(tabFiles(3), '') === 'wspace/data/c/diagram/d0.drawio', api.drawioTabChoice(tabFiles(3), ''));
check('the tab reopens the diagram the user last chose',
  api.drawioTabChoice(tabFiles(3), 'wspace/data/c/diagram/d2.drawio') === 'wspace/data/c/diagram/d2.drawio');
check('a remembered diagram that is gone falls back to the first',
  api.drawioTabChoice(tabFiles(3), 'wspace/data/c/diagram/gone.drawio') === 'wspace/data/c/diagram/d0.drawio');
check('a case with no diagram opens nothing at all',
  api.drawioTabChoice([], '') === null && api.drawioTabChoice(null, '') === null
  && api.drawioTabChoice([{ size: 1 }], '') === null && api.drawioTabChoice([null], '') === null);

// Render the view itself. Overrides are addressed by ITS OWN useState order, because a
// fresh harness renders DiagramView alone and the mock counts from zero — and a throw
// anywhere in the view would unmount it, blanking the tab with nothing in the Host log.
const dgmNames = [...slice.slice(slice.indexOf('function DiagramView('))
  .matchAll(/const \[([A-Za-z0-9_]+), set[A-Za-z0-9_]+\] = React\.useState/g)].map((m) => m[1]);
const dgmIdx = (n) => dgmNames.indexOf(n);
check('the Diagram tab state list parsed by name',
  dgmNames.length >= 15 && dgmIdx('caseInput') === 0 && dgmIdx('scene') > 0 && dgmIdx('files') > 0,
  dgmNames.length + ' states');
check('every Diagram tab state is declared once, so an override cannot retarget',
  dgmNames.every((n, i) => dgmNames.indexOf(n) === i), dgmNames.join(','));
// §7 only sees the effects its own regex matches, so prove it parses every effect of this
// view: an effect it skipped would be an unchecked blank-tab path. Verified by mutation —
// adding a dep declared below its effect makes §7 report the char distance and the render
// checks below throw `Cannot access '…' before initialization`, exactly the 0.6.0 defect.
const dgmSlice = slice.slice(slice.indexOf('function DiagramView('));
const dgmEffectDecls = (dgmSlice.match(/React\.useEffect\(/g) || []).length;
const dgmEffectParsed = (dgmSlice.match(/React\.useEffect\(\(\) => \{[\s\S]*?\n      \}, \[[^\]]*\]\)/g) || []).length;
check('the ordering check parses every Diagram tab effect',
  dgmEffectDecls > 0 && dgmEffectDecls === dgmEffectParsed, dgmEffectParsed + ' of ' + dgmEffectDecls + ' effects parsed');

const renderTab = (over) => build(over).DiagramView({ sessionId: 'test-session', callRemote: () => Promise.resolve({}) });
const flatTree = (tree) => JSON.stringify(tree, (k, v) => (typeof v === 'function' ? '[fn]' : v));
const renderFlat = (over) => {
  try {
    return flatTree(renderTab(over));
  } catch (e) {
    return 'THREW ' + e.constructor.name + ': ' + e.message;
  }
};
const withState = (pairs) => {
  const over = {};
  for (const [name, value] of pairs) over[dgmIdx(name)] = value;
  return over;
};

const idle = renderFlat({});
check('the tab renders before the diagram list answers', idle.indexOf('THREW') < 0 && idle.indexOf('Simu Case') >= 0, idle.slice(0, 90));
check('it names the shared case and shows the lookup state',
  idle.indexOf('Simu Case') >= 0 && idle.indexOf('data/ieee/Ieee118Bus/ieee118.ieee') >= 0
  && idle.indexOf('Looking for .drawio files') >= 0);
// Asked for in 0.6.10: the tab bar names the view and the Simu Case row says what is drawn,
// so a heading and a subtitle here only pushed the diagram down.
check('the tab carries no heading or subtitle of its own',
  idle.indexOf('The one-line diagram of the case') < 0 && idle.indexOf('<h2>') < 0
  && idle.indexOf('"h2"') < 0 && idle.indexOf('"Diagram"') < 0);
const noCase = renderFlat(withState([['caseInput', '']]));
check('with no case it points at the InterPSS tab instead of drawing nothing',
  noCase.indexOf('No simulation case selected') >= 0, noCase.slice(0, 90));
const noDiagram = renderFlat(withState([['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'], ['files', []], ['filesLoading', false]]));
check('a case with no .drawio file says so',
  noDiagram.indexOf("No .drawio file in this case's diagram folder") >= 0, noDiagram.slice(0, 90));
const failed = renderFlat(withState([['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'], ['filesError', 'Invalid case path: x'], ['files', []]]));
check('a listing failure is shown rather than swallowed', failed.indexOf('Invalid case path: x') >= 0);

// The open diagram: the rendered pane, its toolbar, the embedded renderer and the tooltip
// element are the parts a reference error would take down.
const openTab = { scene: scene };
const drawn = withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['filesLoading', false],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
  ['loading', false],
  ['error', null],
  ['tip', { text: 'Bus 5\nVoltage (pu): 1.0200', x: 10, y: 20 }],
]);
const drawnFlat = renderFlat(drawn);
check('rendering an open diagram does not throw', drawnFlat.indexOf('THREW') < 0, drawnFlat.slice(0, 120));
check('the zoom toolbar and readout are present',
  drawnFlat.indexOf('"Fit"') >= 0 && drawnFlat.indexOf('"+"') >= 0
  && drawnFlat.indexOf('"' + String.fromCharCode(0x2212) + '"') >= 0 && drawnFlat.indexOf('"100%"') >= 0);
// 0.6.21: that readout is a picker, so the render must carry its accessible name and every preset
// as an option label -- a list that silently lost an entry would still pass a screenshot review.
check('the readout renders as the zoom picker with its presets',
  drawnFlat.indexOf('"Zoom level"') >= 0
  && api.DRAWIO_ZOOM_PRESETS.every((p) => drawnFlat.indexOf('"' + p + '%"') >= 0),
  JSON.stringify(api.DRAWIO_ZOOM_PRESETS));
// The picker sets a width from a percentage; `drawioZoomPercent` reads it back. The two must agree
// for every preset, or picking a level would land on a different one than it showed.
check('every preset percent round-trips through the zoom rect width',
  api.DRAWIO_ZOOM_PRESETS.every((p) => api.drawioZoomPercent(
    { viewBox: { x: 0, y: 0, w: 1000, h: 800 } },
    { x: 0, y: 0, w: 1000 * 100 / p, h: 800 * 100 / p }) === p));
check('the preset list is the documented 25 to 400 percent',
  JSON.stringify(api.DRAWIO_ZOOM_PRESETS) === JSON.stringify([25, 50, 75, 100, 125, 150, 200, 300, 400]),
  JSON.stringify(api.DRAWIO_ZOOM_PRESETS));
// Asked for in 0.6.11: the wheel and the drag are discoverable on their own, so the toolbar is
// just the view toggle, the two step buttons and the picker (which carries Fit since 0.6.22).
check('the toolbar carries no scroll/drag hint text',
  drawnFlat.indexOf('Scroll to zoom') < 0 && body.indexOf('Scroll to zoom') < 0);
// The edit button is the one control that leaves the app: the Host launches the local draw.io
// desktop app, so the click must reach `openDrawio` with the diagram actually on screen.
const editCalls = [];
const editApi = build(drawn);
let editTree = null;
try {
  editTree = editApi.DiagramView({
    sessionId: 'test-session',
    callRemote: (method, input) => { editCalls.push([method, input]); return Promise.resolve({ ok: true, launcher: 'open -a draw.io' }); },
  });
  check('rendering the edit button does not throw', editTree !== null && editTree !== undefined);
} catch (e) {
  check('rendering the edit button does not throw', false, e.constructor.name + ': ' + e.message);
}
const findInTree = (node, want) => {
  let hit = null;
  const walk = (n) => {
    if (hit !== null || n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const k of n) walk(k); return; }
    if (want(n)) { hit = n; return; }
    if (n.kids) walk(n.kids);
  };
  walk(node);
  return hit;
};
// Ancestor chain of the first matching node, so the edit button's PLACEMENT can be asserted and
// not just its presence: it belongs in the lower-right row, never in the view/zoom toolbar.
const pathToNode = (node, want) => {
  let found = null;
  const walk = (n, chain) => {
    if (found !== null || n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const k of n) walk(k, chain); return; }
    const next = chain.concat([n]);
    if (want(n)) { found = next; return; }
    if (n.kids) walk(n.kids, next);
  };
  walk(node, []);
  return found;
};
const editButton = findInTree(editTree, (n) => n.type === 'button'
  && String(n.props.title || '').indexOf('local draw.io app') >= 0);
check('the tab carries the local-draw.io edit button with its tooltip',
  editButton !== null && String(editButton.props['aria-label']).indexOf('local draw.io app') >= 0
  && editButton.props.disabled === false, editButton === null ? 'no button' : String(editButton.props.title));
const editChain = pathToNode(editTree, (n) => n.type === 'button'
  && String(n.props.title || '').indexOf('local draw.io app') >= 0);
// Placement, not presence: the button belongs in the tab's TOP row (the one naming the case),
// right-aligned — the upper-right corner. Both earlier placements failed in the app: at the end
// of the toolbar it sat among the zoom controls, and in a row of its own after a 70vh drawing it
// landed below the fold (0.6.13) or needed a sticky strip to stay in view (0.6.14).
const styleOf = (n) => (n === null || n === undefined || n.props === undefined ? {} : (n.props.style || {}));
const topRow = editChain === null ? null
  : editChain.find((n) => styleOf(n).justifyContent === 'space-between');
check('the edit button sits in the tab\'s top row, right-aligned (the upper-right corner)',
  topRow !== null && topRow.type === 'div' && styleOf(topRow).display === 'flex'
  && findInTree(topRow, (n) => n.type === 'span' && (n.kids || []).indexOf('Simu Case') >= 0) !== null
  // the edit controls are the row's LAST child, i.e. the right-hand side
  && findInTree(topRow.kids[topRow.kids.length - 1], (n) => n.type === 'button'
    && String(n.props.title || '').indexOf('local draw.io app') >= 0) !== null,
  topRow === null ? 'no top row' : JSON.stringify(styleOf(topRow)));
check('the button no longer needs the retired sticky-strip workaround',
  styleOf(editButton).position === undefined && styleOf(editButton).pointerEvents === undefined
  && slice.slice(slice.indexOf('function DiagramView(')).indexOf("position: 'sticky'") < 0);
// 0.6.34 removed the `R` / `S` view toggle, so the row is located by a control that remains:
// the Search button. (It used to key on the button labelled `R`.)
const toolbarRow = findInTree(editTree, (n) => n.type === 'div' && Array.isArray(n.kids)
  && n.kids.some((k) => k !== null && k !== undefined && k.type === 'button'
    && String(k.props.title || '') === 'Search the diagram'));
check('the toolbar row ends at the filter button, with no draw.io and no separate Fit button',
  toolbarRow !== null
  // the EDIT button's own title — the bare word `draw.io` now also appears in the Source tooltip
  && findInTree(toolbarRow, (n) => n.type === 'button' && String(n.props.title || '').indexOf('local draw.io app') >= 0) === null
  // 0.6.22: Fit moved into the picker, so no Fit button survives there
  && findInTree(toolbarRow, (n) => n.type === 'button' && (n.kids || []).indexOf('Fit') >= 0) === null
  // and 0.6.23 put the two icon buttons last (counted last, not by length: the file picker and the
  // status span share this row)
  && (function () {
    // the last CONTROL, not the last child: a flags summary span (0.6.26) can follow the buttons
    const kids = (toolbarRow.kids || []).filter((k) => k !== null && k !== undefined && k.type === 'button');
    const last = kids[kids.length - 1];
    return last !== undefined && String(last.props.title) === 'Filter the diagram';
  })());

// 0.6.34: the `R` / `S` view toggle is gone — the tab always draws the rendered scene — so the
// row must open with the zoom pair and carry no view control of any spelling. The `Rendered` /
// `Source` buttons in the *report* view of the InterPSS tab are a different surface and stay.
const toolbarButtons = toolbarRow === null ? [] : (toolbarRow.kids || [])
  .filter((k) => k !== null && k !== undefined && k.type === 'button');
const firstToolbarLabel = toolbarButtons.length === 0 ? null : (toolbarButtons[0].kids || [])[0];
check('the toolbar carries no view toggle, and starts at the zoom-out control',
  toolbarRow !== null && firstToolbarLabel === '\u2212'
  && ['R', 'S', 'Rendered', 'Source'].every((letter) => findInTree(toolbarRow,
    (n) => n.type === 'button' && (n.kids || []).indexOf(letter) >= 0) === null)
  && slice.indexOf("const [view, setView]") < 0
  && slice.indexOf("setView(") < 0
  && slice.indexOf("view === 'source'") < 0,
  toolbarRow === null ? 'no toolbar' : String(firstToolbarLabel));

// 0.6.21, the zoom picker, checked structurally: it is a `select` in the toolbar row, it sits
// exactly between the two step buttons, and its handler exists (the harness's setState is a
// no-op, so what is proved is that picking a level reaches a handler without throwing).
const zoomSel = toolbarRow === null ? null : findInTree(toolbarRow, (n) => n.type === 'select'
  && String(n.props['aria-label'] || '') === 'Zoom level');
const zoomOutBtn = toolbarRow === null ? null : findInTree(toolbarRow, (n) => n.type === 'button' && n.props.title === 'Zoom out');
const zoomInBtn = toolbarRow === null ? null : findInTree(toolbarRow, (n) => n.type === 'button' && n.props.title === 'Zoom in');
const rowKids = toolbarRow === null ? [] : (toolbarRow.kids || []);
// The options are passed to createElement as one array, which React flattens and this harness
// keeps nested -- read both shapes, the way partsOf/groupsOf do.
const optionKids = (sel) => (sel === null || sel.kids === undefined ? []
  : (Array.isArray(sel.kids[0]) ? sel.kids[0] : sel.kids));
const zoomOpts = optionKids(zoomSel).map((o) => String((o.kids || [])[0]));
check('the level readout is a select labelled Zoom level, offering the presets and Fit',
  zoomSel !== null && zoomSel.props.title === 'Zoom level'
  // the fixture is fitted (rect === null), so the control must say Fit, not claim a percentage
  && zoomSel.props.value === 'fit'
  && JSON.stringify(zoomOpts) === JSON.stringify(api.DRAWIO_ZOOM_PRESETS.map((p) => p + '%').concat(['Fit'])),
  zoomSel === null ? 'no picker' : zoomSel.props.value + ' / ' + JSON.stringify(zoomOpts));
check('the picker sits between the - and + buttons',
  zoomSel !== null && zoomOutBtn !== null && zoomInBtn !== null
  && rowKids.indexOf(zoomSel) === rowKids.indexOf(zoomOutBtn) + 1
  && rowKids.indexOf(zoomInBtn) === rowKids.indexOf(zoomSel) + 1,
  JSON.stringify(rowKids.map((k) => (k === null ? 'null' : k.type + ':' + String(k.props.title || (k.kids || []).join(''))))));
check('picking a level, and picking Fit, reach a handler without throwing',
  zoomSel !== null && typeof zoomSel.props.onChange === 'function'
  && (() => {
    try {
      zoomSel.props.onChange({ target: { value: '25' } });
      zoomSel.props.onChange({ target: { value: 'fit' } });
      return true;
    } catch (e) {
      return false;
    }
  })());

// A wheel-zoomed level is not one of the presets (the screenshot that asked for this was at
// 745%), and the control must still show it -- and offer it back -- instead of rounding to 400.
const zoomedRect = { x: 0, y: 0, w: scene.viewBox.w * 100 / 745, h: scene.viewBox.h * 100 / 745 };
const zoomedTab = renderTab(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
  ['rect', zoomedRect],
]));
const zoomedSel = findInTree(zoomedTab, (n) => n.type === 'select' && String(n.props['aria-label'] || '') === 'Zoom level');
const zoomedOpts = optionKids(zoomedSel).map((o) => String((o.kids || [])[0]));
check('a level the wheel reached is shown and offered back, in order',
  zoomedSel !== null && zoomedSel.props.value === '745'
  && JSON.stringify(zoomedOpts) === JSON.stringify(api.DRAWIO_ZOOM_PRESETS.concat([745]).map((p) => p + '%').concat(['Fit'])),
  zoomedSel === null ? 'no picker' : zoomedSel.props.value + ' / ' + JSON.stringify(zoomedOpts));
// 0.6.23: the two icon buttons, and the fact that they open the dialogs. The harness's setState is
// a no-op, so the CLICK cannot be observed in the tree -- the wiring is asserted on the source and
// the dialogs are rendered directly from state below, which is what actually matters.
const searchBtn = toolbarRow === null ? null : findInTree(toolbarRow, (n) => n.type === 'button' && String(n.props['aria-label'] || '') === 'Search the diagram');
const filterBtn = toolbarRow === null ? null : findInTree(toolbarRow, (n) => n.type === 'button' && String(n.props['aria-label'] || '') === 'Filter the diagram');
check('the toolbar carries Search and Filter buttons',
  searchBtn !== null && filterBtn !== null && String(searchBtn.props.title) === 'Search the diagram'
  && String(filterBtn.props.title) === 'Filter the diagram',
  searchBtn === null ? 'no search button' : String(searchBtn.props.title));
check('the buttons open their dialogs, and neither is a file write',
  slice.indexOf('onClick: openSearch') >= 0 && slice.indexOf('onClick: openFilter') >= 0
  && slice.indexOf('setDialog(\'search\')') >= 0 && slice.indexOf('setDialog(\'filter\')') >= 0);

// The dialogs, rendered from the state the buttons set (the harness cannot click, so the fixture
// supplies it). OK/Cancel, the field each one is for, and that Cancel is a plain close.
const searchDialog = renderTab(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
  ['dialog', 'search'],
  ['searchText', '1001'],
]));
const searchDialogButtons = ['OK', 'Cancel'].map((label) => findInTree(searchDialog, (n) => n.type === 'button' && (n.kids || []).indexOf(label) >= 0));
check('the search dialog has a field and OK / Cancel',
  findInTree(searchDialog, (n) => n.type === 'input' && String(n.props['aria-label'] || '') === 'Search the diagram') !== null
  && searchDialogButtons[0] !== null && searchDialogButtons[1] !== null
  && findInTree(searchDialog, (n) => n.props !== undefined && n.props.role === 'dialog') !== null,
  searchDialogButtons.map((b) => (b === null ? 'missing' : 'ok')).join('/'));
const searchDialogFlat = renderFlat(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
  ['dialog', 'search'],
  ['busMeta', { areas: [], zones: [], ofBus: { bus1: { area: '', zone: '', name: 'ODESSA 2 0' } } }],
]));
check('the search dialog shows this case\'s help and an arrow placeholder',
  searchDialogFlat.indexOf('14 buses here (Bus-1 to Bus-14)') > 0
  && searchDialogFlat.indexOf('Bus-1 -> Bus-2') > 0 && searchDialogFlat.indexOf('ODESSA') > 0
  && searchDialogFlat.indexOf('1001-1002') < 0,
  searchDialogFlat.slice(searchDialogFlat.indexOf('14 buses'), searchDialogFlat.indexOf('14 buses') + 70));
check('the search dialog keeps OK and Cancel wired, and Cancel only closes',
  (function () {
    try {
      searchDialogButtons[0].props.onClick();
      searchDialogButtons[1].props.onClick();
      return true;
    } catch (e) {
      return false;
    }
  })()
  && slice.indexOf('setDialog(null)') >= 0 && slice.indexOf('applySearch') >= 0);

const filterDialog = renderTab(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
  ['dialog', 'filter'],
  ['busMeta', { areas: [{ num: '1', name: 'NORTH' }], zones: [{ num: '9', name: 'FAR WEST TEX', area: '1' }], ofBus: {} }],
  // a band that is deliberately NOT the shipped 0.9-1.1: the label must follow the config (0.6.27)
  ['netConfig', api.drawioNetConfig({ Bus_flag_lower_limit: 0.95, Bus_flag_upper_limit: 1.05 })],
  ['branchLoads', { 'bus1|bus2': 91.5, 'bus5|bus6': 45 }],
  ['conLoads', { 'bus1|bus2': 118 }],
]));
const filterDialogButtons = ['OK', 'Cancel'].map((label) => findInTree(filterDialog, (n) => n.type === 'button' && (n.kids || []).indexOf(label) >= 0));
const areaSelect = findInTree(filterDialog, (n) => n.type === 'select' && String(n.props['aria-label'] || '') === 'Area');
const zoneSelect = findInTree(filterDialog, (n) => n.type === 'select' && String(n.props['aria-label'] || '') === 'Zone');
check('the filter dialog offers area, zone, the band checkbox, and OK / Cancel',
  areaSelect !== null && zoneSelect !== null && filterDialogButtons[0] !== null && filterDialogButtons[1] !== null
  && findInTree(filterDialog, (n) => n.type === 'input' && n.props.type === 'checkbox') !== null,
  JSON.stringify([optionKids(areaSelect).map((o) => String((o.kids || [])[0])), optionKids(zoneSelect).map((o) => String((o.kids || [])[0]))]));
// 0.6.24: the message follows the DIALOG's fields, not the applied filter. This is the bug the
// screenshot showed -- Area/Zone changed to 7 COAST / 1 BAY CITY while the line still read the
// previous "area 1, zone 9" because it was computed from the applied value.
const draftDialog = renderFlat(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
  ['dialog', 'filter'],
  ['filterArea', '2'],
  ['filterZone', ''],
  ['filterApplied', { area: '1', zone: '9', outOfBand: false }],
  ['busMeta', {
    areas: [{ num: '1', name: 'NORTH' }, { num: '2', name: 'SOUTH' }],
    zones: [{ num: '9', name: 'FAR WEST TEX', area: '1' }, { num: '7', name: 'AGGIE', area: '2' }],
    ofBus: { bus1: { area: '2', zone: '7', name: 'A' }, bus2: { area: '2', zone: '7', name: 'B' }, bus3: { area: '1', zone: '9', name: 'C' } },
  }],
]));
// Only the MESSAGE is asserted here: the toolbar status legitimately still says `area 1` while the
// dialog is open, because that one shows what is applied to the drawing.
const draftMessage = draftDialog.slice(draftDialog.indexOf('Showing'), draftDialog.indexOf('Showing') + 80);
check('the filter message previews the dialog fields, not the applied filter',
  draftMessage.indexOf('area 2 SOUTH') >= 0 && draftMessage.indexOf('area 1') < 0
  && draftMessage.indexOf('Showing 2 of 14 buses') >= 0,
  draftMessage);
check('the toolbar status keeps the APPLIED filter, so Cancel still cancels',
  slice.indexOf('filterApplied === null || scene === null') >= 0
  && slice.indexOf('const draftHits = scene === null') >= 0);

const filterBoxes = ['Only buses outside the voltage band',
  'Only branches at or above the base-case flow flag',
  'Only branches at or above the contingency flow flag']
  .map((label) => findInTree(filterDialog, (n) => n.type === 'input' && n.props.type === 'checkbox'
    && String(n.props['aria-label'] || '') === label));
check('the filter dialog offers all three criteria, labelled from the config',
  filterBoxes.every((b) => b !== null)
  // the CODE's fallback defaults (80/100), because this fixture sets only the bus band: the user's
  // own file value is theirs to tune and is not what a fresh profile shows
  && flatTree(filterDialog).indexOf('Only branches with base-case loading \u2265 80%') > 0
  && flatTree(filterDialog).indexOf('Only branches with contingency loading \u2265 100%') > 0,
  filterBoxes.filter((b) => b === null).length + ' missing');
check('the two flow boxes are offered but not tappable when their table is missing',
  (function () {
    const noData = renderFlat(withState([
      ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
      ['files', tabFiles(2)],
      ['path', 'wspace/data/c/diagram/d0.drawio'],
      ['scene', scene],
      ['dialog', 'filter'],
      ['busMeta', { areas: [], zones: [], ofBus: {} }],
      ['branchLoads', null],
      ['conLoads', null],
    ]));
    const box = findInTree(renderTab(withState([
      ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
      ['files', tabFiles(2)],
      ['path', 'wspace/data/c/diagram/d0.drawio'],
      ['scene', scene],
      ['dialog', 'filter'],
      ['busMeta', { areas: [], zones: [], ofBus: {} }],
      ['branchLoads', null],
      ['conLoads', null],
    ])), (n) => n.type === 'input' && n.props.type === 'checkbox'
      && String(n.props['aria-label'] || '') === 'Only branches at or above the base-case flow flag');
    return noData.indexOf('no branch table yet') > 0 && box !== null && box.props.disabled === true
      && box.props.checked === false;
  })());

check('the filter dialog\'s band checkbox reads the config, not a literal',
  flatTree(filterDialog).indexOf('Only buses with |V| outside 0.95\u20131.05 pu') > 0
  && flatTree(filterDialog).indexOf('outside 0.9\u20131.1') < 0,
  api.drawioBandText(api.drawioNetConfig({ Bus_flag_lower_limit: 0.95, Bus_flag_upper_limit: 1.05 })));
check('the filter dialog offers the case\'s own areas and zones, plus All',
  JSON.stringify(optionKids(areaSelect).map((o) => String((o.kids || [])[0]))) === JSON.stringify(['All areas', '1  NORTH'])
  && JSON.stringify(optionKids(zoneSelect).map((o) => String((o.kids || [])[0]))) === JSON.stringify(['All zones', '9  FAR WEST TEX']));

// 0.6.26: the gear. It lives in the header row beside the draw.io button -- NOT in the toolbar, so
// the toolbar's controls stay the ones the mock specifies -- and it opens the config dialog.
const gearButton = findInTree(editTree, (n) => n.type === 'button'
  && String(n.props['aria-label'] || '') === 'One-line diagram config options');
check('the header row carries the config gear next to the draw.io button',
  gearButton !== null && String(gearButton.props.title) === 'One-line diagram config options'
  && topRow !== null && findInTree(topRow, (n) => n.type === 'button' && String(n.props['aria-label'] || '') === 'Edit this diagram in the local draw.io app') !== null,
  gearButton === null ? 'no gear' : String(gearButton.props.title));
check('the gear opens the config dialog and the save asks the Host to write the file',
  slice.indexOf('onClick: openConfig') >= 0 && slice.indexOf("setDialog('config')") >= 0
  && slice.indexOf("callRemote('saveNetDiagramOptions'") >= 0
  && slice.indexOf("callRemote('getNetDiagramOptions'") >= 0);

const cfgDialog = renderTab(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
  ['dialog', 'config'],
  ['cfgForm', api.drawioNetConfig(null)],
]));
const cfgInputs = api.DRAWIO_NET_FIELDS.map((f) => findInTree(cfgDialog, (n) => n.type === 'input' && String(n.props['aria-label'] || '') === f.label));
const cfgButtons = ['OK', 'Cancel'].map((label) => findInTree(cfgDialog, (n) => n.type === 'button' && (n.kids || []).indexOf(label) >= 0));
const cfgFlat = flatTree(cfgDialog);
check('the config dialog shows every option, OK and Cancel, and the file it writes',
  cfgInputs.every((i) => i !== null) && cfgButtons[0] !== null && cfgButtons[1] !== null
  && cfgFlat.indexOf('config/net_diagram.json') > 0 && cfgFlat.indexOf('Bus flags') > 0
  && cfgFlat.indexOf('Branch flow flags') > 0,
  cfgInputs.filter((i) => i === null).length + ' missing fields');
const cfgCheckbox = findInTree(cfgDialog, (n) => n.type === 'input' && n.props.type === 'checkbox'
  && String(n.props['aria-label'] || '') === 'Show the birdseye view');
check('the configuration switch renders as a checkbox, checked by default',
  cfgCheckbox !== null && cfgCheckbox.props.checked === true
  && flatTree(cfgDialog).indexOf('View') > 0,
  cfgCheckbox === null ? 'no checkbox' : String(cfgCheckbox.props.checked));
check('the config dialog starts at the configured values, and OK / Cancel are wired',
  cfgInputs[0] !== null && String(cfgInputs[0].props.value) === '1.1'
  && String(cfgInputs[2].props.value) === 'red'
  && (function () {
    try {
      cfgButtons[0].props.onClick();
      cfgButtons[1].props.onClick();
      return true;
    } catch (e) {
      return false;
    }
  })());

// 0.6.26: the flags summary. It counts each family that actually has data, quoting the thresholds
// the config set, and it is clickable so the gear is one click from what it is doing.
const flagsTab = renderFlat(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
  ['busAlerts', { bus5: true, bus9: true }],
  ['branchLoads', { 'bus1|bus2': 91.5 }],
  ['netConfig', api.drawioNetConfig({ Bus_flag_lower_limit: 0.95, Bus_flag_upper_limit: 1.05,
    Basecase_branch_flow_flag_percent: 80, Contingency_branch_flow_flag_percent: 100 })],
]));
check('the flags summary counts each family with its configured threshold',
  flagsTab.indexOf('flags: 2 buses 0.95') > 0 && flagsTab.indexOf('1 branch \u226580%') > 0
  && flagsTab.indexOf('contingency') < 0,
  flagsTab.slice(flagsTab.indexOf('flags:'), flagsTab.indexOf('flags:') + 70));
const noFlagsTab = renderFlat(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
]));
check('with nothing flagged there is no summary line at all',
  noFlagsTab.indexOf('flags:') < 0);

// 0.6.28: the birdseye. It rides on the canvas (which is now a positioning context) and carries the
// whole drawing as TWO paths plus the viewport frame -- not a second DrawioDiagram, which would
// double the DOM of a 10k-cell scene.
const birdseye = api.DrawioBirdseye({ scene: scene, rect: api.drawioFitRect(scene.viewBox),
  paths: api.drawioBirdseyePaths(scene), onCentre: () => {} });
const birdseyeRect = birdseye === null ? null : (birdseye.kids || []).filter((k) => k.type === 'rect')[0];
const birdseyePaths = birdseye === null ? [] : (birdseye.kids || []).filter((k) => k.type === 'path');
check('the canvas carries a birdseye with the whole scene and the visible rectangle',
  birdseye !== null && birdseyePaths.length === 2
  && birdseye.props.viewBox === scene.viewBox.x + ' ' + scene.viewBox.y + ' ' + scene.viewBox.w + ' ' + scene.viewBox.h
  && birdseyeRect !== undefined && birdseyeRect.props.width === scene.viewBox.w && birdseyeRect.props.height === scene.viewBox.h,
  birdseye === null ? 'no birdseye' : String(birdseye.props.viewBox));
// 0.6.36: two accents, deliberately apart. The search highlight turned green; the viewport frame
// kept the blue, because the frame answers "where am I looking", not "what did I find" -- so it
// must not follow the match colour when that colour changes again.
check('the viewport frame wears the frame colour, not the search highlight',
  birdseyeRect !== undefined && birdseyeRect.props.fill === api.DRAWIO_BIRDSEYE_FRAME
  && birdseyeRect.props.stroke === api.DRAWIO_BIRDSEYE_FRAME
  && api.DRAWIO_MATCH_FILL !== api.DRAWIO_BIRDSEYE_FRAME,
  (birdseyeRect === undefined ? 'no rect' : birdseyeRect.props.fill) + ' vs match ' + api.DRAWIO_MATCH_FILL);
check('the birdseye sits inside the canvas, which is a positioning context',
  String(birdseye.props.style.position) === 'absolute'
  && slice.indexOf("position: 'relative', height: '70vh'") >= 0
  // and the canvas renders it with the scene, the current window and the prebuilt paths
  && slice.indexOf('React.createElement(DrawioBirdseye, {') >= 0
  && slice.indexOf('paths: birdseyePaths') >= 0 && slice.indexOf('rect: currentRect()') >= 0,
  String(birdseye.props.style.position));
check('the birdseye is absent when there is no diagram, and its pointer events never pan the canvas',
  idle.indexOf('Birdseye view') < 0
  && slice.indexOf('onCentre: centreFromBirdseye') >= 0
  && slice.indexOf('setRect(drawioBirdseyeRect(scene, currentRect(), fx, fy))') >= 0
  && slice.indexOf('e.stopPropagation()') >= 0);
if (birdseye !== null) {
  const fake = {
    stopPropagation: () => {}, preventDefault: () => {}, pointerId: 1, clientX: 120, clientY: 90,
    currentTarget: { setPointerCapture: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 190, height: 150 }) },
  };
  check('clicking and dragging the birdseye is wired and does not throw',
    (function () {
      try {
        birdseye.props.onPointerDown(fake);
        birdseye.props.onPointerMove(fake);
        birdseye.props.onPointerUp(fake);
        return true;
      } catch (e) {
        return false;
      }
    })());
}

// 0.6.29: the switch. With the setting off the canvas carries no thumbnail at all.
const noBirdseye = renderFlat(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(2)],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['scene', scene],
  ['netConfig', api.drawioNetConfig({ Show_birdseye_view: false })],
]));
check('turning the birdseye off leaves the canvas without it',
  noBirdseye.indexOf('Birdseye view') < 0 && noBirdseye.indexOf('THREW') < 0);
check('the switch gates the overlay in the source, not by hiding it with css',
  slice.indexOf('netConfig.Show_birdseye_view !== false ? React.createElement(DrawioBirdseye, {') >= 0);

if (editButton !== null) {
  editButton.props.onClick();
  check('the edit button asks the Host to launch draw.io for the open diagram',
    editCalls.length === 1 && editCalls[0][0] === 'openDrawio'
    && editCalls[0][1].path === 'wspace/data/c/diagram/d0.drawio'
    && editCalls[0][1].sessionId === 'test-session', JSON.stringify(editCalls));
}
check('the edit button wears the draw.io mark, not a text label',
  JSON.stringify(editTree).indexOf('F08705') >= 0);
check('the tooltip element renders the hovered record', drawnFlat.indexOf('Voltage (pu): 1.0200') >= 0);
if (scene) {
  const dgmApi = build(drawn);
  let tree = null;
  try {
    tree = dgmApi.DiagramView({ sessionId: 'test-session', callRemote: () => Promise.resolve({}) });
    check('rendering an open diagram does not throw', tree !== null && tree !== undefined);
  } catch (e) {
    check('rendering an open diagram does not throw', false, e.constructor.name + ': ' + e.message);
  }
  const found = [];
  const walk = (n) => {
    if (n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const k of n) walk(k); return; }
    if (n.type === dgmApi.DrawioDiagram) found.push(n);
    if (n.kids) walk(n.kids);
  };
  walk(tree);
  check('the tab embeds DrawioDiagram with the live scene',
    found.length === 1 && found[0].props.scene === scene, found.length + ' instance(s)');
  check('the tab passes the pan/zoom view and the tooltip wiring to it',
    found.length === 1 && Object.prototype.hasOwnProperty.call(found[0].props, 'view')
    && found[0].props.hover !== null && typeof found[0].props.hover.onBus === 'function'
    && typeof found[0].props.hover.onBranch === 'function',
    found.length === 1 ? 'view=' + String(found[0].props.view) : '');
}
// 0.6.34: there is no Source view to reach any more. The same file must render, and the raw XML
// must not be dumped anywhere in the tab.
const noSourceTab = renderFlat(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(1)],
  ['filesLoading', false],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['xml', '<mxfile><diagram/></mxfile>'],
]));
check('the raw file is never shown: the tab always renders', 
  noSourceTab.indexOf('<mxfile><diagram/></mxfile>') < 0 && noSourceTab.indexOf('THREW') < 0,
  noSourceTab.slice(0, 60));
// The modal that used to live in InterPssView is gone, so `readDrawio` must have exactly
// one caller left. A second one would mean a preview surface grew back beside this tab.
check('the preview has exactly one entry point left, and it is this view',
  (slice.match(/callRemote\('readDrawio'/g) || []).length === 1
  && slice.indexOf('drawioDirectPath') < 0 && slice.indexOf('drawioModal') < 0);

// --- 13. the draw.io launcher (edit button) --------------------------------
console.log('\n13. the local draw.io launcher and its config');
// The edit button cannot be exercised end to end here — the real `subprocess` service only
// exists inside the harness Host — so this drives the SHARED helper out of the installed host
// file against a fake provider. It is the only executable check of what the button actually
// runs, and the argv is the part a person would notice: `open -a draw.io <file>`.
const spawnBlock = (() => {
  const src = rd(LIB_HOST);
  const a = src.indexOf('// --- Launch the local draw.io app');
  const b = src.indexOf('// --- end draw.io launcher');
  return a < 0 || b < 0 ? '' : src.slice(a, b);
})();
check('the launcher block is extractable from the persistent host', spawnBlock.length > 1000, spawnBlock.length + ' chars');
let launchApi = null;
try {
  launchApi = new Function(spawnBlock
    + '\nreturn { drawioLaunch: drawioLaunch, drawioLaunchersFor: drawioLaunchersFor,'
    + ' drawioLauncherList: drawioLauncherList, drawioPlatformMatches: drawioPlatformMatches,'
    + ' DEFAULT_DRAWIO_LAUNCHERS: DEFAULT_DRAWIO_LAUNCHERS };')();
} catch (e) {
  launchApi = null;
}
check('the launcher block evaluates on its own', launchApi !== null && typeof launchApi.drawioLaunch === 'function');

if (launchApi !== null) {
  const ABS = '/ws/wspace/data/ieee/Ieee14Bus/diagram/ieee14-oneline.drawio';
  const shape = (list) => list.map((e) => ({ platform: e.platform || '', exe: e.exe, args: e.args, label: e.label }));
  const entry = (list, n) => list.filter((e) => e.label === n)[0];

  // The shipped config and the built-in fallback are the same list: deleting the file changes
  // nothing, and editing the file is how a Windows/Linux install names its own draw.io.
  const envPath = join(ROOT, 'config', 'ipss_plugin_env.json');
  let envConfig = null;
  try {
    envConfig = JSON.parse(readFileSync(envPath, 'utf8'));
  } catch (e) {
    envConfig = null;
  }
  check('config/ipss_plugin_env.json exists and is valid JSON', envConfig !== null);
  const fromFile = envConfig === null ? null : launchApi.drawioLauncherList(envConfig);
  check('the shipped config lists at least one launcher per OS',
    fromFile !== null && fromFile.length >= 5
    && fromFile.some((e) => e.platform === 'darwin') && fromFile.some((e) => e.platform === 'win32')
    && fromFile.some((e) => e.platform === 'linux'),
    fromFile === null ? 'unusable' : fromFile.length + ' entries');
  check('the shipped config matches the built-in defaults exactly',
    fromFile !== null && JSON.stringify(shape(fromFile)) === JSON.stringify(shape(launchApi.DEFAULT_DRAWIO_LAUNCHERS)),
    fromFile === null ? 'n/a' : JSON.stringify(shape(fromFile).slice(0, 2)));
  // Each OS names a real draw.io entry, not just a file association.
  check('every OS points at the draw.io app itself before falling back to an association',
    fromFile !== null
    && entry(fromFile.filter((e) => e.platform === 'darwin'), 'open -a draw.io') !== undefined
    && entry(fromFile.filter((e) => e.platform === 'win32'), 'C:\\Program Files\\draw.io\\draw.io.exe') !== undefined
    && entry(fromFile.filter((e) => e.platform === 'linux'), 'drawio') !== undefined);

  // Platform tags order the list; an unknown platform keeps the file order so resolution decides.
  const ordered = (platform) => launchApi.drawioLaunchersFor(fromFile, platform);
  check('an entry for another OS is skipped, not spawned',
    ordered('darwin').every((e) => e.platform !== 'win32' && e.platform !== 'linux')
    && ordered('win32').every((e) => e.platform !== 'darwin' && e.platform !== 'linux')
    && ordered('linux').every((e) => e.platform !== 'darwin' && e.platform !== 'win32'));
  check("this machine's entries come first, the untagged associations last",
    ordered('darwin')[0].label === 'open -a draw.io'
    && ordered('win32')[0].label.indexOf('draw.io.exe') >= 0
    && ordered('linux')[0].label === 'drawio'
    && ordered('darwin').slice(-1)[0].platform === '');
  check('an unknown platform keeps every launcher in file order',
    JSON.stringify(shape(ordered(''))) === JSON.stringify(shape(fromFile)));
  check('the hand-written OS spellings are accepted',
    launchApi.drawioPlatformMatches('macos', 'darwin') && launchApi.drawioPlatformMatches('windows', 'win32')
    && launchApi.drawioPlatformMatches('posix', 'linux') && launchApi.drawioPlatformMatches('posix', 'darwin')
    && !launchApi.drawioPlatformMatches('posix', 'win32')
    && launchApi.drawioPlatformMatches('', 'linux'));

  // A broken config must fall back to the defaults — and say so — not disable the button.
  check('a config without a usable launcher list falls back to the defaults',
    launchApi.drawioLauncherList({}) === null && launchApi.drawioLauncherList({ drawio: {} }) === null
    && launchApi.drawioLauncherList({ drawio: { launchers: [] } }) === null
    && launchApi.drawioLauncherList({ drawio: { launchers: [{ exe: '' }, null, 'x'] } }) === null
    && launchApi.drawioLauncherList({ other: 1 }) === null);
  check('an entry keeps only its string args and gets a label',
    JSON.stringify(launchApi.drawioLauncherList({ drawio: { launchers: [{ exe: ' /usr/bin/drawio ', args: ['--edit', 7, null] }] } }))
      === JSON.stringify([{ platform: '', exe: '/usr/bin/drawio', args: ['--edit'], label: '/usr/bin/drawio' }]));

  // ...and the launch loop itself: resolve, spawn, step down on failure.
  const fakeSubprocess = (options) => {
    const o = options || {};
    const spawned = [];
    return {
      spawned,
      async resolveExecutable(command) {
        if ((o.available || []).indexOf(command) < 0) throw new Error('not found: ' + command);
        return '/resolved/' + command;
      },
      spawn(spec) {
        spawned.push(spec.argv);
        const rung = spec.argv.slice(1).join(' ');
        const code = Object.prototype.hasOwnProperty.call(o.exits || {}, rung) ? o.exits[rung] : 0;
        return {
          collected: { stderr: { readFrom: () => ({ text: code === 0 ? '' : 'boom from ' + rung }) } },
          done: Promise.resolve({ exitCode: code, signal: null }),
        };
      },
    };
  };

  const macRungs = ordered('darwin');
  const appRung = fakeSubprocess({ available: ['open'] });
  const launched = await launchApi.drawioLaunch(appRung, macRungs, ABS, '/ws', undefined);
  check('the draw.io app is the first rung on macOS and the argv is open -a draw.io <file>',
    launched.ok === true && launched.launcher === 'open -a draw.io'
    && JSON.stringify(appRung.spawned) === JSON.stringify([['/resolved/open', '-a', 'draw.io', ABS]]),
    JSON.stringify(appRung.spawned));

  const fallback = fakeSubprocess({ available: ['open'], exits: { ['-a draw.io ' + ABS]: 1 } });
  const second = await launchApi.drawioLaunch(fallback, macRungs, ABS, '/ws', undefined);
  check('a failing app rung falls through to the app binary and then the association',
    second.ok === true && fallback.spawned.length === 2 && fallback.spawned[1][0] === '/resolved/open',
    JSON.stringify(second));

  const linuxRungs = ordered('linux');
  const linux = fakeSubprocess({ available: ['xdg-open'] });
  const lin = await launchApi.drawioLaunch(linux, linuxRungs, ABS, '/ws', undefined);
  check('a Linux host with only xdg-open spawns nothing it cannot resolve',
    lin.ok === true && lin.launcher === 'xdg-open' && linux.spawned.length === 1
    && linux.spawned[0][0] === '/resolved/xdg-open', JSON.stringify(linux.spawned));

  const nothing = fakeSubprocess({ available: [] });
  const none = await launchApi.drawioLaunch(nothing, macRungs, ABS, '/ws', undefined);
  check('with no launcher installed the error names every rung and starts no process',
    none.ok === false && none.error.indexOf('open -a draw.io') >= 0 && none.error.indexOf('xdg-open') >= 0
    && nothing.spawned.length === 0, none.error);

  const allFail = fakeSubprocess({ available: ['open'], exits: { ['-a draw.io ' + ABS]: 1, [ABS]: 1 } });
  const failed = await launchApi.drawioLaunch(allFail, macRungs, ABS, '/ws', undefined);
  check('every rung failing quotes each launcher and its stderr',
    failed.ok === false && failed.error.indexOf('boom from') >= 0);

  const winRungs = ordered('win32');
  const windows = fakeSubprocess({ available: ['cmd.exe'] });
  const win = await launchApi.drawioLaunch(windows, winRungs, ABS, 'C:\\ws', undefined);
  check('windows falls to cmd /c start "" <file> when draw.io.exe is not at the default path',
    win.ok === true && win.launcher === 'cmd /c start'
    && JSON.stringify(windows.spawned) === JSON.stringify([['/resolved/cmd.exe', '/c', 'start', '', ABS]]),
    JSON.stringify(windows.spawned));

  // The endpoint must actually read the file, in both halves.
  check('both hosts read the config file for their launchers',
    rd(LIB_HOST).indexOf('readDrawioLaunchers') >= 0 && rd(DYN_HOST).indexOf('readDrawioLaunchers') >= 0
    && rd(LIB_HOST).indexOf("'/config/ipss_plugin_env.json'") >= 0
    && rd(DYN_HOST).indexOf("'/config/ipss_plugin_env.json'") >= 0);
}


// --- 14. render-time voltage annotation ------------------------------------
console.log('\n14. render-time voltage annotation (red buses outside [0.9, 1.1] pu)');
// The rule itself: strictly outside the band, and a value that is not a finite number (a blank
// VoltMag, a placeholder) is simply not annotated rather than flagged.
check('the band is exclusive at both ends',
  api.drawioVoltOutsideBand(0.9, [0.9, 1.1]) === false && api.drawioVoltOutsideBand(1.1, [0.9, 1.1]) === false
  && api.drawioVoltOutsideBand(0.8999, [0.9, 1.1]) === true && api.drawioVoltOutsideBand(1.1001, [0.9, 1.1]) === true);
check('a blank, missing or non-numeric voltage is never annotated',
  api.drawioVoltOutsideBand('', [0.9, 1.1]) === false && api.drawioVoltOutsideBand('-', [0.9, 1.1]) === false
  && api.drawioVoltOutsideBand(undefined, [0.9, 1.1]) === false && api.drawioVoltOutsideBand('n/a', [0.9, 1.1]) === false
  && api.drawioVoltOutsideBand(NaN, [0.9, 1.1]) === false && api.drawioVoltOutsideBand(0.5, null) === true);
check('the band defaults to 0.9-1.1 when none is given',
  api.drawioVoltOutsideBand(0.95, undefined) === false && api.drawioVoltOutsideBand(0.8, undefined) === true);

// The table reader. drawioBusAlerts gets raw CSV lines from readCsv, so the columns MUST come from
// the file's own header: VoltAng and NomVolt sit beside VoltMag, and a positional read would
// silently paint the wrong buses.
const BUS_HEADER = 'ID,Number,Name,AreaName,NomVolt,VoltAng,VoltMag,LoadP';
const BUS_ROWS = [
  'Bus1,1,A,1,100000.0,0.100,1.047360469272905,0.0',
  'Bus2,2,B,1,100000.0,0.200,0.871400000000000,0.0',
  'Bus3,3,C,1,100000.0,0.300,1.120000000000000,0.0',
  'Bus4,4,D,1,100000.0,0.400,,0.0',
  'Bus5,5,E,1,100000.0,0.500,n/a,0.0',
];
check('only the out-of-band buses are flagged',
  JSON.stringify(api.drawioBusAlerts(BUS_HEADER, BUS_ROWS, null, [0.9, 1.1])) === JSON.stringify({ bus2: true, bus3: true }),
  JSON.stringify(api.drawioBusAlerts(BUS_HEADER, BUS_ROWS, null, [0.9, 1.1])));
check('the columns are read by header name, not by position',
  JSON.stringify(api.drawioBusAlerts('VoltMag,ID,Name', ['0.8714,Bus2,B', '1.02,Bus9,X'], null, [0.9, 1.1]))
    === JSON.stringify({ bus2: true }),
  JSON.stringify(api.drawioBusAlerts('VoltMag,ID,Name', ['0.8714,Bus2,B', '1.02,Bus9,X'], null, [0.9, 1.1])));
check('a scene-limited read answers only for the buses it draws',
  JSON.stringify(api.drawioBusAlerts(BUS_HEADER, BUS_ROWS, { bus3: true }, [0.9, 1.1])) === JSON.stringify({ bus3: true }));
check('a header without ID or VoltMag yields nothing rather than a wrong guess',
  JSON.stringify(api.drawioBusAlerts('ID,Name', BUS_ROWS, null, [0.9, 1.1])) === '{}'
  && JSON.stringify(api.drawioBusAlerts('', BUS_ROWS, null, [0.9, 1.1])) === '{}'
  && JSON.stringify(api.drawioBusAlerts(BUS_HEADER, null, null, [0.9, 1.1])) === '{}');
check('ids are lowercased so they match the diagram cells',
  JSON.stringify(api.drawioBusAlerts('ID,VoltMag', ['BUS2,0.87'], null, [0.9, 1.1])) === JSON.stringify({ bus2: true }));

// The painting. The bar and its label go red; the label's paper box must stay white (it masks the
// wires under the text), an in-band bus is untouched, and red passes the theme mapping through.
if (scene) {
  // Both cells of a flagged bus carry the colour -- the bar and its label -- because the tab's
  // drawioFlagPaint keys the map by cell id (a label cell is `nm5`, not `bus5`).
  const alertScene = api.DrawioDiagram({ scene: scene, paint: { bus5: 'red', nm5: 'red' } });
  const byKey = {};
  for (const g of groupsOf(alertScene)) byKey[g.props.key] = partsOf(g);
  const shapeOf = (key) => (byKey[key] || []).filter((part) => part.props.key === 's')[0];
  const iBar = scene.nodes.findIndex((n) => n.id === 'bus5');
  const iLabel = scene.nodes.findIndex((n) => (n.lines || []).join('') === 'Bus-5' && n.id !== 'bus5');
  const bar = shapeOf('n' + iBar);
  const labelParts = byKey['n' + iLabel] || [];
  const labelText = labelParts.filter((part) => part.type === 'text')[0];
  const labelBox = labelParts.filter((part) => part.type === 'rect')[0];
  check('a flagged bar is painted in the configured colour',
    bar !== undefined && bar.props.fill === 'red' && bar.props.stroke === 'red',
    bar === undefined ? 'no bar' : bar.props.fill + ' / ' + bar.props.stroke);
  check('its Bus-N label text takes the colour too', labelText !== undefined && labelText.props.fill === 'red',
    labelText === undefined ? 'no label' : String(labelText.props.fill));
  // The label's mask must stay white while the glyphs take the flag: it is what keeps the wires out
  // of the text. Two shapes carry it — a `rect` cell with `fillColor` (the regenerated format) and a
  // `text` cell with `labelBackgroundColor` (the hand-laid files, since 0.6.33) — and the mask is
  // always painted before the text.
  const labelNode = scene.nodes[iLabel];
  check('the label keeps its white mask, painted before the text, whatever the file uses',
    labelText !== undefined && labelText.props.fill === 'red'
    && labelBox !== undefined && labelBox.props.fill === 'var(--dsw-alias-bg-layer-1)'
    && labelParts.indexOf(labelBox) < labelParts.indexOf(labelText),
    labelNode === undefined ? 'no node' : labelNode.kind + ' / ' + (labelBox === undefined ? 'no box' : String(labelBox.props.fill)));
  const boxed = api.parseDrawioScene('<mxfile><diagram><mxGraphModel><root>'
    + '<mxCell id="bus7" value="" vertex="1" parent="1" style="rounded=0;fillColor=#666666;strokeColor=#333333;">'
    + '<mxGeometry x="0" y="40" width="6" height="52" as="geometry"/></mxCell>'
    + '<mxCell id="nm7" value="Bus-7" vertex="1" parent="1" style="rounded=0;fillColor=#FFFFFF;strokeColor=none;fontColor=#000000;fontSize=11;">'
    + '<mxGeometry x="0" y="20" width="52" height="14" as="geometry"/></mxCell>'
    + '</root></mxGraphModel></diagram></mxfile>');
  const boxedSvg = api.DrawioDiagram({ scene: boxed, paint: { bus7: 'red', nm7: 'red' } });
  const boxedByKey = {};
  for (const g of groupsOf(boxedSvg)) boxedByKey[g.props.key] = partsOf(g);
  const boxedBar = (boxedByKey['n0'] || []).filter((part) => part.type === 'rect')[0];
  const boxedParts = boxedByKey['n1'] || [];
  const boxedBox = boxedParts.filter((part) => part.type === 'rect')[0];
  const boxedText = boxedParts.filter((part) => part.type === 'text')[0];
  check('a generated-format label keeps its white box and colours only the text',
    boxedBar !== undefined && boxedBar.props.fill === 'red'
    // and `rounded=0` is a VALUE: this bar is square, not a pill (0.6.33)
    && boxedBar.props.rx === 0
    && boxedBox !== undefined && boxedBox.props.fill === 'var(--dsw-alias-bg-layer-1)'
    && boxedText !== undefined && boxedText.props.fill === 'red',
    (boxedBox === undefined ? 'no box' : String(boxedBox.props.fill)) + ' / ' + (boxedText === undefined ? 'no text' : String(boxedText.props.fill)));
  const iQuiet = scene.nodes.findIndex((n) => n.id === 'bus1');
  const quiet = shapeOf('n' + iQuiet);
  check('an in-band bar keeps the theme tokens',
    quiet !== undefined && quiet.props.fill === 'var(--dsw-alias-label-secondary)'
    && quiet.props.stroke === 'var(--dsw-alias-label-secondary)',
    quiet === undefined ? 'no bar' : String(quiet.props.fill));
  check('the alert red survives the theme mapping in both themes',
    api.drawioThemeColor('#CC0000') === '#CC0000' && api.drawioThemeColor('#7F0000') === '#7F0000');
  check('with no alert the painting is byte-identical to before',
    JSON.stringify(api.DrawioDiagram({ scene: scene })) === JSON.stringify(api.DrawioDiagram({ scene: scene, alert: null })));

  // The constraint behind this whole design: the annotation is paint-time only. Nothing above may
  // have written to the scene, and no file write exists anywhere in the client path.
  const authored = JSON.stringify(scene);
  api.DrawioDiagram({ scene: scene, paint: { bus5: 'red', nm5: 'red', bus1: 'red', nm1: 'red' } });
  check('the parsed scene keeps its authored colours after an alerted render',
    JSON.stringify(scene) === authored
    && scene.nodes.filter((n) => n.id === 'bus5')[0].fill === '#666666',
    scene.nodes.filter((n) => n.id === 'bus5')[0].fill);
}
check('the diagram path has no write RPC — the .drawio is only ever read',
  (slice.match(/callRemote\('(?:writeText|writeFile|saveDrawio|writeDrawio|saveFile)'/g) || []).length === 0
  && slice.indexOf("callRemote('readDrawio'") >= 0);
check('the tab wires the flags into the renderer from the result tables',
  slice.indexOf('paint: paintMap') >= 0 && slice.indexOf('drawioFlagPaint(') >= 0
  && slice.indexOf('drawioBusAlerts(') >= 0 && slice.indexOf('_DF_bus.csv') >= 0
  && slice.indexOf("'loading%'") >= 0 && slice.indexOf("'loadingpercent'") >= 0);

// --- 15. size limits --------------------------------------------------------
console.log('\n15. size limits (20000 cells, 4 MiB)');
// Raising ONE limit would leave the others blocking the same file, so the three move together: the
// preview's cell cap (client), the Host's read cap (both halves) and the generator's own self-check.
// A 2000-bus case — Texas 2K, ~10.7k cells and ~3 MB — has to fit all three.
const GENERATOR = join(ROOT, 'wspace', 'script', 'gen_oneline_diagram.py');
const generatorSrc = readFileSync(GENERATOR, 'utf8');
check('the preview cap is 20000 cells', api.DRAWIO_MAX_CELLS === 20000, String(api.DRAWIO_MAX_CELLS));
check('both hosts read up to 4 MiB of diagram',
  rd(LIB_HOST).indexOf('MAX_DRAWIO_BYTES = 4 * 1024 * 1024') >= 0
  && rd(DYN_HOST).indexOf('MAX_DRAWIO_BYTES = 4 * 1024 * 1024') >= 0
  && rd(LIB_HOST).indexOf('MAX_DRAWIO_BYTES = 2 * 1024 * 1024') < 0);
check('the generator self-check allows 20000 cells',
  generatorSrc.indexOf('len(cells) > 20000') >= 0 && generatorSrc.indexOf('more than 2000 cells') < 0);

// The boundary, both sides. The cells are geometry-less on purpose: the cap is counted before any
// geometry is resolved, so this stays a ~0.5 MB string instead of a 20k-shape model. At the cap the
// parse gets PAST the size check and then fails for being empty — which is the proof it passed; one
// cell over, the size check is what fires.
const manyCells = (n) => '<mxfile><diagram><mxGraphModel><root>'
  + Array.from({ length: n }, (_, i) => '<mxCell id="c' + i + '"/>').join('')
  + '</root></mxGraphModel></diagram></mxfile>';
const capError = (n) => {
  try {
    api.parseDrawioScene(manyCells(n));
    return '';
  } catch (e) {
    return String(e && e.message ? e.message : e);
  }
};
const atCap = capError(20000);
check('a scene of exactly 20000 cells is not rejected for its size', atCap.indexOf('cells (limit') < 0, atCap);
check('one cell over the cap is rejected and the message quotes the new limit',
  capError(20001).indexOf('20001 cells (limit 20000)') >= 0, capError(20001));

// --- 16. diagram search and filter ------------------------------------------
console.log('\n16. diagram search and filter (0.6.23)');
// Search resolves a query to cells; filter resolves criteria to cells to hide. Both are pure, and
// both lean on one hard part: an edge through a transformer is TWO stubs (bus -> ring), so the bus
// pair has to come from the group's sibling ring. Every edge must resolve, or those branches could
// never be searched or filtered.
const ringIndex = api.drawioRingIndex(scene.nodes);
const resolvedPairs = scene.edges.map((e) => api.drawioEdgeBusPair(e, scene.edges, ringIndex));
check('every edge resolves to a bus pair, transformer stubs included',
  resolvedPairs.every((p) => p !== null),
  resolvedPairs.filter((p) => p === null).length + ' of ' + scene.edges.length + ' unresolved');
check('a transformer branch resolves to the SAME pair as its two stubs',
  (function () {
    const stubs = scene.edges.filter((e) => ringIndex.groupOf[e.source] !== undefined || ringIndex.groupOf[e.target] !== undefined);
    if (stubs.length === 0) return true;
    for (let i = 0; i < stubs.length; i += 2) {
      const a = api.drawioEdgeBusPair(stubs[i], scene.edges, ringIndex);
      const b = api.drawioEdgeBusPair(stubs[i + 1], scene.edges, ringIndex);
      if (a === null || b === null) return false;
      if (a.slice().sort().join('|') !== b.slice().sort().join('|')) return false;
    }
    return true;
  })());

const hit = (q, names) => api.drawioSearchHits(q, scene.nodes, scene.edges, names === undefined ? null : names);
check('a bus number highlights that bus bar AND its label',
  hit('5').nBus === 1 && hit('5').buses.bus5 === true && hit('5').buses.nm5 === true, JSON.stringify(hit('5').buses));
check('a bus id highlights the same bus, and Bus-14 reaches the last one',
  hit('Bus-5').buses.bus5 === true && hit('Bus-14').buses.bus14 === true && hit('14').buses.bus14 === true);
check('a name from the bus table matches, case-insensitively',
  hit('odessa', { bus5: 'ODESSA 2 0' }).buses.bus5 === true && hit('ODESSA', { bus5: 'ODESSA 2 0' }).nBus === 1);
check('a pair highlights the two buses and the branches between them',
  hit('1-2').buses.bus1 === true && hit('1-2').buses.bus2 === true && hit('1-2').nBranch >= 1,
  hit('1-2').text);
// 0.6.25: `->` is how a branch is written now. The dash, the slash and the unicode arrow still mean
// the same thing, and all four must resolve to the same two buses.
check('a branch written with an arrow is the documented form',
  hit('1->2').nBranch >= 1 && hit('1->2').text.indexOf('branch') >= 0, hit('1->2').text);
check('the arrow spellings are equivalent, and a branch says which one it found',
  ['1->2', '1-2', '1/2', '1\u21922', '1 -> 2'].every((q) => hit(q).nBranch >= 1
    && hit(q).buses.bus1 === true && hit(q).buses.bus2 === true),
  ['1->2', '1-2', '1/2', '1\u21922'].map((q) => q + ':' + hit(q).nBranch).join(' '));
check('a pair with no branch says so instead of highlighting nothing',
  hit('1-99').nBus === 0 && hit('1-99').text.indexOf('99') >= 0
  && hit('Bus-1 -> Bus-99').nBus === 0
  && hit('Bus-1 -> Bus-99').text.indexOf('No branch between Bus-1 and Bus-99') >= 0,
  hit('1-99').text + ' | ' + hit('Bus-1 -> Bus-99').text);
// 0.6.35: a branch may name its ends the way the drawing does -- `Bus-1 -> Bus-2`. The `bus`
// prefix, its hyphen and any spacing are optional on either end, so every one of these is the
// same pair, and the reply names the buses as ids whichever spelling was typed.
const idPairForms = ['Bus-1 -> Bus-2', 'Bus-1->Bus-2', 'bus-1 -> bus-2', 'Bus1->Bus2', 'bus 1 -> bus 2',
  'Bus-1 - Bus-2', 'Bus-1/2', 'Bus-1\u21922', '1 -> Bus-2', 'Bus-1 -> 2'];
check('a branch may be written with bus ids, in any case or spacing, on either end',
  idPairForms.every((q) => hit(q).nBranch >= 1 && hit(q).buses.bus1 === true && hit(q).buses.bus2 === true),
  idPairForms.map((q) => q + ':' + hit(q).nBranch).join(' '));
check('an id pair strips the ids down to the same buses, and answers in the drawing\'s spelling',
  hit('Bus-1 -> Bus-2').nBranch === hit('1->2').nBranch
  && hit('Bus-1 -> Bus-2').text === hit('1->2').text
  && hit('Bus-1 -> Bus-2').text.indexOf('between Bus-1 and Bus-2.') > 0,
  hit('1->2').text + ' | ' + hit('Bus-1 -> Bus-2').text);
check('an unknown query says nothing matches, and an empty one asks for input',
  hit('9999').nBus === 0 && hit('9999').text.indexOf('Nothing matches') >= 0 && hit('').text.indexOf('Type a bus number') >= 0);
check('a bus number that is also a name substring is still one hit per bus',
  hit('1', { bus1: 'X', bus10: 'Y' }).nBus === 1, 'a bare number is a number, not a substring');

// Filtering: keep what matches, hide the rest, and never leave a branch dangling into a hidden bus.
const meta = api.drawioBusMeta('ID,Name,AreaNum,AreaName,ZoneNum,ZoneName',
  ['Bus1,A,1,NORTH,9,FAR WEST TEX', 'Bus2,B,1,NORTH,8,TYLER', 'Bus3,C,2,SOUTH,7,AGGIE'], null);
check('the bus table folds into area/zone lists and per-bus lookups',
  JSON.stringify(meta.areas) === JSON.stringify([{ num: '1', name: 'NORTH' }, { num: '2', name: 'SOUTH' }])
  && JSON.stringify(meta.zones.map((z) => z.num)) === JSON.stringify(['7', '8', '9'])
  && meta.ofBus.bus1.area === '1' && meta.ofBus.bus1.zone === '9' && meta.ofBus.bus3.area === '2',
  JSON.stringify(meta.areas) + ' / ' + JSON.stringify(meta.zones));
check('merging pages keeps the lists and the per-bus lookups',
  (function () {
    const first = api.drawioBusMeta('ID,Name,AreaNum,ZoneNum', ['Bus1,A,1,9'], null);
    const both = api.drawioBusMeta('ID,Name,AreaNum,ZoneNum', ['Bus2,B,2,7'], first);
    return both.areas.length === 2 && both.ofBus.bus1 !== undefined && both.ofBus.bus2 !== undefined;
  })());
check('the band is spelled from the config, in one place',
  api.drawioBandText(null) === '|V| outside 0.9\u20131.1 pu'
  && api.drawioBandText(api.drawioNetConfig({ Bus_flag_lower_limit: 0.95, Bus_flag_upper_limit: 1.05 })) === '|V| outside 0.95\u20131.05 pu'
  && api.drawioBandText('nonsense') === '|V| outside 0.9\u20131.1 pu',
  api.drawioBandText(null));
check('the filter\'s own label and count quote the configured band',
  (function () {
    const cfg = api.drawioNetConfig({ Bus_flag_lower_limit: 0.95, Bus_flag_upper_limit: 1.05 });
    const h = api.drawioFilterHidden({ area: '', zone: '', outOfBand: true }, scene.nodes, scene.edges, meta, null, cfg);
    return h.label === '|V| outside 0.95\u20131.05 pu' && h.text.indexOf('0.95\u20131.05 pu') > 0;
  })());
check('a filter with no criteria hides nothing',
  Object.keys(api.drawioFilterHidden(null, scene.nodes, scene.edges, meta, null).ids).length === 0
  && Object.keys(api.drawioFilterHidden({ area: '', zone: '', outOfBand: false }, scene.nodes, scene.edges, meta, null).ids).length === 0);
check('filtering by area hides the buses outside it, with their labels',
  (function () {
    const h = api.drawioFilterHidden({ area: '1', zone: '', outOfBand: false }, scene.nodes, scene.edges, meta, null);
    return h.ids.bus1 !== true && h.ids.nm1 !== true && h.nBuses > 0;
  })());
check('the band filter keeps exactly the buses the voltage alert flagged',
  (function () {
    const alerts = { bus1: true };
    const h = api.drawioFilterHidden({ area: '', zone: '', outOfBand: true }, scene.nodes, scene.edges, meta, alerts);
    return h.ids.bus1 !== true && h.ids.nm1 !== true && h.ids.bus2 === true;
  })());
check('a branch with a hidden end is hidden, and a visible-visible branch is not',
  (function () {
    const alerts = { bus1: true, bus2: true };
    const h = api.drawioFilterHidden({ area: '', zone: '', outOfBand: true }, scene.nodes, scene.edges, meta, alerts);
    const pairs = scene.edges.map((e) => api.drawioEdgeBusPair(e, scene.edges, ringIndex));
    return pairs.every((p, i) => {
      if (p === null) return true;
      const bothKept = alerts[p[0]] === true && alerts[p[1]] === true;
      return bothKept ? h.ids[scene.edges[i].id] !== true : h.ids[scene.edges[i].id] === true;
    });
  })());
check('a hidden transformer stub hides its rings and their group too',
  (function () {
    const h = api.drawioFilterHidden({ area: '', zone: '', outOfBand: true }, scene.nodes, scene.edges, meta, { bus1: true });
    for (const e of scene.edges) {
      if (h.ids[e.id] !== true) continue;
      const ring = api.drawioIsBusCell(e.source) ? e.target : e.source;
      const group = ringIndex.groupOf[ring];
      if (group !== undefined && h.ids[group] !== true) return false;
    }
    return true;
  })());
// The search dialog's help is about the case in front of it (0.6.25): its own bus count and range,
// a branch example from its own buses (ids since 0.6.35), and a name from its own table -- or a
// plain statement that there is no table to get names from.
const helpWithNames = api.drawioSearchHelp(scene, { ofBus: { bus1: { name: 'ODESSA 2 0' }, bus2: { name: 'PRESIDIO' } } });
check('the search help names this case\'s bus count, range and branch example',
  helpWithNames.hint.indexOf('14 buses here (Bus-1 to Bus-14)') === 0
  && helpWithNames.hint.indexOf('1->2 or Bus-1 -> Bus-2 the branches between two') > 0
  && helpWithNames.hint.indexOf('"ODESSA"') > 0
  && helpWithNames.placeholder === '1, Bus-1, ODESSA, Bus-1 -> Bus-2',
  helpWithNames.placeholder + ' | ' + helpWithNames.hint);
const helpNoNames = api.drawioSearchHelp(scene, null);
check('without a bus table the help says names cannot be searched',
  helpNoNames.hint.indexOf('need this case\u2019s ACLF result table') > 0
  && helpNoNames.placeholder.indexOf('Bus-1') > 0 && helpNoNames.placeholder.indexOf('Bus-1 -> Bus-2') > 0,
  helpNoNames.placeholder + ' | ' + helpNoNames.hint);
check('the search help survives having no scene at all',
  api.drawioSearchHelp(null, null).hint.indexOf('1001->1002 or Bus-1001 -> Bus-1002') > 0
  && api.drawioSearchHelp({ nodes: [] }, null).placeholder === '1001, Bus-1001, Bus-1001 -> Bus-1002',
  JSON.stringify([api.drawioSearchHelp(null, null), api.drawioSearchHelp({ nodes: [] }, null)]));

// The paint path itself: `hidden` must remove a cell from the tree entirely (not merely recolour
// it) and `match` must be the search colour, for a bus bar, its label text and a branch.
const radiusIndex = scene.nodes.findIndex((n) => n.id === 'bus5');
const hiddenSvg = api.DrawioDiagram({ scene: scene, hidden: { bus5: true, nm5: true } });
const hiddenKeys = groupsOf(hiddenSvg).map((g) => String(g.props.key));
check('a hidden cell is not painted at all',
  hiddenKeys.indexOf('n' + scene.nodes.findIndex((n) => n.id === 'nm5')) < 0
  && hiddenKeys.indexOf('n' + radiusIndex) < 0
  && groupsOf(hiddenSvg).length === groupsOf(api.DrawioDiagram({ scene: scene })).length - 2,
  hiddenKeys.length + ' groups painted');
const matchSvg = api.DrawioDiagram({ scene: scene, paint: { bus5: '#1F6FEB', nm5: '#1F6FEB' } });
const matchByKey = {};
for (const g of groupsOf(matchSvg)) matchByKey[g.props.key] = partsOf(g);
const matchBar = (matchByKey['n' + radiusIndex] || []).filter((part) => part.type === 'rect')[0];
const matchLabel = (matchByKey['n' + scene.nodes.findIndex((n) => n.id === 'nm5')] || []).filter((part) => part.type === 'text')[0];
check('a matched bar and its label take the search colour',
  matchBar !== undefined && matchBar.props.fill === '#1F6FEB' && matchBar.props.stroke === '#1F6FEB'
  && matchLabel !== undefined && matchLabel.props.fill === '#1F6FEB',
  (matchBar === undefined ? 'no bar' : matchBar.props.fill) + ' / ' + (matchLabel === undefined ? 'no label' : matchLabel.props.fill));
check('a matched branch is thicker and in the search colour',
  (function () {
    const e = scene.edges[0];
    const svg = api.DrawioDiagram({ scene: scene, paint: { [e.id]: '#1F6FEB' } });
    const g = groupsOf(svg).filter((x) => String(x.props.key) === 'e0')[0];
    const line = g === undefined ? undefined : partsOf(g).filter((part) => part.props.key === 'l')[0];
    return line !== undefined && line.props.stroke === '#1F6FEB'
      && line.props.strokeWidth > (scene.edges[0].strokeWidth || 1);
  })());
// 0.6.36: the highlight is green, not the accent blue it shipped with -- a bus or branch that was
// *found* should not read as a link. `green` itself would be too dark on the dark canvas, so the
// mid-luminance `#2EA043` it is, and it stays distinct from the config's own flag colours (the
// base-case flag's default is plain `green`, which a search must outrank rather than match).
check('the search highlight is the mid-luminance green, not a flag colour',
  api.DRAWIO_MATCH_FILL === '#2EA043' && api.DRAWIO_MATCH_FILL !== 'green'
  && api.DRAWIO_MATCH_FILL !== api.DRAWIO_BIRDSEYE_FRAME,
  api.DRAWIO_MATCH_FILL + ' (frame ' + api.DRAWIO_BIRDSEYE_FRAME + ')');

check('the sentence names the area and zone, the toolbar label stays numeric',
  (function () {
    const h = api.drawioFilterHidden({ area: '1', zone: '9', outOfBand: false }, scene.nodes, scene.edges, meta, null);
    return h.text.indexOf('area 1 NORTH') >= 0 && h.text.indexOf('zone 9 FAR WEST TEX') >= 0
      && h.label === 'area 1, zone 9' && h.kept === h.total - h.nBuses;
  })());
// 0.6.32: the two flow criteria. They choose BRANCHES, so they also narrow the buses to the ends of
// what survives -- otherwise "only branches >= 70%" would still draw every bus.
const flowScene = {
  viewBox: { x: 0, y: 0, w: 400, h: 200 },
  nodes: [
    { id: 'bus1', kind: 'rect', x: 0, y: 0, w: 6, h: 40, lines: [] },
    { id: 'bus2', kind: 'rect', x: 100, y: 0, w: 6, h: 40, lines: [] },
    { id: 'bus3', kind: 'rect', x: 200, y: 0, w: 6, h: 40, lines: [] },
    { id: 'bus4', kind: 'rect', x: 300, y: 0, w: 6, h: 40, lines: [] },
  ],
  edges: [
    { id: 'e1', source: 'bus1', target: 'bus2', points: [{ x: 3, y: 20 }, { x: 103, y: 20 }], stroke: '#000', strokeWidth: 1, arrow: null },
    { id: 'e2', source: 'bus2', target: 'bus3', points: [{ x: 103, y: 20 }, { x: 203, y: 20 }], stroke: '#000', strokeWidth: 1, arrow: null },
    { id: 'e3', source: 'bus3', target: 'bus4', points: [{ x: 203, y: 20 }, { x: 303, y: 20 }], stroke: '#000', strokeWidth: 1, arrow: null },
  ],
};
const flowCfg = api.drawioNetConfig({ Basecase_branch_flow_flag_percent: 70, Contingency_branch_flow_flag_percent: 100 });
const flowLoads = { 'bus1|bus2': 91.5, 'bus2|bus3': 45, 'bus3|bus4': 120 };
const flowCons = { 'bus3|bus4': 118 };
const flowMeta = { ofBus: { bus1: { area: '1', zone: '9' }, bus2: { area: '9', zone: '9' },
  bus3: { area: '9', zone: '9' }, bus4: { area: '1', zone: '9' } }, areas: [], zones: [] };
const onlyBase = api.drawioFilterHidden({ area: '', zone: '', outOfBand: false, basecaseLoading: true },
  flowScene.nodes, flowScene.edges, null, null, flowCfg, flowLoads, flowCons);
check('a base-case loading filter keeps the branches at or above it, and their buses',
  // e2 is the only branch below 70%, so it goes; every bus is an end of a branch that stays
  onlyBase.ids.e1 !== true && onlyBase.ids.e2 === true && onlyBase.ids.e3 !== true
  && JSON.stringify(Object.keys(onlyBase.ids)) === '["e2"]',
  JSON.stringify(Object.keys(onlyBase.ids)));
check('it reports in branches, because that is what it chose',
  onlyBase.keptBranches === 2 && onlyBase.totalBranches === 3
  && onlyBase.text === 'Showing 2 of 3 branches (base-case loading \u2265 70%).'
  && onlyBase.label === 'base-case loading \u2265 70%',
  onlyBase.text);
check('the contingency criterion uses the contingency table and its own threshold',
  (function () {
    const h = api.drawioFilterHidden({ area: '', zone: '', outOfBand: false, contingencyLoading: true },
      flowScene.nodes, flowScene.edges, null, null, flowCfg, flowLoads, flowCons);
    // the two buses with no branch that stays are hidden too, and the sentence says so
    return h.ids.e3 !== true && h.ids.e1 === true && h.ids.e2 === true
      && h.ids.bus1 === true && h.ids.bus2 === true && h.ids.bus3 !== true && h.ids.bus4 !== true
      && h.text === 'Showing 2 of 4 buses and 1 of 3 branches (contingency loading \u2265 100%).';
  })());
check('both flow criteria together are an AND, and a bus criterion narrows them further',
  (function () {
    const both = api.drawioFilterHidden({ area: '', zone: '', outOfBand: false, basecaseLoading: true, contingencyLoading: true },
      flowScene.nodes, flowScene.edges, null, null, flowCfg, flowLoads, flowCons);
    const inArea = api.drawioFilterHidden({ area: '1', zone: '', outOfBand: false, basecaseLoading: true },
      flowScene.nodes, flowScene.edges, flowMeta, null, flowCfg, flowLoads, flowCons);
    return both.keptBranches === 1 && both.ids.e3 !== true && both.ids.e1 === true
      && inArea.keptBranches === 0 && inArea.ids.e1 === true;
  })());
check('a bus criterion on its own still reports buses, and keeps the network between them',
  (function () {
    // bus1 and bus2 are area 1: their branch stays, everything else in the area's network goes
    const meta1 = { ofBus: { bus1: { area: '1' }, bus2: { area: '1' }, bus3: { area: '9' }, bus4: { area: '9' } }, areas: [], zones: [] };
    const h = api.drawioFilterHidden({ area: '1', zone: '', outOfBand: false }, flowScene.nodes, flowScene.edges,
      meta1, null, flowCfg, flowLoads, flowCons);
    return h.text === 'Showing 2 of 4 buses (area 1).' && h.ids.bus3 === true && h.ids.bus4 === true
      && h.ids.e1 !== true && h.ids.e2 === true && h.ids.e3 === true;
  })());
check('with no loading data a flow criterion keeps nothing, and says so',
  (function () {
    const h = api.drawioFilterHidden({ area: '', zone: '', outOfBand: false, basecaseLoading: true },
      flowScene.nodes, flowScene.edges, null, null, flowCfg, null, null);
    return h.keptBranches === 0 && h.totalBranches === 3
      && h.text.indexOf('Showing 0 of 4 buses and 0 of 3 branches') === 0;
  })());

check('the filter reports what it kept, in words',
  api.drawioFilterHidden({ area: '1', zone: '', outOfBand: false }, scene.nodes, scene.edges, meta, null).text.indexOf('Showing') === 0
  && api.drawioFilterHidden({ area: '1', zone: '', outOfBand: false }, scene.nodes, scene.edges, meta, null).label === 'area 1');

// --- 17. the one-line diagram config ---------------------------------------
console.log('\n17. one-line diagram config (config/net_diagram.json)');
// The shipped file and the code must agree: the client's defaults are what the diagram paints with
// before the Host answers, and the Host writes from its own copy, so a drift here would show as
// "the dialog saved it but the drawing looks different".
const shippedCfg = JSON.parse(readFileSync(join(ROOT, 'config', 'net_diagram.json'), 'utf8'));
const cfgKeys = api.DRAWIO_NET_FIELDS.map((f) => f.key);
check('the shipped config carries exactly the editable keys',
  cfgKeys.every((k) => Object.prototype.hasOwnProperty.call(shippedCfg, k))
  && Object.keys(shippedCfg).length === cfgKeys.length,
  Object.keys(shippedCfg).join(','));
// The file is the user's to tune (`config/net_diagram.json` is a live, hand-editable setting), so
// this asserts what must hold rather than equality: the code's fallback carries the same seven keys
// as the file, and the file as written is already valid -- the sanitizer leaves it untouched.
check('the fallback defaults carry the same keys as the file',
  cfgKeys.length === 8 && JSON.stringify(Object.keys(api.DRAWIO_NET_DEFAULTS).sort()) === JSON.stringify(cfgKeys.slice().sort()),
  Object.keys(api.DRAWIO_NET_DEFAULTS).join(','));
check('the shipped config is valid as written: the sanitizer changes nothing',
  JSON.stringify(api.drawioNetConfig(shippedCfg)) === JSON.stringify(shippedCfg)
  && JSON.stringify(api.drawioNetConfig(api.DRAWIO_NET_DEFAULTS)) === JSON.stringify(api.DRAWIO_NET_DEFAULTS),
  JSON.stringify(api.drawioNetConfig(shippedCfg)));
check('both hosts carry the same defaults and the same seven keys',
  ['interpss-persistent/lib/index.js', 'interpss-dynamic/host-body.js'].every((p) => {
    const src = readFileSync(join(ROOT, p), 'utf8');
    return src.indexOf('const DEFAULT_NET_DIAGRAM_CONFIG = {') >= 0
      && cfgKeys.every((k) => src.indexOf(k + ':') >= 0)
      && src.indexOf("'getNetDiagramOptions'") >= 0 && src.indexOf("'saveNetDiagramOptions'") >= 0;
  }));

// The sanitizer: what the Host will keep, and what the client paints with before it answers.
check('a missing or broken config becomes the shipped defaults',
  JSON.stringify(api.drawioNetConfig(null)) === JSON.stringify(api.DRAWIO_NET_DEFAULTS)
  && JSON.stringify(api.drawioNetConfig('nonsense')) === JSON.stringify(api.DRAWIO_NET_DEFAULTS)
  && JSON.stringify(api.drawioNetConfig([1, 2])) === JSON.stringify(api.DRAWIO_NET_DEFAULTS));
check('a partial config keeps its values and fills the rest',
  (function () {
    const c = api.drawioNetConfig({ Bus_flag_color: 'orange' });
    return c.Bus_flag_color === 'orange' && c.Bus_flag_lower_limit === 0.9 && c.Basecase_branch_flow_flag_percent === 80;
  })());
check('an inverted bus band falls back rather than painting nonsense',
  (function () {
    const c = api.drawioNetConfig({ Bus_flag_lower_limit: 1.2, Bus_flag_upper_limit: 0.8 });
    return c.Bus_flag_lower_limit === 0.9 && c.Bus_flag_upper_limit === 1.1;
  })());
check('the birdseye switch is on unless it was turned off, and the file\'s spelling counts',
  api.drawioNetConfig(null).Show_birdseye_view === true
  && api.drawioNetConfig({ Show_birdseye_view: false }).Show_birdseye_view === false
  && api.drawioNetConfig({ Show_birdseye_view: 'false' }).Show_birdseye_view === false
  && api.drawioNetConfig({ Show_birdseye_view: 0 }).Show_birdseye_view === false
  && api.drawioNetConfig({ Show_birdseye_view: 'true' }).Show_birdseye_view === true
  && api.drawioNetConfig({ Show_birdseye_view: 'yes' }).Show_birdseye_view === true);
check('a switch is never a validation error, whatever the form holds',
  api.drawioNetConfigErrors(Object.assign(api.drawioNetConfig(null), { Show_birdseye_view: false })).Show_birdseye_view === undefined);
check('unknown keys survive a round trip, so hand edits are not destroyed',
  api.drawioNetConfig({ something_else: 7 }).something_else === 7);
check('the sanitizer bounds numbers and rejects unusable colours',
  (function () {
    const c = api.drawioNetConfig({ Basecase_branch_flow_flag_percent: 99999, Bus_flag_color: 'not a colour' });
    return c.Basecase_branch_flow_flag_percent === 1000 && c.Bus_flag_color === 'red';
  })());

// The form's own validation: it must say WHY rather than clamp silently behind the user's back.
check('a valid form has no errors', Object.keys(api.drawioNetConfigErrors(api.drawioNetConfig(null))).length === 0);
check('the form reports a missing number, a bad range, a bad colour and an inverted band',
  Object.keys(api.drawioNetConfigErrors(Object.assign(api.drawioNetConfig(null), { Basecase_branch_flow_flag_percent: '' }))).length === 1
  && Object.keys(api.drawioNetConfigErrors(Object.assign(api.drawioNetConfig(null), { Contingency_branch_flow_flag_percent: '-5' }))).length === 1
  && Object.keys(api.drawioNetConfigErrors(Object.assign(api.drawioNetConfig(null), { Bus_flag_color: 'x y z' }))).length === 1
  && api.drawioNetConfigErrors(Object.assign(api.drawioNetConfig(null), { Bus_flag_lower_limit: '1.5' })).Bus_flag_upper_limit !== undefined,
  JSON.stringify(api.drawioNetConfigErrors(Object.assign(api.drawioNetConfig(null), { Bus_flag_color: 'x y z' }))));

// The flow readers: columns by NAME (a reordered table must not flag the wrong branches) and the
// max across parallel circuits. They keep EVERY row -- the thresholds are applied by the paint and
// the status counts -- because the tooltip quotes what the tables hold (0.6.31). Reading the
// contingency table at all depends on the Host listing it, so that is pinned here too.
const BR_HEADER = 'ID,Name,Circuit,FromBusID,FromBusNumber,ToBusID,ToBusNumber,Loading%';
const BR_ROWS = [
  'Bus1->Bus2(1),L1,1,Bus1,1,Bus2,2,91.5',
  'Bus1->Bus2(2),L1,2,Bus1,1,Bus2,2,72.0',
  'Bus2->Bus3(1),L2,1,Bus2,2,Bus3,3,45.0',
  'Bus3->Bus4(1),L3,1,Bus3,3,Bus4,4,120.0',
];
const baseFlags = api.drawioBranchLoads(BR_HEADER, BR_ROWS);
check('the load map keeps every pair, with the highest circuit loading',
  baseFlags['bus1|bus2'] === 91.5 && baseFlags['bus3|bus4'] === 120 && baseFlags['bus2|bus3'] === 45,
  JSON.stringify(baseFlags));
check('the flow columns are read by header name, not by position',
  (function () {
    const shuffled = api.drawioBranchLoads('Loading%,Status,FromBusID,ToBusID', ['95.0,true,Bus8,Bus9', '10.0,true,Bus1,Bus2']);
    return shuffled['bus8|bus9'] === 95 && shuffled['bus1|bus2'] === 10;
  })());
// 0.6.31: both Hosts must list the contingency result in `checkResult`, because that list is the only
// way the tab discovers it -- a missing entry means the contingency family can never appear.
check('both hosts list the contingency result in checkResult',
  ['interpss-persistent/lib/index.js', 'interpss-dynamic/host-body.js'].every((p) =>
    readFileSync(join(ROOT, p), 'utf8').indexOf("stem + '_DF_contingency.csv'") >= 0),
  'checkResult files');
check('a threshold the config raises stops PAINTING what it used to',
  (function () {
    const edges = (cfg) => Object.keys(api.drawioFlagPaint(scene.nodes, scene.edges, cfg, null, baseFlags, null))
      .filter((id) => id.charAt(0) === 'e').length;
    const wide = edges(api.drawioNetConfig({ Basecase_branch_flow_flag_percent: 40 }));
    const narrow = edges(api.drawioNetConfig({ Basecase_branch_flow_flag_percent: 100 }));
    return wide > narrow && narrow >= 0 && baseFlags['bus2|bus3'] === 45;
  })());
const CON_HEADER = 'BranchID,BranchName,IsXfmr,ContingencyName,LoadingPercent';
const CON_ROWS = ['Bus1->Bus2(1),L1,false,C1,118.0', 'Bus2->Bus3(1),L2,false,C1,60.0', 'Bus7->Bus8(1),L3,true,C2,150.5'];
const conFlags = api.drawioContingencyLoads(CON_HEADER, CON_ROWS);
check('contingency loadings come from the CA table, keyed by the BranchID pair',
  conFlags['bus1|bus2'] === 118 && conFlags['bus7|bus8'] === 150.5 && conFlags['bus2|bus3'] === 60,
  JSON.stringify(conFlags));
// The bug this release exists for: with a 100% contingency FLAG and a 70% value in the table, the
// tooltip must still have the value while the paint leaves the branch alone.
check('a contingency below the flag threshold is available to the tooltip but not painted',
  (function () {
    const th = api.drawioNetConfig({ Contingency_branch_flow_flag_percent: 100, Basecase_branch_flow_flag_percent: 1000 });
    const painted = Object.keys(api.drawioFlagPaint(scene.nodes, scene.edges, th, null, null, { 'bus1|bus2': 70 }))
      .filter((id) => id.charAt(0) === 'e');
    const painted100 = Object.keys(api.drawioFlagPaint(scene.nodes, scene.edges,
      api.drawioNetConfig({ Contingency_branch_flow_flag_percent: 100 }), null, null, { 'bus1|bus2': 118 }))
      .filter((id) => id.charAt(0) === 'e');
    return conFlags['bus2|bus3'] < 100 && painted.length === 0 && painted100.length > 0;
  })());

// The paint map: buses cover their bar and label, branches resolve through a transformer group, and
// a contingency flag outranks a base-case one on the same branch.
const cfgPaint = api.drawioNetConfig(null);
const flagPaint = api.drawioFlagPaint(scene.nodes, scene.edges, cfgPaint, { bus5: true },
  { 'bus1|bus2': 91.5 }, { 'bus1|bus2': 118 });
check('a flagged bus paints its bar and its label; a flagged branch paints its edges',
  flagPaint.bus5 === 'red' && flagPaint.nm5 === 'red'
  && Object.keys(flagPaint).some((id) => id.charAt(0) === 'e' && flagPaint[id] === 'blue'),
  JSON.stringify(Object.keys(flagPaint).slice(0, 6)));
check('a contingency flag outranks the base-case flag on the same branch',
  Object.keys(flagPaint).filter((id) => id.charAt(0) === 'e').every((id) => flagPaint[id] === 'blue')
  && !Object.keys(flagPaint).some((id) => flagPaint[id] === 'green'));
check('with no flags data the map is empty, and the renderer paints as it always did',
  Object.keys(api.drawioFlagPaint(scene.nodes, scene.edges, cfgPaint, null, null, null)).length === 0);
check('the search colour goes over the flags, because a search is the deliberate act',
  (function () {
    const merged = api.drawioMergedPaint({ bus5: 'red', nm5: 'red' }, { buses: { bus5: true }, edges: { e1: true } }, '#1F6FEB');
    return merged.bus5 === '#1F6FEB' && merged.nm5 === 'red' && merged.e1 === '#1F6FEB'
      && api.drawioMergedPaint(null, null, '#1F6FEB') === null;
  })());

// --- 18. the birdseye view --------------------------------------------------
console.log('\n18. birdseye view (0.6.28)');
const birdPaths = api.drawioBirdseyePaths(scene);
const subpaths = (d) => (String(d).match(/M/g) || []).length;
check('the birdseye carries one subpath per bar and per branch, as two paths',
  subpaths(birdPaths.bars) === scene.nodes.filter((n) => api.drawioIsBusId(n.id) && n.kind === 'rect').length
  && subpaths(birdPaths.edges) === scene.edges.length,
  subpaths(birdPaths.bars) + ' bars / ' + subpaths(birdPaths.edges) + ' edges');
check('every bar subpath is a closed rectangle at the bar itself',
  birdPaths.bars.indexOf('M') === 0 && (birdPaths.bars.match(/z/g) || []).length === subpaths(birdPaths.bars));
check('the branch paths follow their polylines, so a hop shows in the thumbnail too',
  (function () {
    const withHop = scene.edges.filter((e) => e.points.length > 2)[0];
    if (withHop === undefined) return true;
    return birdPaths.edges.split('M').some((seg) => (seg.match(/L/g) || []).length === withHop.points.length - 1);
  })());
check('an empty or missing scene gives empty paths rather than a throw',
  api.drawioBirdseyePaths(null).bars === '' && api.drawioBirdseyePaths(null).edges === ''
  && api.drawioBirdseyePaths({ nodes: [], edges: [] }).bars === '');

// Where a click lands: the same-size window, centred, and held inside the drawing.
const fit = api.drawioFitRect(scene.viewBox);
const half = { x: fit.x, y: fit.y, w: fit.w / 2, h: fit.h / 2 };
check('a click at the middle centres the window on the middle of the drawing',
  (function () {
    const r = api.drawioBirdseyeRect(scene, half, 0.5, 0.5);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return Math.abs(cx - (fit.x + fit.w / 2)) < 0.001 && Math.abs(cy - (fit.y + fit.h / 2)) < 0.001
      && r.w === half.w && r.h === half.h;
  })());
check('a click in a corner is held inside the drawing instead of showing empty paper',
  (function () {
    const tl = api.drawioBirdseyeRect(scene, half, 0, 0);
    const br = api.drawioBirdseyeRect(scene, half, 1, 1);
    return tl.x === fit.x && tl.y === fit.y
      && br.x + br.w <= fit.x + fit.w + 0.001 && br.y + br.h <= fit.y + fit.h + 0.001;
  })());
check('a window as large as the drawing cannot be moved, and fraction drift is clamped',
  (function () {
    const whole = api.drawioBirdseyeRect(scene, fit, 0.9, 0.9);
    const wild = api.drawioBirdseyeRect(scene, half, 5, -5);
    // fx clamps to 1 (the right edge), fy to 0 (the top)
    return whole.x === fit.x && whole.y === fit.y && whole.w === fit.w
      && wild.x === fit.x + fit.w - half.w && wild.y === fit.y;
  })());
check('a missing scene or rect passes through unchanged',
  api.drawioBirdseyeRect(null, half, 0.5, 0.5) === half && api.drawioBirdseyeRect(scene, null, 0.5, 0.5) === null);

// --- 19. preview fidelity: the style keys the workspace's diagrams use ---------
console.log('\n19. preview fidelity (what draw.io shows, the preview shows)');
// 0.6.33. Three keys were misread: `rounded` (a value, not a presence), `align`/`verticalAlign`
// (a label's place in its box, with `spacing`), and `labelBackgroundColor` (the mask behind a
// `text` cell's glyphs). One fixture exercises them next to the keys that were already honoured, so
// a future regression shows up as a failing cell rather than as a screenshot nobody compared.
const fid = api.parseDrawioScene('<mxfile><diagram><mxGraphModel><root>'
  + '<mxCell id="r0" value="" vertex="1" parent="1" style="rounded=0;fillColor=#666666;strokeColor=#333333;">'
  + '<mxGeometry x="0" y="0" width="6" height="52" as="geometry"/></mxCell>'
  + '<mxCell id="r1" value="" vertex="1" parent="1" style="rounded=1;arcSize=30;fillColor=#666666;strokeColor=none;">'
  + '<mxGeometry x="100" y="0" width="40" height="40" as="geometry"/></mxCell>'
  + '<mxCell id="r2" value="" vertex="1" parent="1" style="rounded;fillColor=#666666;strokeColor=none;">'
  + '<mxGeometry x="200" y="0" width="40" height="20" as="geometry"/></mxCell>'
  + '<mxCell id="tL" value="Left" vertex="1" parent="1" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;spacing=5;fontColor=#000000;">'
  + '<mxGeometry x="300" y="0" width="100" height="20" as="geometry"/></mxCell>'
  + '<mxCell id="tC" value="Top" vertex="1" parent="1" style="text;html=1;align=center;verticalAlign=top;fontSize=20;fontColor=#000000;">'
  + '<mxGeometry x="0" y="100" width="120" height="40" as="geometry"/></mxCell>'
  + '<mxCell id="tR" value="Bottom" vertex="1" parent="1" style="text;html=1;align=right;verticalAlign=bottom;fontSize=10;fontColor=#000000;">'
  + '<mxGeometry x="200" y="100" width="120" height="40" as="geometry"/></mxCell>'
  + '<mxCell id="tB" value="Masked" vertex="1" parent="1" style="text;html=1;labelBackgroundColor=#FFFFFF;align=center;verticalAlign=middle;fontSize=11;fontColor=#000000;">'
  + '<mxGeometry x="0" y="200" width="80" height="18" as="geometry"/></mxCell>'
  + '<mxCell id="tN" value="Bare" vertex="1" parent="1" style="text;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=#000000;">'
  + '<mxGeometry x="200" y="200" width="80" height="18" as="geometry"/></mxCell>'
  // a numeric newline: valid XML, decoded by a real parser, and `labelLines` maps `&#10;` itself
  + '<mxCell id="tM" value="A&#10;B" vertex="1" parent="1" style="text;html=1;align=left;verticalAlign=top;fontSize=12;spacing=6;">'
  + '<mxGeometry x="400" y="200" width="90" height="40" as="geometry"/></mxCell>'
  + '<mxCell id="el0" value="" vertex="1" parent="1" style="ellipse;fillColor=none;strokeColor=#CCCCCC;strokeWidth=1.5;">'
  + '<mxGeometry x="500" y="0" width="16" height="16" as="geometry"/></mxCell>'
  + '<mxCell id="g0" value="" vertex="1" parent="1" style="group;">'
  + '<mxGeometry x="600" y="0" width="40" height="40" as="geometry"/></mxCell>'
  + '<mxCell id="g0a" value="" vertex="1" parent="g0" style="ellipse;fillColor=none;strokeColor=#333333;">'
  + '<mxGeometry x="0" y="0" width="16" height="16" as="geometry"/></mxCell>'
  + '<mxCell id="e0" value="" edge="1" parent="1" source="r0" target="r1" style="endArrow=none;html=1;rounded=0;strokeColor=#000000;strokeWidth=1.5;exitX=0.5;exitY=0.5;entryX=0;entryY=0.5;">'
  + '<mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="60" y="26"/><mxPoint x="80" y="26"/></Array></mxGeometry></mxCell>'
  + '<mxCell id="e1" value="" edge="1" parent="1" source="r1" target="el0" style="html=1;strokeColor=#FF0000;dashed=1;endArrow=classic;">'
  + '<mxGeometry relative="1" as="geometry"/></mxCell>'
  + '</root></mxGraphModel></diagram></mxfile>');
const fidNode = (id) => fid.nodes.filter((n) => n.id === id)[0];
const fidEdge = (id) => fid.edges.filter((e) => e.id === id)[0];
check('rounded is read as a value: 0 is square, 1 rounds, a bare key rounds',
  fidNode('r0').rounded === false && fidNode('r1').rounded === true && fidNode('r2').rounded === true
  && fidNode('el0').rounded === false,
  [fidNode('r0').rounded, fidNode('r1').rounded, fidNode('r2').rounded].join(','));
check('arcSize is read, defaulting to draw.io\'s 15 per cent',
  fidNode('r1').arcSize === 0.3 && fidNode('r0').arcSize === 0.15,
  fidNode('r1').arcSize + ' / ' + fidNode('r0').arcSize);
check('the label layout keys are read, with draw.io\'s defaults when absent',
  fidNode('tL').align === 'left' && fidNode('tL').spacing === 5
  && fidNode('tC').vAlign === 'top' && fidNode('tC').spacing === 2
  && fidNode('tR').align === 'right' && fidNode('tR').vAlign === 'bottom'
  && fidNode('tN').align === 'center' && fidNode('tN').vAlign === 'middle');
check('labelBackgroundColor is read, and its absence is null',
  fidNode('tB').labelBg === '#FFFFFF' && fidNode('tN').labelBg === null && fidNode('tC').labelBg === null);
check('the group cell is still not a shape, but its children are',
  fidNode('g0') === undefined && fidNode('g0a') !== undefined && fidNode('g0a').x === 600 && fidNode('g0a').y === 0);
check('the already-honoured keys are unchanged in the same fixture',
  fidNode('el0').kind === 'ellipse' && fidNode('el0').fill === 'none'
  && fidEdge('e0').points.length === 4 && fidEdge('e0').arrow === null
  && fidEdge('e1').dashed === true && fidEdge('e1').arrow !== null
  && fidEdge('e1').stroke === '#FF0000');

const fidSvg = api.DrawioDiagram({ scene: fid });
const fidByKey = {};
const fidOrder = {};
for (const g of groupsOf(fidSvg)) {
  fidByKey[g.props.key] = partsOf(g);
  fidOrder[g.props.key] = groupsOf(fidSvg).map((x) => x.props.key).indexOf(g.props.key);
}
const fidIndexOf = (id) => fid.nodes.map((n) => n.id).indexOf(id);
const fidParts = (id) => fidByKey['n' + fidIndexOf(id)] || [];
const fidRect = (id) => fidParts(id).filter((part) => part.type === 'rect')[0];
const fidText = (id) => fidParts(id).filter((part) => part.type === 'text')[0];
// a <text>'s children are its tspans, wrapped once (see partsOf)
const fidSpans = (id) => (Array.isArray(fidText(id).kids[0]) ? fidText(id).kids[0] : fidText(id).kids);
check('a rounded=0 bar renders square and a rounded=1 bar rounds by arcSize',
  fidRect('r0').props.rx === 0 && fidRect('r1').props.rx === 12 && fidRect('r2').props.rx === 3,
  [fidRect('r0').props.rx, fidRect('r1').props.rx, fidRect('r2').props.rx].join(','));
check('align picks the anchor and the edge, inset by spacing',
  fidText('tL').props.textAnchor === 'start' && fidText('tL').props.x === 305
  && fidText('tR').props.textAnchor === 'end' && fidText('tR').props.x === 318
  && fidText('tC').props.textAnchor === 'middle' && fidText('tC').props.x === 60,
  [fidText('tL').props.x, fidText('tC').props.x, fidText('tR').props.x].join(','));
check('verticalAlign anchors the first baseline to the box, keeping the 1.2em line step',
  fidText('tC').props.y === 100 + 2 + 20 * 0.8
  && fidSpans('tC')[0].props.dy === '0'
  && fidText('tR').props.y === 100 + 40 - 2 - 10 * 0.2
  && fidText('tL').props.y === 10
  && fidText('tB').props.y === 209,
  [fidText('tC').props.y, fidText('tL').props.y, fidText('tR').props.y].join(','));
check('a two-line top-aligned label starts at the box top and steps 1.2em',
  fidSpans('tM').length === 2 && fidSpans('tM')[0].props.dy === '0'
  && fidSpans('tM')[1].props.dy === '1.2em'
  && fidText('tM').props.y === 200 + 6 + 12 * 0.8,
  String(fidText('tM').props.y));
check('labelBackgroundColor paints the mask, and only where the file asks for it',
  (function () {
    const mask = fidParts('tB').filter((part) => part.props.key === 'bg')[0];
    const bare = fidParts('tN').filter((part) => part.props.key === 'bg');
    return mask !== undefined && mask.props.fill === 'var(--dsw-alias-bg-layer-1)'
      && mask.props.width === 80 && mask.props.height === 18
      && fidParts('tB').indexOf(mask) < fidParts('tB').indexOf(fidText('tB'))
      && bare.length === 0;
  })());

// Reference files: the tracked diagrams carry the shapes the workspace really uses -- `text` labels
// masked by labelBackgroundColor, square bars, and a left-aligned header -- so they are asserted
// directly rather than only through a fixture.
const refScene = (rel) => api.parseDrawioScene(readFileSync(join(ROOT, rel), 'utf8'));
const ref14 = refScene('wspace/data/ieee/Ieee14Bus/diagram/ieee14-oneline.drawio');
const ref14Labels = ref14.nodes.filter((n) => /^nm\d+$/.test(n.id));
const ref14Bars = ref14.nodes.filter((n) => api.drawioIsBusId(n.id));
check('the reference diagram\'s labels are masked text cells, and its bars are square',
  ref14Labels.length === 14 && ref14Bars.length === 14
  && ref14Labels.every((n) => n.kind === 'text' && n.labelBg === '#FFFFFF' && n.align === 'center' && n.vAlign === 'middle')
  && ref14Bars.every((n) => n.rounded === false && n.arcSize === 0.15),
  ref14Labels.length + ' labels / ' + ref14Bars.length + ' bars');
const ref14Legend = ref14.nodes.filter((n) => n.id === 'legend')[0];
const ref14Svg = api.DrawioDiagram({ scene: ref14 });
const ref14LegendText = (function () {
  const idx = ref14.nodes.map((n) => n.id).indexOf('legend');
  for (const g of groupsOf(ref14Svg)) {
    if (g.props.key !== 'n' + idx) continue;
    return partsOf(g).filter((part) => part.type === 'text')[0];
  }
  return undefined;
})();
check('the reference diagram\'s legend text is anchored to its top-left, as draw.io draws it',
  ref14Legend !== undefined && ref14Legend.align === 'left' && ref14Legend.vAlign === 'top'
  && ref14LegendText !== undefined && ref14LegendText.props.textAnchor === 'start'
  && ref14LegendText.props.x === ref14Legend.x + ref14Legend.spacing,
  ref14Legend === undefined ? 'no legend' : ref14LegendText.props.x + ' of ' + ref14Legend.w);
const ref39Title = refScene('wspace/data/ieee/ieee39/diagram/ieee39-oneline.drawio')
  .nodes.filter((n) => n.id === 'title')[0];
check('the other reference diagram\'s title is left-aligned with a wide box, so centring would show',
  ref39Title !== undefined && ref39Title.align === 'left' && ref39Title.vAlign === 'middle'
  && ref39Title.w > 400,
  ref39Title === undefined ? 'no title' : ref39Title.w + ' wide');

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
