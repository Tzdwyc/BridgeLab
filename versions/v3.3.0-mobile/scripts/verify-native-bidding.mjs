import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { cdp, evaluate, close } from './webview-cdp.mjs';

const root = new URL('../', import.meta.url);
const fixtures = JSON.parse(readFileSync(new URL('../../v3.3.0-desktop/artifacts/v324-production-sessions.json', import.meta.url)));
const noticeFixture = JSON.parse(readFileSync(new URL('../../v3.3.0-desktop/artifacts/v324-notice-session.json', import.meta.url)));
const backup = JSON.parse(readFileSync(new URL('build/emulator-verification/preinstall-webview.json', root)));
const key = 'bridgelab.session.v3.6';
const modelSha = '41556ff0f83ced20eeea66a853b87269f3de0ac62b1aca75abce4bf9a63275e3';
const originalSha = createHash('sha256').update(readFileSync(new URL('assets/www/models/sl/original-sl/sl.bin', root))).digest('hex');
const rows = [], errors = [], settingsChecks = [], noticeChecks = [];
let activeInit;
const digest = raw => createHash('sha256').update(raw).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(expression, predicate, timeout = 30000) {
  const started = Date.now(); let state;
  while (Date.now() - started < timeout) {
    try { state = await evaluate(expression); if (predicate(state)) return state; } catch {}
    await sleep(150);
  }
  throw Error('Native state timeout: ' + JSON.stringify(state));
}
async function loadFixture(fixture, page) {
  activeInit = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(fixture.raw)});` })).identifier;
  await cdp('Page.navigate', { url: 'http://127.0.0.1:51893/index.html?nativeVerification=v325-' + fixture.id + '-' + Date.now() + '#/' + page });
  await waitFor(`({app:!!document.querySelector('[data-testid=app]'),seed:JSON.parse(localStorage.getItem(${JSON.stringify(key)}))?.current?.seed})`, s => s?.app && s.seed === JSON.parse(fixture.raw).current.seed);
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: activeInit }); activeInit = undefined;
}
async function restore() {
  if (activeInit) await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: activeInit });
  const expected = { ...backup.localStorage, 'bridgelab.sl.lookahead.v16': 'off' };
  activeInit = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `const expected=${JSON.stringify(expected)};for(const k of Object.keys(localStorage))if(!(k in expected))localStorage.removeItem(k);for(const[k,v]of Object.entries(expected))localStorage.setItem(k,v);` })).identifier;
  await cdp('Page.navigate', { url: 'http://127.0.0.1:51893/index.html?nativeVerification=v325-restored-' + Date.now() + '#/home' });
  await waitFor(`({app:!!document.querySelector('[data-testid=app]'),storage:Object.fromEntries(Object.entries(localStorage))})`, s => s?.app && JSON.stringify(Object.entries(s.storage).sort()) === JSON.stringify(Object.entries(expected).sort()));
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: activeInit }); activeInit = undefined;
}
async function selectProfile(value, expectedSha) {
  await evaluate(`(()=>{const select=document.querySelector('select[aria-label="叫牌模型"]');if(!select||select.disabled)throw Error('Model setting unavailable');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const state = await waitFor(`({...document.querySelector('[data-testid=app]')?.dataset})`, s => s?.slProfile === value && s.slStatus === 'ready' && s.slLoadedSha === expectedSha);
  assert.equal(await evaluate(`localStorage.getItem('bridgelab.sl.lookahead.v16')`), 'off');
  settingsChecks.push({ profile: value, actualLoadedSha256: state.slLoadedSha, status: state.slStatus, interaction: 'Actual settings select change event and production React handler', passed: true });
}
try {
  assert.deepEqual(fixtures.map(f => f.id), ['6247', '1367']);
  await cdp('Page.enable');
  await loadFixture(fixtures[0], 'home');
  await evaluate(`document.querySelector('button[aria-label="设置"]').click()`);
  await waitFor(`!!document.querySelector('[role="dialog"]')`, Boolean);
  for (let page = 0; page < 10 && !await evaluate(`!!document.querySelector('select[aria-label="叫牌模型"]')`); page++) {
    await evaluate(`(()=>{const next=document.querySelector('button[aria-label="下一页游戏设置"]');if(!next||next.disabled)throw Error('Model settings page absent');next.click()})()`);
    await sleep(150);
  }
  const settings = await waitFor(`(()=>{const select=document.querySelector('select[aria-label="叫牌模型"]');return {hasSelect:!!select,options:select?[...select.options].map(o=>({value:o.value,text:o.textContent})):[],lookaheadCheckbox:!!document.querySelector('section[aria-label="叫牌模型"] input[type="checkbox"]'),text:document.querySelector('[role="dialog"]')?.textContent??''}})()`, s => s?.hasSelect);
  assert.deepEqual(settings.options.map(o => o.value), ['seed101-epoch08', 'original-sl']);
  assert.equal(settings.lookaheadCheckbox, false); assert(!settings.text.includes('叫牌前瞻'));
  settingsChecks.push({ lookaheadCheckboxAbsent: true, options: settings.options, passed: true });
  await selectProfile('original-sl', originalSha);
  await selectProfile('seed101-epoch08', modelSha);
  for (const fixture of fixtures) {
    await loadFixture(fixture, 'table');
    const prefix = JSON.parse(fixture.raw).current.actions.length;
    const state = await waitFor(`(()=>{const session=JSON.parse(localStorage.getItem(${JSON.stringify(key)}));return {current:session?.current,app:{...document.querySelector('[data-testid=app]')?.dataset},lookahead:localStorage.getItem('bridgelab.sl.lookahead.v16'),errors:window.__bridgeDiagnosticErrors??[]}})()`, s => s?.current?.seed === JSON.parse(fixture.raw).current.seed && s.current.actions.length > prefix);
    const actual = state.current.actions[prefix];
    assert.deepEqual(actual, { kind: 'call', seat: fixture.turn, call: { kind: 'bid', level: Number(fixture.expected[0]), strain: fixture.expected.slice(1) } });
    assert.equal(state.app.slStatus, 'ready'); assert.equal(state.app.slLoadedSha, modelSha); assert.equal(state.app.slLastRoute, 'sl-legal');
    assert.equal(state.lookahead, 'off'); assert.deepEqual(state.errors, []);
    rows.push({ id: fixture.id, expected: fixture.expected, actual, prefixActions: prefix, fixtureSha256: digest(fixture.raw), model: state.app, recordAfter: state.current, passed: true });
    console.log(fixture.id + ': ' + fixture.expected + ' via sl-legal passed');
  }
  await loadFixture(noticeFixture, 'table');
  await waitFor(`document.querySelector('[data-card="D8"][data-seat="S"]')?.disabled`, v => v === true);
  assert.equal(await evaluate(`document.querySelectorAll('[data-tone]').length`), 0);
  await evaluate(`(()=>{const button=document.querySelector('[data-card="D8"][data-seat="S"]');button.removeAttribute('disabled');button.click()})()`);
  await sleep(300);
  let invalidInteraction = 'Removed disabled attribute then DOM click';
  if (!await evaluate(`!!document.querySelector('[data-tone="error"]')`)) {
    invalidInteraction = 'React ignores DOM click for disabled props; existing rendered React onClick invoked to exercise unchanged core REVOKE';
    await evaluate(`(()=>{const button=document.querySelector('[data-card="D8"][data-seat="S"]');const key=Object.keys(button).find(k=>k.startsWith('__reactProps$'));if(!key||!button[key].onClick)throw Error('Existing card click handler missing');button[key].onClick({})})()`);
  }
  const invalid = await waitFor(`({actions:Number(document.querySelector('[data-testid=app]')?.dataset.actions),notices:[...document.querySelectorAll('[data-tone]')].map(n=>({tone:n.dataset.tone,text:n.textContent}))})`, s => s?.notices?.length === 1);
  assert.equal(invalid.actions, noticeFixture.actions); assert.equal(invalid.notices[0].tone, 'error'); assert(invalid.notices[0].text.includes('手中有首引花色，必须跟牌。'));
  await waitFor(`document.querySelectorAll('[data-tone]').length`, n => n === 0, 7000);
  noticeChecks.push({ check: 'Illegal user card keeps actions unchanged, short REVOKE message and automatic dismissal', interaction: invalidInteraction, state: invalid, dismissed: true, passed: true });
  await loadFixture(noticeFixture, 'table');
  await waitFor(`document.querySelector('[data-card="H6"][data-seat="S"]')?.disabled`, v => v === false);
  await evaluate(`(()=>{const timer=window.setTimeout.bind(window);window.setTimeout=(handler,delay,...args)=>timer(handler,delay===1100||delay===1600?600000:delay,...args);const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='bridgelab.session.v3.6')throw Error('Verification-only autosave failure');return original.call(this,key,value)};document.querySelector('[data-card="H6"][data-seat="S"]').click()})()`);
  const autosave = await waitFor(`({actions:Number(document.querySelector('[data-testid=app]')?.dataset.actions),notices:[...document.querySelectorAll('[data-tone]')].map(n=>({tone:n.dataset.tone,text:n.textContent}))})`, s => s?.actions === noticeFixture.actions + 1);
  assert.deepEqual(autosave.notices, []);
  noticeChecks.push({ check: 'Legal fixed H6 updates game while injected session-only autosave failure produces no popup', state: autosave, verificationOnlyTimerBoundary: 'Next 1100/1600ms robot timer deferred; no additional AI play or policy test', passed: true });
  console.log('Native fixed-play notification checks passed');
} catch (error) { errors.push(String(error.stack ?? error)); }
finally {
  try { await restore(); } catch (error) { errors.push('Original save restore failed: ' + String(error.stack ?? error)); }
  const result = { verifiedAt: new Date().toISOString(), status: errors.length ? 'failed' : 'passed',
    scope: 'Two approved pre-existing bidding positions, model setting rollback and return, lookahead disabled, and two fixed-play notification checks; no training, DDS or new strength batch.',
    boundary: 'Installed Android14 release WebView, normal production table robot timer; original fixed seed/dealer/vulnerability/hands and prefixes imported through the existing custom-setup persisted-session format. Prefix calls are fixtures.',
    originalRawSessionSha256: digest(backup.localStorage[key]), exactOriginalAndSettingsRestoredExceptLookahead: !errors.some(e => e.startsWith('Original save restore failed:')), settingsChecks, rows, noticeChecks, errors };
  writeFileSync(new URL('docs/NATIVE_ACTUAL_BIDDING_v3.3.0.json', root), JSON.stringify(result, null, 2) + '\n'); close(); assert.deepEqual(errors, []);
}
