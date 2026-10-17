import 'dart:convert';

/// In-memory diagnostic messages only; no game data is replaced or removed.
class DiagnosticMessages {
  final List<String> entries = [];

  void add(String level, String message) {
    final bounded = message.length > 4000
        ? '${message.substring(0, 4000)} [truncated]'
        : message;
    entries.add('${DateTime.now().toIso8601String()} [$level] $bounded');
    if (entries.length > 30) entries.removeAt(0);
  }

  String report(String pageDetails) => [
    'BridgeLab v0.3.7 Android recovery diagnostics 2026-10-17',
    'Application ID, signing identity and local origin retained; v3.5 saves remain readable.',
    '--- Page and saved-game context ---',
    pageDetails,
    '--- Native WebView console (last 30 messages) ---',
    if (entries.isEmpty) 'No console message captured yet.',
    ...entries,
  ].join('\n');
}

String decodedJavaScriptText(Object value) {
  final text = value.toString();
  try {
    final decoded = jsonDecode(text);
    if (decoded is String) return decoded;
  } catch (_) {
    // Some platforms already return an unquoted JavaScript string.
  }
  return text;
}

String readableJavaScriptJson(Object value) {
  final text = decodedJavaScriptText(value);
  try {
    return const JsonEncoder.withIndent('  ').convert(jsonDecode(text));
  } catch (_) {
    return text;
  }
}

// Read only. Deliberately do not replay, repair, overwrite or delete the save.
const pageDiagnosticsScript = r'''
(() => {
  const out = {url: location.href, userAgent: navigator.userAgent,
    moduleScripts: Array.from(document.scripts || []).map(script => script.src).filter(Boolean),
    serviceWorker: navigator.serviceWorker && navigator.serviceWorker.controller
      ? navigator.serviceWorker.controller.scriptURL : null,
    packagedBundleVerified: window.__bridgePackagedBundleVerified === true,
    readyState: document.readyState, errorPage: document.body ?
      document.body.innerText.includes('暂时无法显示牌桌') : false,
    javascriptErrors: window.__bridgeDiagnosticErrors || []};
  try {
    const primaryKey = 'bridgelab.session.v3.6', previousKey = 'bridgelab.session.v3.5';
    const primary = localStorage.getItem(primaryKey);
    const raw = primary || localStorage.getItem(previousKey);
    out.sessionKey = primary ? primaryKey : (raw ? previousKey : primaryKey);
    out.savedChars = raw ? raw.length : 0;
    out.sessionKeys = Object.keys(localStorage).filter(key => key.startsWith('bridgelab.session.v'));
    if (raw) {
      const saved = JSON.parse(raw), current = saved.current;
      out.current = current ? {board: current.board, seed: current.seed,
        actionCount: current.actions ? current.actions.length : null,
        lastActions: current.actions ? current.actions.slice(-8) : null} : null;
      out.completedBoardCount = Array.isArray(saved.history) ? saved.history.length : null;
      out.biddingSystem = saved.gameSystem;
      out.playStrength = saved.playStrength;
    }
  } catch (error) { out.storageReadError = String(error); }
  return JSON.stringify(out);
})()
''';

const savedGameBackupScript = r'''
JSON.stringify({format: 'BridgeLab-v036-diagnostic-backup', version: 1,
  capturedAt: new Date().toISOString(),
  sessionKey: 'bridgelab.session.v3.6',
  rawSession: localStorage.getItem('bridgelab.session.v3.6'),
  previousSessionKey: 'bridgelab.session.v3.5',
  previousRawSession: localStorage.getItem('bridgelab.session.v3.5')})
''';

String packagedBundleRecoveryScript(String expectedBundle) =>
    packagedBundleRecoveryTemplate.replaceAll(
      '__EXPECTED_BUNDLE_JSON__',
      jsonEncode(expectedBundle),
    );

// A previous service worker can still serve the broken old HTML on an APK
// update. Remove only its registration, then navigate once to the bundled
// build. No localStorage, IndexedDB or saved-game value is removed or changed.
const packagedBundleRecoveryTemplate = r'''
(async () => {
  const expected = __EXPECTED_BUNDLE_JSON__;
  const found = Array.from(document.scripts || []).some(script =>
    script.src && new URL(script.src, location.href).pathname.endsWith('/assets/' + expected));
  if (found) {
    window.__bridgePackagedBundleVerified = true;
    return;
  }
  const next = new URL('index.html', location.href);
  if (new URL(location.href).searchParams.get('nativeBundle') === expected) {
    console.error('Packaged bundle verification failed after recovery: ' + expected);
    return;
  }
  console.info('Refreshing the installed BridgeLab bundle; saved games retained.');
  if (navigator.serviceWorker) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  }
  next.searchParams.set('nativeBundle', expected);
  next.hash = location.hash;
  location.replace(next.href);
})().catch(error => console.error('Packaged bundle recovery: ' + (error.stack || error)));
''';

// Installed after every navigation. The native console handler is installed
// before loading and captures initial render errors as well.
const installErrorCaptureScript = r'''
(() => {
  if (window.__bridgeDiagnosticCaptureInstalled) return;
  window.__bridgeDiagnosticCaptureInstalled = true;
  window.__bridgeDiagnosticErrors = [];
  const record = (kind, error) => {
    const text = error && error.stack ? String(error.stack) : String(error);
    window.__bridgeDiagnosticErrors.push({kind, message: text.slice(0, 8000)});
    if (window.__bridgeDiagnosticErrors.length > 10) window.__bridgeDiagnosticErrors.shift();
  };
  window.addEventListener('error', event => record('window.error', event.error || event.message));
  window.addEventListener('unhandledrejection', event => record('promise', event.reason));
  const originalError = console.error;
  console.error = function() {
    for (let i = 0; i < arguments.length; i++) record('console.error', arguments[i]);
    return originalError.apply(console, arguments);
  };
})()
''';
