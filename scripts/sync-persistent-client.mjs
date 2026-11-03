// Rebuild the shared region of `interpss-persistent/lib/client.js` from the source body
// `interpss-persistent/src/client-body.js`.
//
// The source body is the tab's UI written against the dynamic host form: the bridge-case poll
// sits on the Cordis timer service. The persistent browser bundle has no Cordis timer/window at
// that scope, so the documented timer swap (docs/persistent-plugin-rebuild.md) replaces it with
// `setInterval` plus a `window` `focus` listener. Everything outside the shared region -- the
// persistent-only tool cards, the `slots` registrations and the module footer -- is left exactly
// as it was.
//
// The operation is marker-based and refuses to run when its invariants do not hold, so a
// drifted file fails loudly instead of being silently half-spliced. Run the guard afterwards:
//
//   node scripts/sync-persistent-client.mjs && node scripts/test-interpss-client.mjs
//
// Guard section 9 asserts precisely what this script produces.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BODY = join(ROOT, 'interpss-persistent', 'src', 'client-body.js');
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
if (pAt < 0 || dAt < 0) fail('the source body lost the ' + PMARK + ' / ' + DEND + ' markers');
if (lAt < 0 || lendAt < 0) fail('the persistent client lost the ' + PMARK + ' / ' + LEND + ' markers');
if (pAt > dAt || lAt > lendAt) fail('the markers are in an unexpected order');

const bodyRegion = dyn.slice(pAt, dAt);
const dynTimers = bodyRegion.split(DYN_TIMER).length - 1;
const persistTimers = bodyRegion.split(PERSIST_TIMER).length - 1;
if (dynTimers !== 1) fail('the source body carries the dynamic timer form ' + dynTimers + ' times, expected exactly 1');
if (persistTimers !== 0) fail('the source body already carries the persistent timer form');
const newRegion = bodyRegion.split(DYN_TIMER).join(PERSIST_TIMER);

const out = lib.slice(0, lAt) + newRegion + lib.slice(lendAt);
if (out.length <= 0) fail('refusing to write an empty file');

writeFileSync(LIB_CLIENT, out);
console.log('sync-persistent-client: rebuilt the shared region of ' + LIB_CLIENT
  + ' (' + newRegion.length + ' chars, timer swap applied)');
