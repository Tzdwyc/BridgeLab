import 'package:bridgelab_v03_mobile/diagnostics.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('keeps bounded real messages and includes original exception text', () {
    final log = DiagnosticMessages();
    for (var i = 0; i < 35; i++) {
      log.add('error', 'TypeError $i: read of undefined');
    }
    expect(log.entries, hasLength(30));
    expect(log.entries.first, contains('TypeError 5:'));
    expect(log.report('board=8'), contains('TypeError 34: read of undefined'));
    expect(log.report('board=8'), contains('board=8'));
  });
  test('decodes quoted and already decoded platform JavaScript values', () {
    expect(decodedJavaScriptText('"hello\\nworld"'), 'hello\nworld');
    expect(decodedJavaScriptText('hello'), 'hello');
    expect(readableJavaScriptJson('{"board":8}'), contains('"board": 8'));
  });
  test(
    'bundle recovery checks the installed build without clearing save data',
    () {
      final script = packagedBundleRecoveryScript('index-fixed.js');
      expect(script, contains('"index-fixed.js"'));
      expect(script, isNot(contains('__EXPECTED_BUNDLE_JSON__')));
      expect(script, contains('registration.unregister()'));
      expect(script, contains('location.replace(next.href)'));
      expect(script, contains('nativeBundle'));
      expect(script, contains('next.hash = location.hash'));
      expect(script, isNot(contains('localStorage.')));
      expect(script, isNot(contains('indexedDB.')));
      expect(script, isNot(contains('caches.delete')));
    },
  );
  test(
    'page probe and backup preserve save storage without write operations',
    () {
      expect(pageDiagnosticsScript, contains('bridgelab.session.v3.6'));
      expect(pageDiagnosticsScript, contains('bridgelab.session.v3.5'));
      expect(savedGameBackupScript, contains('bridgelab.session.v3.6'));
      expect(savedGameBackupScript, contains('bridgelab.session.v3.5'));
      expect(savedGameBackupScript, contains('previousRawSession'));
      expect(savedGameBackupScript, contains('rawSession'));
      expect(
        savedGameBackupScript,
        contains('BridgeLab-v036-diagnostic-backup'),
      );
      for (final script in [pageDiagnosticsScript, savedGameBackupScript]) {
        expect(script, isNot(contains('bridgelab.session.v3.4')));
        expect(script, isNot(contains('setItem')));
        expect(script, isNot(contains('removeItem')));
        expect(script, isNot(contains('.clear(')));
      }
    },
  );
}
