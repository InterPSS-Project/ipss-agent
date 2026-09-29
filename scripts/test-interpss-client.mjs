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
const DIAGRAM = join(ROOT, 'wspace', 'template', 'ieee14-oneline.drawio');

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
      + ' drawioPanRect: drawioPanRect, drawioWheelFactor: drawioWheelFactor, drawioZoomPercent: drawioZoomPercent };');
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
  check('the action row carries the Diagram button', flat.indexOf('"Diagram"') >= 0);
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
console.log('\n3. parseDrawioScene on wspace/template/ieee14-oneline.drawio');
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
  check('all 27 edges are drawn', scene.edges.length === 27, scene.edges.length);
  check('15 bus bars / 15 text labels / 10 transformer ellipses',
    kinds.rect === 15 && kinds.text === 15 && kinds.ellipse === 10, JSON.stringify(kinds));
  // group children carry geometry relative to their group, so they must land at the
  // group's own coordinates and not be offset twice
  const xf15 = scene.nodes.find((n) => n.id === 'xf15');
  const xf15b = scene.nodes.find((n) => n.id === 'xf15b');
  check('a group child lands at its group origin', xf15 && xf15.x === 462 && xf15.y === 306, xf15 && `${xf15.x},${xf15.y}`);
  check('its pair applies the relative offset', xf15b && xf15b.x === 462 && xf15b.y === 314, xf15b && `${xf15b.x},${xf15b.y}`);
  check('no group container is drawn', !scene.nodes.some((n) => n.id === '3' || n.id === '7'));
  // this file's branches are deliberately undirected (endArrow=none)
  const arrows = scene.edges.filter((e) => e.arrow !== null).length;
  check('only the 2 directed edges get arrowheads', arrows === 2, arrows);
  check('every node has a positive size', scene.nodes.every((n) => n.w > 0 && n.h > 0));
  check('every edge has at least 2 finite points',
    scene.edges.every((e) => e.points.length >= 2 && e.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))));
  const vb = scene.viewBox;
  check('the viewBox is finite and positive', Number.isFinite(vb.x) && vb.w > 0 && vb.h > 0, JSON.stringify(vb));
  check('the viewBox stays within the 900x760 page plus padding',
    vb.x >= -20 && vb.y >= -20 && vb.x + vb.w <= 920 && vb.y + vb.h <= 780, JSON.stringify(vb));

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

// --- 8. the diagram modal actually renders ---------------------------------
console.log('\n8. the diagram modal renders with a live scene');
// The §1 checks only ever see drawioOpen=false, so a reference error inside the modal —
// the same blank-tab class — would slip through. Override state *by name* rather than by
// call index, so adding a useState anywhere cannot silently retarget this to another one.
const stateNames = [];
const stateRe = /const \[([A-Za-z0-9_]+), set[A-Za-z0-9_]+\] = React\.useState/g;
let sm;
while ((sm = stateRe.exec(slice)) !== null) stateNames.push(sm[1]);
const idxOf = (n) => stateNames.indexOf(n);
check('the state list parsed by name', stateNames.length >= 60 && idxOf('drawioOpen') >= 0 && idxOf('drawioScene') >= 0,
  stateNames.length + ' states');

if (scene && idxOf('drawioOpen') >= 0) {
  const over = {};
  over[idxOf('activated')] = true;
  over[idxOf('drawioOpen')] = true;
  over[idxOf('drawioPath')] = 'wspace/template/ieee14-oneline.drawio';
  over[idxOf('drawioScene')] = scene;
  over[idxOf('drawioLoading')] = false;
  over[idxOf('drawioError')] = null;
  over[idxOf('drawioView')] = 'rendered';
  try {
    // build() compiles a fresh Function, so its function identities differ from `api`'s;
    // compare against this instance's own DrawioDiagram, not the earlier one.
    const modalApi = build(over);
    const tree = modalApi.InterPssView(props);
    check('rendering the open modal does not throw', tree !== null && tree !== undefined);
    const flat = JSON.stringify(tree, (k, v) => (typeof v === 'function' ? '[fn]' : v));
    check('the zoom toolbar is present', flat.indexOf('"Fit"') >= 0 && flat.indexOf('"+"') >= 0
      && flat.indexOf('"' + String.fromCharCode(0x2212) + '"') >= 0);
    check('the zoom readout starts at 100%', flat.indexOf('"100%"') >= 0);
    // find the embedded renderer and prove it got the live scene and the pan/zoom view
    const found = [];
    const walk = (n) => {
      if (n === null || typeof n !== 'object') return;
      if (Array.isArray(n)) { for (const k of n) walk(k); return; }
      if (n.type === modalApi.DrawioDiagram) found.push(n);
      if (n.kids) walk(n.kids);
    };
    walk(tree);
    check('the modal embeds DrawioDiagram with the live scene',
      found.length === 1 && found[0].props.scene === scene, found.length + ' instance(s)');
    check('the modal passes the pan/zoom view through',
      found.length === 1 && Object.prototype.hasOwnProperty.call(found[0].props, 'view'),
      found.length === 1 ? String(found[0].props.view) : '');
  } catch (e) {
    check('rendering the open modal does not throw', false, e.constructor.name + ': ' + e.message);
  }
}

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

// 9.6 the accepted divergences stay put: the chat tools are persistent-only (the dynamic
// host is an injected body with no imports, so it cannot carry node:fs helpers either)
check('the chat tools remain persistent-only',
  rd(LIB_HOST).indexOf('interpss_run_ca') >= 0 && rd(DYN_HOST).indexOf('interpss_run_ca') < 0);

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
