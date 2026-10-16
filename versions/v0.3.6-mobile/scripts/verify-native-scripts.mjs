import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'lib/diagnostics.dart'), 'utf8');
const extract = name => {
  const found = source.match(new RegExp(`const ${name} = r'''([\\s\\S]*?)'''`));
  assert.ok(found, `Missing ${name}`);
  return found[1];
};
const primaryKey = 'bridgelab.session.v3.6';
const previousKey = 'bridgelab.session.v3.5';
const previousSave = JSON.stringify({ current: { board: 8, seed: 'preserved', actions: ['P'] }, history: [] });
const primarySave = JSON.stringify({ current: { board: 9, seed: 'current', actions: [] }, history: [] });
function storage(values) {
  return Object.assign({}, values, { getItem: key => values[key] ?? null });
}
function context(values = {}) {
  return vm.createContext({ URL, location: { href: 'http://127.0.0.1:51893/index.html', hash: '#table' },
    navigator: { userAgent: 'native-script-unit-test' }, document: { scripts: [], readyState: 'complete', body: { innerText: '' } },
    window: {}, console: { info() {}, error() {} }, localStorage: storage(values) });
}
const results = [];
for (const [label, values, expectedKey, expectedBoard] of [
  ['legacy save remains readable', { [previousKey]: previousSave }, previousKey, 8],
  ['current save has priority', { [primaryKey]: primarySave, [previousKey]: previousSave }, primaryKey, 9],
]) {
  const ctx = context(values);
  const before = JSON.stringify(ctx.localStorage);
  const details = JSON.parse(vm.runInContext(extract('pageDiagnosticsScript'), ctx));
  assert.equal(details.sessionKey, expectedKey);
  assert.equal(details.current.board, expectedBoard);
  const backup = JSON.parse(vm.runInContext(extract('savedGameBackupScript'), ctx));
  assert.equal(backup.previousRawSession, previousSave);
  assert.equal(JSON.stringify(ctx.localStorage), before);
  results.push({ check: label, passed: true });
}
const recovery = extract('packagedBundleRecoveryTemplate').replace('__EXPECTED_BUNDLE_JSON__', JSON.stringify('index-frozen.js'));
{
  const ctx = context({ [previousKey]: previousSave });
  let unregisterCount = 0, next;
  ctx.navigator.serviceWorker = { getRegistrations: async () => [{ unregister: async () => { unregisterCount++; } }] };
  ctx.location.replace = url => { next = url; };
  const before = JSON.stringify(ctx.localStorage);
  await vm.runInContext(recovery, ctx);
  assert.equal(unregisterCount, 1);
  assert.equal(new URL(next).searchParams.get('nativeBundle'), 'index-frozen.js');
  assert.equal(new URL(next).hash, '#table');
  assert.equal(JSON.stringify(ctx.localStorage), before);
  results.push({ check: 'outdated bundle unregisters SW and navigates once without storage writes', passed: true });
}
{
  const ctx = context();
  ctx.document.scripts = [{ src: 'http://127.0.0.1:51893/assets/index-frozen.js' }];
  await vm.runInContext(recovery, ctx);
  assert.equal(ctx.window.__bridgePackagedBundleVerified, true);
  results.push({ check: 'installed matching bundle passes without recovery', passed: true });
}
{
  const ctx = context();
  ctx.location.href += '?nativeBundle=index-frozen.js';
  let errors = 0;
  ctx.console.error = () => { errors++; };
  await vm.runInContext(recovery, ctx);
  assert.equal(errors, 1);
  results.push({ check: 'failed repeated recovery stops without redirect loop', passed: true });
}
const main = await readFile(resolve(root, 'lib/main.dart'), 'utf8');
{
  const filesSource = await readFile(resolve(root, 'lib/native_files.dart'), 'utf8');
  const script = filesSource.match(/const installNativeFilesScript = r'''([\s\S]*?)'''/)[1];
  const messages = [];
  const ctx = vm.createContext({ window: {}, BridgeLabFiles: { postMessage: message => messages.push(JSON.parse(message)) } });
  vm.runInContext(script, ctx);
  const saving = ctx.window.BridgeLabNativeFiles.saveFile('history.json', '{"history":[]}');
  assert.equal(messages[0].action, 'saveFile');
  assert.equal(messages[0].text, '{"history":[]}');
  ctx.window.__bridgeNativeFilesComplete({ id: messages[0].id, value: false });
  assert.equal(await saving, false);
  const opening = ctx.window.BridgeLabNativeFiles.openFile();
  assert.equal(messages[1].action, 'openFile');
  ctx.window.__bridgeNativeFilesComplete({ id: messages[1].id, value: { name: 'history.json', text: '{"history":[]}' } });
  assert.equal((await opening).name, 'history.json');
  const failing = ctx.window.BridgeLabNativeFiles.openFile();
  ctx.window.__bridgeNativeFilesComplete({ id: messages[2].id, error: 'document error' });
  await assert.rejects(failing, /document error/);
  vm.runInContext(script, ctx);
  results.push({ check: 'native file bridge export cancellation, import content, error propagation, and repeated installation', passed: true });
  const activity = await readFile(resolve(root, 'android/app/src/main/kotlin/cn/bridgelab/bridgelab_v03_mobile/MainActivity.kt'), 'utf8');
  assert.ok(activity.includes('Intent.ACTION_CREATE_DOCUMENT') && activity.includes('Intent.ACTION_OPEN_DOCUMENT'));
  assert.ok(activity.includes('openOutputStream(uri, "wt")') && activity.includes('openInputStream(uri)'));
  const manifest = await readFile(resolve(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(!manifest.includes('READ_EXTERNAL_STORAGE') && !manifest.includes('WRITE_EXTERNAL_STORAGE') && !manifest.includes('MANAGE_EXTERNAL_STORAGE'));
  assert.ok(main.includes("'BridgeLabFiles'") && main.includes('installNativeFilesScript'));
  results.push({ check: 'Android document-picker read/write paths and bridge wired without broad storage permissions (source check)', passed: true });
}
assert.ok(!main.includes('FloatingActionButton') && !main.includes('floatingActionButton:'));
assert.ok(main.includes('packagedBundleRecoveryScript(expectedBundle)') && main.includes('installErrorCaptureScript'));
assert.ok(main.indexOf('setState(() => _controller = controller)') < main.indexOf('controller.loadRequest(startUri)'));
assert.ok(main.includes("build['desktopVersion'] != '0.3.6'"));
results.push({ check: 'wrapper keeps silent recovery, binds controller before load, and has no floating diagnostics button', passed: true });
await writeFile(resolve(root, 'docs/NATIVE_SCRIPT_VALIDATION.json'), JSON.stringify({ verifiedAt: new Date().toISOString(),
  evidenceBoundary: 'Exact Dart JavaScript templates executed in Node VM with WebView API stubs; physical device not tested.', results }, null, 2));
console.log(`${results.length} native script and wrapper checks passed.`);
