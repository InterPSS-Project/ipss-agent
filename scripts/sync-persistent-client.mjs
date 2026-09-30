// Rebuild the two derived copies of the tab body from `interpss-dynamic/client-body.js`:
//
//   1. `interpss-dynamic/client.js` — the extracted dynamic artifact, byte-identical to
//      the body.
//   2. the shared region of `interpss-persistent/lib/client.js` — the same body region
//      with the documented timer swap re-applied (docs/persistent-plugin-rebuild.md §1.3):
//      a dynamic Client half gets no `setInterval`/`window`, so the bridge-case poll runs
//      on the Cordis timer service there and on `setInterval` + a window `focus` listener
//      in the persistent browser bundle.
//
// The operation is marker-based and refuses to run when its invariants do not hold, so a
// drifted file fails loudly instead of being silently half-spliced. Everything outside the
// shared region — the persistent-only tool cards, the `slots` registrations and the module
// footer — is left exactly as it was. Run the guard afterwards:
//
//   node scripts/sync-persistent-client.mjs && node scripts/test-interpss-client.mjs
//
// §9 of the guard asserts precisely what this script produces.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BODY = join(ROOT, 'interpss-dynamic', 'client-body.js');
const DYN_CLIENT = join(ROOT, 'interpss-dynamic', 'client.js');
const LIB_CLIENT = join(ROOT, 'interpss-persistent', 'lib', 'client.js');

// The same three markers the guard slices on: the body region starts at the preset table
// and ends where the view's `slots` work begins (dynamic) / where the persistent-only
// tool-card section begins (persistent).
const PMARK = '    const PRESETS = [';
const DEND = "    const slots = ctx.get('slots')";
const LEND = '    // --- ACLF tool-card result explorer';

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

function fail(message) {
  console.error('sync-persistent-client: ' + message);
  process.exit(1);
}

const dyn = readFileSync(BODY, 'utf8');
const lib = readFileSync(LIB_CLIENT, 'utf8');

const pAt = dyn.indexOf(PMARK);
const dAt = dyn.indexOf(DEND);
const lAt = lib.indexOf(PMARK);
const lendAt = lib.indexOf(LEND);
if (pAt < 0 || dAt < 0) fail('the dynamic body lost the ' + PMARK + ' / ' + DEND + ' markers');
if (lAt < 0 || lendAt < 0) fail('the persistent client lost the ' + PMARK + ' / ' + LEND + ' markers');
if (pAt > dAt || lAt > lendAt) fail('the markers are in an unexpected order');

const dynRegion = dyn.slice(pAt, dAt);
const dynTimers = dynRegion.split(DYN_TIMER).length - 1;
const persistTimers = dynRegion.split(PERSIST_TIMER).length - 1;
if (dynTimers !== 1) fail('the dynamic region carries the dynamic timer form ' + dynTimers + ' times, expected exactly 1');
if (persistTimers !== 0) fail('the dynamic region already carries the persistent timer form');
const newRegion = dynRegion.split(DYN_TIMER).join(PERSIST_TIMER);

const out = lib.slice(0, lAt) + newRegion + lib.slice(lendAt);
if (out.length <= 0) fail('refusing to write an empty file');

writeFileSync(DYN_CLIENT, dyn);
writeFileSync(LIB_CLIENT, out);
console.log('sync-persistent-client: wrote ' + DYN_CLIENT);
console.log('sync-persistent-client: rebuilt the shared region of ' + LIB_CLIENT
  + ' (' + newRegion.length + ' chars, timer swap applied)');
