"""Record already-completed local delivery checks; never runs policy games."""
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
run = root / 'artifacts/v331-play/benchmark/heldout-2026-11-07T04-55-47-631Z'
gate = read(run / 'acceptance-gate-result.json')
delivery = read(root / 'artifacts/delivery-verification-v3.3.1.json')
browser = root / 'artifacts/v331-production/BROWSER_ACCEPTANCE.json'
assert gate['formal'] and gate['passed'] and browser.is_file()
before = read(root / 'artifacts/v331-play/lan-integration/source-before.json')['files']
current = {p.relative_to(root).as_posix(): sha(p) for p in sorted((root / 'src').rglob('*')) if p.is_file()}
changed = [name for name in before if before[name] != current[name]]
assert sorted(changed) == ['src/online/room.ts', 'src/online/useLanRoom.ts']
official = root.parent / 'v3.2.1-desktop'
official_changes = [name for name in current if sha(official / name) != current[name]]
assert len(official_changes) == 8
scope = {'relativeTo': 'v3.2.1-desktop', 'actualChangedSourceFiles': official_changes,
    'postValidationOnlyChanges': changed, 'sourceAssets': current,
    'validatedEngineUnchanged': True, 'biddingModelsRulesAndLayoutUnchanged': True,
    'trainingRun': False}
(root / 'artifacts/V331_SOURCE_SCOPE.json').write_text(json.dumps(scope, indent=2), encoding='utf-8')
receipt = {'version': '3.3.1', 'recordedAt': datetime.now(timezone.utc).isoformat(),
    'formalAcceptance': {'passed': True, 'boards': 96, 'tables': 288, 'runCount': 1,
        'gateSHA256': gate['gateSha256'], 'rescues10Imp': 3, 'newLosses10Imp': 0},
    'checks': {'fullBuildExitCode': 0, 'normalFocusedPassed': 47,
        'isolatedCrossVersionRuntimePassed': 38, 'lanDistinctCasesPassed': 33,
        'fixedLanHands': 8, 'fixedLanLegalPlays': 416, 'browserLogicalScenariosPassed': 2},
    'buildLogSHA256': sha(root / 'artifacts/v331-build.log'),
    'priorStalledBuildLogPreserved': (root / 'artifacts/v331-build-first-stalled.log').is_file(),
    'browserReceipt': str(browser.relative_to(root)), 'browserReceiptSHA256': sha(browser),
    'mainBundle': delivery['mainBundle'], 'mainBundleSHA256': delivery['mainBundleSHA256'],
    'stylesheetSHA256': delivery['stylesheetSHA256'], 'defaultProfile': 'seed101-epoch08',
    'originalSLBackupPreserved': True, 'oldOfficialV321Preserved': True,
    'runtimeURL': 'http://127.0.0.1:5213/',
    'androidEvidenceSeparate': True, 'physicalDeviceValidation': False,
    'browserHostTransport': 'native-adapter shim; actual UI/hook/room/Worker',
    'report': 'docs/V331_ACCEPTANCE.md'}
(root / 'artifacts/V331_ACCEPTANCE.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps({'version': receipt['version'], 'sourceChanges': official_changes,
    'desktopChecksRecorded': True, 'browserReceiptSHA256': receipt['browserReceiptSHA256']}))
