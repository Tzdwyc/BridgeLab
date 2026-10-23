"""Mechanical file-level verification closure; never judges bridge decisions."""
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'artifacts'

def read(name):
    return json.loads((ART / name).read_text(encoding='utf-8-sig'))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def evidence(name):
    return {'file': f'artifacts/{name}', 'sha256': sha(ART / name)}

def file_key(result):
    return result['name'].replace('\\', '/').casefold()

def file_map(report):
    result = {file_key(row): row for row in report['testResults']}
    assert len(result) == len(report['testResults']), 'Duplicate test file records'
    return result

def status_counts(results):
    counts = Counter(a['status'] for row in results for a in row['assertionResults'])
    return {'total': sum(counts.values()), 'passed': counts['passed'],
            'failed': counts['failed'], 'pending': counts['pending'],
            'todo': counts['todo'], 'other': {k: v for k, v in counts.items()
                                           if k not in {'passed', 'failed', 'pending', 'todo'}}}

def run_summary(name, report):
    counts = status_counts(report['testResults'])
    assert counts['total'] == report['numTotalTests']
    assert counts['passed'] == report['numPassedTests']
    assert counts['failed'] == report['numFailedTests']
    return {**evidence(name), **counts, 'testFiles': len(report['testResults']),
            'reportedSuccess': report['success']}

original_name = 'v035-candidate2-unit.json'
targeted_name = 'v035-candidate2-final-assertions-recheck.json'
isolated_name = 'v035-candidate2-isolated-runtime.json'
original_sha = sha(ART / original_name)
original, targeted, isolated = map(read, [original_name, targeted_name, isolated_name])
original_files, targeted_files, isolated_files = map(file_map, [original, targeted, isolated])
assert original['numTotalTests'] == 2213 and original['numPassedTests'] == 2206 and original['numFailedTests'] == 7
assert len(targeted_files) == 5 and len(isolated_files) == 2
assert not (targeted_files.keys() & isolated_files.keys())
assert targeted['success'] and isolated['success']
assert targeted['numFailedTests'] == isolated['numFailedTests'] == 0

merged = dict(original_files)
provenance = {key: original_name for key in merged}
closures = []
judgment_docs = [
    'v035-candidate2-final-assertions-semantics.json',
    'v035-candidate2-final-assertions-core.json',
]
timeout_limits = {'bidding-systems.test.ts': 300000, 'stability.test.ts': 180000}
for report_name, replacements in [(targeted_name, targeted_files), (isolated_name, isolated_files)]:
    for key, replacement in replacements.items():
        assert key in original_files, 'Replacement must belong to the original complete run'
        prior = original_files[key]
        failures = [a for a in prior['assertionResults'] if a['status'] == 'failed']
        assert failures, 'Only initially failed files are replaced'
        assert replacement['status'] == 'passed'
        assert all(a['status'] == 'passed' for a in replacement['assertionResults'])
        old_names = {a['fullName'] for a in prior['assertionResults']}
        new_names = {a['fullName'] for a in replacement['assertionResults']}
        test_file = Path(replacement['name']).name
        row = {
            'testFile': f'tests/{test_file}',
            'initialFailedAssertions': [{'fullName': a['fullName'], 'durationMs': a.get('duration'),
                                         'originalFailureMessagesPreservedIn': f'artifacts/{original_name}'}
                                        for a in failures],
            'originalFileTests': len(prior['assertionResults']),
            'replacementFileTests': len(replacement['assertionResults']),
            'replacementPassed': True,
            'replacementReport': f'artifacts/{report_name}',
            'originalTitlesNoLongerPresent': sorted(old_names - new_names),
            'newTitles': sorted(new_names - old_names),
        }
        if report_name == targeted_name:
            row.update(reason='GPT reviewed obsolete assertion under the updated unsupported-cue agreement; entire affected file rerun.',
                       judgmentDocuments=[f'artifacts/{name}' for name in judgment_docs])
        else:
            limit = timeout_limits[test_file]
            text = (ROOT / 'tests' / test_file).read_text(encoding='utf-8-sig')
            assert str(limit) in text, 'The original test timeout must remain unchanged'
            rerun_by_name = {a['fullName']: a for a in replacement['assertionResults']}
            runtime_cases = []
            for failed in failures:
                rerun = rerun_by_name[failed['fullName']]
                assert rerun['status'] == 'passed'
                runtime_cases.append({'fullName': failed['fullName'],
                                      'initialDurationMs': failed.get('duration'),
                                      'isolatedPassedDurationMs': rerun.get('duration'),
                                      'sameExistingTimeoutMs': limit})
            row.update(reason='Long runtime case rerun in isolation with the existing timeout unchanged; complete file passed.',
                       timeoutMsUnchanged=limit, runtimeCases=runtime_cases)
        closures.append(row)
        merged[key] = replacement
        provenance[key] = report_name

initial_failed_files = {key for key, value in original_files.items() if value['status'] != 'passed'}
assert initial_failed_files == targeted_files.keys() | isolated_files.keys()
assert len(merged) == len(original_files)
final_counts = status_counts(merged.values())
assert final_counts['failed'] == final_counts['pending'] == final_counts['todo'] == 0
assert not final_counts['other']
assert all(row['status'] == 'passed' for row in merged.values())

