"""Verify v0.3.7 observed evidence and exact desktop/APK bytes; fail closed."""
from pathlib import Path
from zipfile import ZipFile
from datetime import datetime, timezone
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT.parent / 'v0.3.7-mobile'
OUTPUT = ROOT / 'artifacts/delivery-verification.json'
evidence = {}

def sha(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

def read(path):
    path = Path(path)
    require(path.is_file(), f'Missing required evidence: {path}')
    evidence[str(path)] = sha(path)
    return json.loads(path.read_text(encoding='utf-8-sig'))

def report(name):
    return read(ROOT / 'artifacts' / name)

def verify():
    for name in ('v037-typecheck.json', 'v037-production-build.json', 'v037-match-unit-exit.json'):
        require(report(name).get('exitCode') == 0, f'{name}: actual exitCode must be 0')
    unit = report('v037-match-unit.json')
    require(unit.get('success') is True and unit.get('numTotalTests') == unit.get('numPassedTests') == 24,
            'Expected exactly 24 successful match unit tests')
    require(unit.get('numFailedTests') == unit.get('numPendingTests') == 0, 'Unit failures/skips present')
    require(all(t['status'] == 'passed' for f in unit['testResults'] for t in f['assertionResults']), 'Nonpassing unit case')
    for name, count in (('v037-pages-e2e.json', 6), ('v037-workbench-e2e.json', 3), ('production-workbench/results.json', 4)):
        data = report(name)
        require(not data.get('errors') and data['stats']['expected'] == count, f'{name}: wrong passing count/errors')
        require(all(data['stats'][key] == 0 for key in ('unexpected', 'skipped', 'flaky')), f'{name}: failed/skipped/flaky')
    score = report('score-columns/validation.json')
    require(score.get('revision') == 'score-columns-code44' and score.get('actualExitCode') == 0,
            'Current double-column score was not verified')
    require(score.get('tests') and all(t.get('status') == 'passed' for t in score['tests']), 'Score tests incomplete')
    require({(v['width'],v['height']) for v in score['viewports']} == {(360,800),(390,844),(844,390),(1280,800),(1440,900)},
            'Score viewport coverage incomplete')
    require(score.get('sourceSha256'), 'Current score fingerprints missing')
    for source,digest in score['sourceSha256'].items():
        require(sha(ROOT / source) == digest.lower(), f'Score evidence is stale: {source}')
    for row in score['screenshots']:
        path = ROOT / row['path']
        require(path.is_file(), f'Missing score screenshot: {path}')
        evidence[str(path)] = sha(path)
    regressions = report('score-columns/regressions/validation.json')
    require(regressions.get('actualExitCode') == 0 and regressions.get('sourceStableDuringRun') is True,
            'Current UI regressions did not complete against frozen source')
    for source,digest in regressions['sourceSha256'].items():
        require(sha(ROOT / source) == digest.lower(), f'Regression source changed: {source}')
    for name,count in {'side-suits':40,'fixed-seats':20,'ui-cleanup':4,'auction-scroll':5}.items():
        run = regressions['suites'][name]
        require(run['exitCode'] == 0, f'{name}: actual exit must be zero')
        raw = report(run['report'])
        require(not raw.get('errors') and raw['stats']['expected'] == count and
                all(raw['stats'][key] == 0 for key in ('unexpected','skipped','flaky')),
                f'{name}: regression failure or wrong count')
    production = report('score-columns/production/results.json')
    require(not production.get('errors') and production['stats']['expected'] == 1 and
            all(production['stats'][key] == 0 for key in ('unexpected', 'skipped', 'flaky')), 'Production full-board test failed')
    require(report('score-columns/production/exit.json').get('exitCode') == 0, 'Production test exit code is not zero')
    live = report('score-columns/production/live-report.json')
    require(live.get('passed') is True and live.get('plays') == 52 and live.get('tricks') == 13 and live.get('claim') is None,
            'Production board must really play all 52 cards')
    for source, digest in live['sourceSha256'].items():
        require(sha(ROOT / source) == digest.lower(), f'Production evidence is stale: {source}')
    core = report('core-preservation.json')
    require(core.get('unchangedCoreAiControllerPersistenceAndDds') is True and core.get('unexpectedChanges') == [],
            'Core preservation comparison failed')
    layout = report('workbench-layout-report.json')
    require(len(layout['report']) == 65 and layout['errors'] == [], 'Expected 65 clean workbench views')
    require(all(row['overflow'] == [] and row['outside'] == [] for row in layout['report']), 'Workbench overflow/outside controls')
    package = read(ROOT / 'package.json')
    lock = read(ROOT / 'package-lock.json')
    old_lock = read(ROOT.parent / 'v0.3.6/package-lock.json')
    require(package['version'] == lock['version'] == lock['packages']['']['version'] == '0.3.7', 'Package version mismatch')
    old_lock['version'] = old_lock['packages']['']['version'] = '0.3.7'
    require(lock == old_lock, 'Lockfile changed beyond the two root version fields')
    for key in ('dependencies', 'devDependencies'):
        require(package.get(key, {}) == lock['packages'][''].get(key, {}), f'{key} differs from lockfile')
    dist = ROOT / 'dist'
    html = (dist / 'index.html').read_bytes().decode('utf-8-sig')
    match = re.search(r'assets/(index-[\w-]+\.js)', html)
    require(match is not None, 'Desktop main bundle reference missing')
    main = match.group(1)
    main_sha = sha(dist / 'assets' / main)
    require('0.3.7' in (dist / 'assets' / main).read_text(encoding='utf-8'), 'Main JS has no 0.3.7 marker')
    sw = (dist / 'sw.js').read_text(encoding='utf-8')
    manifest = read(dist / 'manifest.webmanifest')
    require('0.3.7' in manifest['name'] and 'bridgelab-v0.3.7' in sw, 'PWA version mismatch')
    for pattern in ('worker-*.js', 'play-advisor-worker-*.js'):
        workers = list((dist / 'assets').glob(pattern))
        require(len(workers) == 1, f'Expected one {pattern}')
        worker = workers[0]
        require(f'assets/{worker.name}' in sw, f'Worker absent from offline precache: {worker.name}')
        text = worker.read_text(encoding='utf-8')
        require('AGFzbQ' in text and ('SolveBoard' in text or 'CalcDDtable' in text), f'Embedded DDS WASM missing: {worker.name}')
    validation = read(MOBILE / 'docs/VALIDATION.json')
    sync = read(MOBILE / 'docs/SYNC_MANIFEST.json')
    identity = read(MOBILE / 'docs/UPGRADE_SIGNATURE_VALIDATION.json')
    apk = MOBILE / 'release/BridgeLab-v0.3.7-mobile-android.apk'
    require(apk.is_file(), f'Missing final APK: {apk}')
    apk_sha = sha(apk)
    require(validation['sha256'] == identity['current']['sha256'] == apk_sha, 'APK evidence SHA mismatch')
    for row in (validation, identity['current']):
        require(row['applicationId'] == 'cn.bridgelab.v03mobile' and row['versionName'] == '0.3.7' and row['versionCode'] == 44,
                'APK application ID/version/code mismatch')
    require(all(identity.get(key) is True for key in ('sameApplicationId', 'samePublicCertificate', 'versionCodeIncreased')), 'Upgrade signature checks failed')
    previous = MOBILE / 'artifacts/previous-code43/release/BridgeLab-v0.3.7-mobile-android.apk'
    require(sha(previous) == identity['previous']['sha256'], 'Previous APK anchor changed')
    require(identity['previous']['applicationId'] == identity['current']['applicationId'] and
            identity['previous']['publicCertificateSha256'] == identity['current']['publicCertificateSha256'] and
            identity['previous']['versionCode'] == 43, 'Previous identity/certificate mismatch')
    require(sync['desktopVersion'] == '0.3.7' and sync['desktopMainBundle'] == validation['desktopMainBundle'] == main, 'Mobile main bundle differs')
    require(validation['desktopMainBundleSha256'] == validation['embeddedMainBundleSha256'] == main_sha, 'Recorded bundle hash mismatch')
    native = read(MOBILE / 'docs/NATIVE_PREPARATION_VALIDATION.json')
    require(native['dartFormatting']['passed'] is True and native['flutterAnalyze']['passed'] is True and
            native['flutterTests']['passed'] == 7 and native['flutterTests']['failed'] == 0 and
            native['nativeScriptChecks']['passed'] == 8 and native['nativeScriptChecks']['failed'] == 0,
            'Native preparation checks incomplete')
    recovery = read(MOBILE / 'docs/UPGRADE_RECOVERY_VALIDATION.json')
    require(recovery['currentBundle'] == main and recovery['errors'] == [] and
            all(recovery.get(k) is True for k in ('existingV036ArchiveUnchanged', 'rawV036UnchangedBeforeUserAction',
                'noV037StorageKeyCreated', 'offlineReloadAndContinuedBid', 'localStorageAndIndexedDbSentinelsPreserved')),
            'Old-cache upgrade recovery evidence incomplete')
    mobile_layout = read(MOBILE / 'docs/WEB_LAYOUT_VALIDATION.json')
    require(mobile_layout['desktopMainBundle'] == main and mobile_layout['mainBundleSha256'] == main_sha and
            {r['orientation'] for r in mobile_layout['results']} == {'portrait', 'landscape'}, 'Mobile layout bundle/orientations mismatch')
    for row in mobile_layout['results']:
        require(row['pageErrors'] == [] and row['tableSeatCount'] == 4 and
                all(row.get(k) is True for k in ('noDocumentScroll', 'tableInsideViewport', 'mobileCssLoaded',
                    'noHorizontalOverflow', 'homeNoHorizontalOverflow', 'setupNoHorizontalOverflow',
                    'historyNoHorizontalOverflow', 'impNoHorizontalOverflow', 'nativeBridgeArchiveRoundtrip')),
                'Mobile emulation layout failed')
    notes = read(MOBILE / 'docs/POSTBUILD_SOURCE_NOTES.json')
    require(notes['version'] == '0.3.7+44' and notes['finalApkSha256'] == apk_sha and notes['bundle'] == main and
            notes['runtimeSourceAndDistUnchanged'] is True, 'Postbuild source evidence mismatch')
    require(all(validation.get(k) is True for k in ('mainBundleHashMatch', 'desktopDistFilesPresent', 'unchangedDistFileHashesMatch')), 'Mobile asset checks failed')
    dist_files = {p.relative_to(dist).as_posix(): p for p in dist.rglob('*') if p.is_file()}
    rows = {r['path']: r for r in sync['desktopDistFiles']}
    require(set(rows) == set(dist_files) and len(rows) == len(sync['desktopDistFiles']), 'Desktop dist manifest incomplete/duplicated')
    with ZipFile(apk) as archive:
        require(archive.testzip() is None, 'APK CRC check failed')
        prefix = 'assets/flutter_assets/assets/www/'
        for name, path in dist_files.items():
            require(sha(path) == rows[name]['sha256'], f'Desktop asset changed after sync: {name}')
            data = archive.read(prefix + name)
            if name == 'index.html':
                expected = html.replace('</head>', '  <link rel="stylesheet" href="./mobile.css"></head>')
                require(data.decode('utf-8-sig') == expected, 'APK index differs beyond exact mobile CSS insertion')
            else:
                require(hashlib.sha256(data).hexdigest() == rows[name]['sha256'], f'APK asset hash mismatch: {name}')
        for name, digest in validation['mobileAssetHashes'].items():
            require(hashlib.sha256(archive.read(prefix + name)).hexdigest() == digest, f'Mobile asset mismatch: {name}')
    for name, path in dist_files.items():
        evidence[str(path)] = sha(path)
    evidence[str(apk)] = apk_sha
    return {'desktopMainBundle': main, 'desktopMainBundleSha256': main_sha, 'desktopDistFilesVerified': len(dist_files),
            'apk': str(apk), 'apkSha256': apk_sha, 'physicalAndroidDeviceTested': False}

if __name__ == '__main__':
    result = {'version': '0.3.7', 'verifiedAt': datetime.now(timezone.utc).isoformat(), 'passed': False}
    try:
        result.update(verify())
        result['passed'] = True
    except Exception as error:
        result['error'] = f'{type(error).__name__}: {error}'
    result['evidenceSha256'] = evidence
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
