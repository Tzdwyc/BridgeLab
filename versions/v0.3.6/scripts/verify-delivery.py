"""Verify observed test generations and exact desktop/APK bytes before packaging."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import re

root = Path(__file__).resolve().parent.parent
mobile = root.parent / 'v0.3.6-mobile'
def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

assert read(root / 'artifacts/v036-final-unit-exit.json')['exitCode'] == 0
unhandled = read(root / 'artifacts/v036-unit-unhandled.json')
assert not unhandled['errors'] and not unhandled['stateErrors']
unit = {}
unit_generations = ['v036-final-unit-results.json', 'v036-final-core-results.json']
for name in unit_generations:
    data = read(root / 'artifacts' / name)
    assert data['numFailedTests'] == 0 and not data['numPendingTests']
    for file in data['testResults']:
        occurrences = {}
        for test in file['assertionResults']:
            assert test['status'] == 'passed', (name, test['fullName'])
            title = test['fullName']
            occurrences[title] = occurrences.get(title, 0) + 1
            unit[(file['name'], title, occurrences[title])] = True

assert read(root / 'artifacts/e2e-v036-complete-33-exit.json')['exitCode'] == 0
assert read(root / 'artifacts/v036-final-e2e-exit.json')['exitCode'] == 0
ui = {}
def collect(suites):
    for suite in suites:
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                assert test['status'] == 'expected'
                assert all(run['status'] == 'passed' and not run['errors'] for run in test['results'])
                ui[(spec['file'], spec['title'], test['projectId'])] = True
        collect(suite.get('suites', []))
ui_generations = ['e2e-v036-complete-33.json', 'e2e-v036-results.json']
for name in ui_generations:
    data = read(root / 'artifacts' / name)
    assert not data['errors'] and data['stats']['unexpected'] == 0
    assert data['stats']['skipped'] == 0 and data['stats']['flaky'] == 0
    collect(data['suites'])
typecheck = root / 'artifacts/typecheck-final-exit.json'
assert read(typecheck)['exitCode'] == 0
assert typecheck.stat().st_mtime >= max(p.stat().st_mtime for p in (root / 'src').rglob('*') if p.is_file())

html = (root / 'dist/index.html').read_text(encoding='utf-8')
main = re.search(r'assets/(index-[\w-]+\.js)', html).group(1)
main_sha = sha(root / 'dist/assets' / main)
build = read(mobile / 'docs/VALIDATION.json')
assert build['desktopMainBundle'] == main
assert build['embeddedMainBundleSha256'] == main_sha
apk = mobile / 'release/BridgeLab-v0.3.6-mobile-android.apk'
assert sha(apk) == build['sha256']
identity = read(mobile / 'docs/UPGRADE_SIGNATURE_VALIDATION.json')
assert identity['current']['sha256'] == build['sha256']
assert identity['sameApplicationId'] and identity['samePublicCertificate'] and identity['versionCodeIncreased']
assert identity['current']['versionName'] == '0.3.6' and identity['current']['versionCode'] == 40
with ZipFile(apk) as z:
    embedded = z.read('assets/flutter_assets/assets/www/assets/' + main)
    assert hashlib.sha256(embedded).hexdigest() == main_sha
    assert all('lib/' + abi + '/libapp.so' in z.namelist() for abi in ['arm64-v8a', 'armeabi-v7a', 'x86_64'])

preservation = read(root / 'artifacts/v035-preservation-before.json')
assert all(sha(item['path']) == item['sha256'].lower() for item in preservation)
assert not read(root / 'artifacts/preservation-and-ai-identity.json')['changedAI']
assert not read(root / 'artifacts/dependency-lock-validation.json')['differentDependencies']
report = {
    'version': '0.3.6', 'uniquePassedUnitCases': len(unit), 'uniquePassedUiCases': len(ui),
    'unitGenerations': unit_generations, 'uiGenerations': ui_generations,
    'generationBoundary': 'Full 2277-case unit and 33-case UI generations plus focused final affected-code reruns; counts deduplicated, not summed.',
    'nativeExitCodes': 0, 'unhandledErrors': 0, 'mainBundle': main, 'mainBundleSha256': main_sha,
    'apk': str(apk), 'apkSha256': build['sha256'], 'protectedFilesUnchanged': len(preservation),
    'androidPhysicalDevice': 'not tested', 'androidSafPickerOnDevice': 'not tested'
}
(root / 'artifacts/delivery-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