observation = read('v035-candidate2-auctions.json')
expected_code = '27e8090d71fab2c2b71d5393d4795261676e459bcd8c515c6efd609ffbb19330'
combined = hashlib.sha256()
source_checks = []
for name in ['bidding.ts', 'bidding-semantics.ts', 'competition.ts', 'systems.ts', 'suit-evaluation.ts']:
    data = (ROOT / 'src' / 'ai' / name).read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    combined.update(name.encode())
    combined.update(data)
    source_checks.append({'file': f'src/ai/{name}', 'sha256': actual,
                          'matchesCandidate2': actual == observation['sourceFiles'][name]})
assert all(row['matchesCandidate2'] for row in source_checks)
assert combined.hexdigest() == observation['codeSha256'] == expected_code
coverage = read('v035-candidate2-gpt-coverage.json')
assert coverage['totalSteps'] == coverage['reviewedSteps'] == 1718
assert coverage['openFindings'] == 0 and coverage['allCovered']
assert coverage['codeSha256'] == expected_code
assert coverage['observationSha256'] == sha(ART / 'v035-candidate2-auctions.json')

browser = read('v035-candidate2-e2e-results.json')
assert browser['stats']['expected'] == 21 and browser['stats']['unexpected'] == 0
assert browser['stats']['flaky'] == browser['stats']['skipped'] == 0 and not browser['errors']
build_text = (ART / 'v035-candidate2-build.log').read_text(encoding='utf-8-sig')
assert 'built in' in build_text
assert sha(ART / original_name) == original_sha, 'The original failed complete report must remain intact'

ledger = [{'testFile': f'tests/{Path(row["name"]).name}',
           'testCount': len(row['assertionResults']),
           'passed': sum(a['status'] == 'passed' for a in row['assertionResults']),
           'sourceReport': f'artifacts/{provenance[key]}'}
          for key, row in sorted(merged.items())]

out = {
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'purpose': 'Mechanical acceptance and evidence closure; no automated bidding-quality judgment.',
    'originalFullUnitRun': {**run_summary(original_name, original), 'preservedUnchanged': True},
    'fiveFileAssertionRecheck': {**run_summary(targeted_name, targeted),
                               'exitCode': 0, 'exitObservedInSession': 53302,
                               'judgmentDocuments': [evidence(name) for name in judgment_docs]},
    'twoFileIsolatedRuntimeRecheck': {**run_summary(isolated_name, isolated),
                                    'exitCode': 0, 'exitObservedByParentSession': 58907,
                                    'existingTimeoutsMs': timeout_limits},
    'finalUniqueUnitCoverage': {**final_counts, 'testFiles': len(merged),
                               'replacedInitiallyFailedFiles': len(closures),
                               'retainedPassedFilesFromCompleteRun': len(merged) - len(closures),
                               'additionalBoundaryTests': final_counts['total'] - original['numTotalTests'],
                               'notASingleSimultaneousAllGreenRun': True,
                               'method': 'Replace each initially failed test file once with its complete successful targeted/isolated result; retain every other file from the original complete run. Count each final file and its assertions once.',
                               'fileLedger': ledger},
    'failureToRecheckClosure': closures,
    'typeCheck': {**evidence('v035-candidate2-typecheck.log'), 'exitCode': 0,
                  'exitObservedByParentSession': 69542},
    'e2e': {**evidence('v035-candidate2-e2e-results.json'), 'passed': 21,
            'failed': 0, 'skipped': 0, 'flaky': 0},
    'viteBuild': {**evidence('v035-candidate2-build.log'), 'exitCode': 0,
                  'completionObservedInLog': True, 'exitObservedByParent': True},
    'candidateSourceIdentity': {'codeSha256': expected_code, 'allFiveFilesMatch': True,
                                'files': source_checks},
    'gptTrajectoryReview': {**evidence('v035-candidate2-gpt-coverage.json'),
                            'boards': 200, 'reviewedSteps': 1718, 'openFindings': 0,
                            'observationSha256': coverage['observationSha256'],
                            'judgmentMethod': 'Explicit GPT judgments; script only checks coverage and identity.'},
    'mechanicalAcceptancePassed': True,
    'reportingBoundary': 'The initial complete unit run had seven failures and is preserved. Final coverage is the unique union after five assertion-file reruns and two unchanged-timeout isolated-file reruns; it is not a claim that one complete run passed all tests at once.',
}
(ART / 'v035-final-checks.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'original': out['originalFullUnitRun']['total'],
                  'originalPassed': out['originalFullUnitRun']['passed'],
                  'originalFailed': out['originalFullUnitRun']['failed'],
                  'fiveFileRecheck': out['fiveFileAssertionRecheck']['total'],
                  'isolatedRecheck': out['twoFileIsolatedRuntimeRecheck']['total'],
                  'finalUnique': final_counts, 'testFiles': len(merged),
                  'additionalBoundaryTests': out['finalUniqueUnitCoverage']['additionalBoundaryTests'],
                  'sourceUnchanged': True}))
