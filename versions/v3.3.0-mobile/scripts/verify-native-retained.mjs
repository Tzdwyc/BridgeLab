import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { evaluate, close } from './webview-cdp.mjs';

const root = new URL('../', import.meta.url);
const label = process.argv[2];
assert.match(label, /^[a-z0-9-]+$/);
try {
  const backup = JSON.parse(readFileSync(new URL('build/emulator-verification/preinstall-webview.json', root)));
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      state = await evaluate(`({url:location.href,title:document.title,app:{...document.querySelector('[data-testid=app]')?.dataset},localStorage:Object.fromEntries(Object.entries(localStorage)),errors:window.__bridgeDiagnosticErrors??[]})`);
      if (state?.title === 'BridgeLab v3.3.0 · 桥牌' && state?.app?.testid === 'app') break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(state, 'Native first page was not ready');
  assert.equal(state.title, 'BridgeLab v3.3.0 · 桥牌');
  assert.equal(state.localStorage['bridgelab.sl.lookahead.v16'], 'off');
  const expected = { ...backup.localStorage, 'bridgelab.sl.lookahead.v16': 'off' };
  assert.deepEqual(state.localStorage, expected, 'Save and settings must match the full pre-upgrade snapshot except the authorized lookahead disable');
  assert.deepEqual(state.errors, []);
  const result = { verifiedAt: new Date().toISOString(), label, status: 'passed', url: state.url, title: state.title,
    app: state.app, lookahead: state.localStorage['bridgelab.sl.lookahead.v16'], allOtherStorageExactlyRetained: true,
    storageKeys: Object.keys(state.localStorage).sort(), fullSessionSha256: createHash('sha256').update(state.localStorage['bridgelab.session.v3.6']).digest('hex'), errors: state.errors };
  writeFileSync(new URL(`build/emulator-verification/${label}-retained.json`, root), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { close(); }
