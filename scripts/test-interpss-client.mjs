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
      + ' drawioPanRect: drawioPanRect, drawioWheelFactor: drawioWheelFactor, drawioZoomPercent: drawioZoomPercent,'
      + ' drawioThemeColor: drawioThemeColor,'
      + ' drawioBranchPairs: drawioBranchPairs, drawioIsBusId: drawioIsBusId, drawioLabelBusId: drawioLabelBusId,'
      + ' drawioHoverTarget: drawioHoverTarget, drawioCanonicalBusId: drawioCanonicalBusId,'
      + ' drawioPairLabel: drawioPairLabel, drawioFallbackTip: drawioFallbackTip,'
      + ' drawioTabChoice: drawioTabChoice, DiagramView: DiagramView,'
      + ' busTooltip: busTooltip, branchTooltip: branchTooltip };');


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
  // group's own coordinates and not be offset twice
  const xf15 = scene.nodes.find((n) => n.id === 'xf15');
  const xf15b = scene.nodes.find((n) => n.id === 'xf15b');
  check('a group child lands at its group origin', xf15 && xf15.x === 462 && xf15.y === 306, xf15 && `${xf15.x},${xf15.y}`);
  check('its pair applies the relative offset', xf15b && xf15b.x === 462 && xf15b.y === 314, xf15b && `${xf15b.x},${xf15b.y}`);
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
// The template is the style contract the case diagrams are copied from. draw.io
// re-serialises a file it opens — viewport offsets, attribute order — so the two are no
// longer byte-identical; what must hold is that they describe the same drawing.
let templateScene = null;
try {
  templateScene = api.parseDrawioScene(readFileSync(TEMPLATE_DIAGRAM, 'utf8'));
} catch (e) {
  templateScene = null;
}
const sceneShape = (s) => JSON.stringify({ viewBox: s.viewBox, nodes: s.nodes, edges: s.edges });
const sameDrawing = templateScene !== null && scene !== null && sceneShape(templateScene) === sceneShape(scene);
check('the template and the live case diagram parse to the same drawing', sameDrawing,
  sameDrawing ? undefined : (templateScene === null ? 'the template did not parse' : 'the two drawings differ'));

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
// Asked for in 0.6.11: the wheel and the drag are discoverable on their own, so the toolbar
// ends at Fit.
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
const editButton = findInTree(editTree, (n) => n.type === 'button'
  && String(n.props.title || '').indexOf('local draw.io app') >= 0);
check('the toolbar carries the local-draw.io edit button with its tooltip',
  editButton !== null && String(editButton.props['aria-label']).indexOf('local draw.io app') >= 0
  && editButton.props.disabled === false, editButton === null ? 'no button' : String(editButton.props.title));
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
const sourceTab = renderFlat(withState([
  ['caseInput', 'data/ieee/Ieee14Bus/ieee14.ieee'],
  ['files', tabFiles(1)],
  ['filesLoading', false],
  ['path', 'wspace/data/c/diagram/d0.drawio'],
  ['view', 'source'],
  ['xml', '<mxfile><diagram/></mxfile>'],
]));
check('the Source view shows the raw file', sourceTab.indexOf('<mxfile><diagram/></mxfile>') >= 0, sourceTab.slice(0, 90));
// The modal that used to live in InterPssView is gone, so `readDrawio` must have exactly
// one caller left. A second one would mean a preview surface grew back beside this tab.
check('the preview has exactly one entry point left, and it is this view',
  (slice.match(/callRemote\('readDrawio'/g) || []).length === 1
  && slice.indexOf('drawioDirectPath') < 0 && slice.indexOf('drawioModal') < 0);

// --- 13. the draw.io launcher ladder ---------------------------------------
console.log('\n13. the local draw.io launcher (edit button)');
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
  launchApi = new Function(spawnBlock + '\nreturn { drawioLaunch: drawioLaunch };')();
} catch (e) {
  launchApi = null;
}
check('the launcher block evaluates on its own', launchApi !== null && typeof launchApi.drawioLaunch === 'function');

if (launchApi !== null) {
  const ABS = '/ws/wspace/data/ieee/Ieee14Bus/diagram/ieee14-oneline.drawio';
  const fakeSubprocess = (options) => {
    const o = options || {};
    const spawned = [];
    return {
      spawned,
      async terminalEnvironment() { return { platform: o.platform === 'windows' ? 'windows' : 'posix' }; },
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

  const appRung = fakeSubprocess({ available: ['open', 'xdg-open'] });
  const launched = await launchApi.drawioLaunch(appRung, 'posix', ABS, '/ws', undefined);
  check('the draw.io app is the first rung on posix and the argv is open -a draw.io <file>',
    launched.ok === true && launched.launcher === 'open -a draw.io'
    && JSON.stringify(appRung.spawned) === JSON.stringify([['/resolved/open', '-a', 'draw.io', ABS]]),
    JSON.stringify(appRung.spawned));

  const fallback = fakeSubprocess({ available: ['open', 'xdg-open'], exits: { ['-a draw.io ' + ABS]: 1 } });
  const second = await launchApi.drawioLaunch(fallback, 'posix', ABS, '/ws', undefined);
  check('a failing app rung falls through to the OS default handler',
    second.ok === true && second.launcher === 'open' && fallback.spawned.length === 2, JSON.stringify(second));

  const linux = fakeSubprocess({ available: ['xdg-open'] });
  check('a missing open falls through to xdg-open and spawns nothing else',
    (await launchApi.drawioLaunch(linux, 'posix', ABS, '/ws', undefined)).launcher === 'xdg-open'
    && linux.spawned.length === 1 && linux.spawned[0][0] === '/resolved/xdg-open');

  const nothing = fakeSubprocess({ available: [] });
  const none = await launchApi.drawioLaunch(nothing, 'posix', ABS, '/ws', undefined);
  check('with no launcher installed the error names every rung and starts no process',
    none.ok === false && none.error.indexOf('open -a draw.io') >= 0 && none.error.indexOf('xdg-open') >= 0
    && nothing.spawned.length === 0, none.error);

  const allFail = fakeSubprocess({ available: ['open', 'xdg-open'], exits: { ['-a draw.io ' + ABS]: 1, [ABS]: 1 } });
  const failed = await launchApi.drawioLaunch(allFail, 'posix', ABS, '/ws', undefined);
  check('every rung failing quotes each launcher and its stderr',
    failed.ok === false && failed.error.indexOf('boom from') >= 0 && failed.error.indexOf('xdg-open exited') >= 0);

  const windows = fakeSubprocess({ available: ['cmd'], platform: 'windows' });
  const win = await launchApi.drawioLaunch(windows, 'windows', ABS, '/ws', undefined);
  check('windows uses cmd /c start "" <file> and skips the posix rungs',
    win.ok === true && win.launcher === 'cmd /c start'
    && JSON.stringify(windows.spawned) === JSON.stringify([['/resolved/cmd', '/c', 'start', '', ABS]]),
    JSON.stringify(windows.spawned));
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
