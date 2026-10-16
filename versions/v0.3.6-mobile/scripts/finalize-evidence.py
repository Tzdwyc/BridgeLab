"""Finalize current APK evidence while retaining superseded candidate proofs."""
from pathlib import Path
import hashlib
import json
import re
import zipfile
from datetime import datetime, timezone

root = Path(__file__).resolve().parent.parent
desktop = root.parent / 'v0.3.6'
docs = root / 'docs'
read = lambda path: json.loads(Path(path).read_text(encoding='utf-8-sig'))
now = datetime.now(timezone.utc).isoformat()


def digest(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def write(name, value):
    (docs / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


validation = read(docs / 'VALIDATION.json')
apk = Path(validation['apk'])
assert digest(apk) == validation['sha256']
freeze = read(docs / 'DESKTOP_FREEZE.json')
for file in freeze['files']:
    assert digest(desktop / file['path']) == file['sha256'], file['path']
inputs = read(docs / 'MOBILE_BUILD_INPUTS.json')
for file in inputs['files']:
    assert digest(root / file['path']) == file['sha256'], file['path']
baseline = read(docs / 'PREPARATION.json')
for file in baseline['previousFiles']:
    assert digest(Path(baseline['sourceMobile']) / file['path']) == file['sha256'], file['path']
native = []
with zipfile.ZipFile(apk) as current, zipfile.ZipFile(root / 'artifacts/candidate1/release' / apk.name) as previous:
    for name in current.namelist():
        if re.fullmatch(r'classes\d*\.dex|lib/[^/]+/libapp\.so', name):
            with current.open(name) as handle:
                current_hash = hashlib.file_digest(handle, 'sha256').hexdigest()
            with previous.open(name) as handle:
                previous_hash = hashlib.file_digest(handle, 'sha256').hexdigest()
            assert current_hash == previous_hash, name
            native.append({'path': name, 'sha256': current_hash, 'sameAsCandidate1': True})
assert len(native) == 4
reuse = {
    'verifiedAt': now, 'nativeBuildInputsChecked': len(inputs['files']),
    'allRecordedInputsMatchCandidate1': True, 'nativeBinaryEntries': native,
    'reusedChecks': 'candidate1: format, Flutter analyze, 7 Flutter tests, 8 exact native-script tests',
    'candidate1Evidence': 'artifacts/candidate1/docs',
    'finalRechecked': 'release build, signatures/upgrade identity, APK asset/native strings, final mobile layouts/IMP score labels, native file JS integration, real old-SW recovery/direct history/offline continuation',
}
write('NATIVE_VALIDATION_REUSE.json', reuse)
assert digest(root / 'upstream-src/package-lock.json') == digest(desktop / 'package-lock.json')
candidate3_source = root / 'artifacts/candidate3/runtime-src'
runtime_changes = []
for file in sorted((root / 'upstream-src/src').rglob('*')):
    if file.is_file():
        relative = file.relative_to(root / 'upstream-src/src')
        previous = candidate3_source / relative
        if not previous.exists() or digest(previous) != digest(file):
            runtime_changes.append('src/' + relative.as_posix())
notes = {
    'verifiedAt': now, 'finalFreezeGeneration': freeze['freezeGeneration'],
    'frozenDesktopFilesChecked': len(freeze['files']), 'runtimeAndDistUnchangedSinceFinalFreeze': True,
    'finalCorrectedDesktopLockMatchesFrozenUpstream': True,
    'preservedCandidates': [f'artifacts/candidate{i}/PRESERVATION_MANIFEST.json' for i in [1, 2, 3]],
    'finalApkSha256': validation['sha256'], 'nativeBuildInputsAndBinaryEntriesUnchanged': True,
    'previousCode39AnchorFilesChecked': len(baseline['previousFiles']), 'previousMobileAnchorsUnchanged': True,
    'runtimeSourceChangesSinceCandidate3': runtime_changes,
    'changeBoundary': 'Historical explanation/version metadata are desktop runtime changes. Native wrapper, signing, origin and permissions are unchanged. Candidate1 preserves original pre-correction desktop lock metadata; final upstream source contains the corrected lock. Desktop lock is not an APK asset.',
    'physicalDeviceTested': False,
}
write('POSTBUILD_SOURCE_NOTES.json', notes)
layout = read(docs / 'WEB_LAYOUT_VALIDATION.json')
recovery = read(docs / 'UPGRADE_RECOVERY_VALIDATION.json')
assert layout['desktopMainBundle'] == validation['desktopMainBundle']
assert recovery['currentBundle'] == validation['desktopMainBundle']
assert recovery['directHistoryContainsMigratedArchive']
assert recovery['migratedArchiveCount'] == 1
readme = root / 'README.md'
text = readme.read_text(encoding='utf-8')
text = re.sub(r'\([\d,]+ bytes\)\. SHA-256: `[a-f0-9]{64}`',
              f"({validation['bytes']:,} bytes). SHA-256: `{validation['sha256']}`", text)
text = text.replace('The first internal candidate, including its original lockfile snapshot, assets, APK and evidence, is preserved under `artifacts/candidate1`.',
                    'Three superseded internal candidates and their original APK/proofs remain preserved under `artifacts/candidate1`, `artifacts/candidate2` and `artifacts/candidate3`.')
readme.write_text(text, encoding='utf-8')
report = docs / 'VALIDATION_REPORT.md'
with report.open('a', encoding='utf-8') as handle:
    handle.write('\n- All 26 native/build input hashes and all three native app libraries plus DEX match candidate1; unchanged native checks are reused explicitly.\n')
    handle.write('- Fresh final-bundle mobile portrait/landscape checks passed, including both teams IMP scores and net, exact native file JavaScript export/import and no horizontal overflow.\n')
    handle.write('- Real code-39 cached Workbox recovery passed direct-history migration (one legacy archive), Home Continue board20 and offline bidding with original save/backup and localStorage/IndexedDB sentinels retained.\n')
    handle.write('- Android installation, native WebView and the system document picker were not exercised on a physical device.\n')
print(json.dumps({'apk': str(apk), 'bytes': validation['bytes'], 'sha256': validation['sha256'],
                  'bundle': validation['desktopMainBundle'], 'nativeEntriesIdentical': len(native),
                  'nativeInputHashesChecked': len(inputs['files']), 'frozenDesktopFilesMatched': len(freeze['files']),
                  'runtimeChangesSinceCandidate3': runtime_changes}, ensure_ascii=False, indent=2))
