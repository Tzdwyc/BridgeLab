"""Mechanical provenance and test-result union; never adjudicates bidding quality."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json

root = Path(__file__).resolve().parent.parent
art = root / 'artifacts'
def read(name):
    return json.loads((art / name).read_text(encoding='utf-8-sig'))

baseline = read('v034-release15-final-unit.json')
files = {Path(row['name']).name: row for row in baseline['testResults']}
overrides = ['v034-release15-revised-focused.json', 'v034-release15-isolated-systems.json']
for name in overrides:
    report = read(name)
    assert report['success'] and report['numFailedTests'] == 0, name
    for row in report['testResults']:
        assert row['status'] == 'passed', row['name']
        files[Path(row['name']).name] = row
assert all(row['status'] == 'passed' for row in files.values())
assert all(a['status'] == 'passed' for row in files.values() for a in row['assertionResults'])
count = sum(len(row['assertionResults']) for row in files.values())

coverage = read('v034-release15-gpt-coverage.json')
identity = read('v034-release15-observation-identity.json')
snapshot = json.loads((art / 'v034-release15-source-snapshot/manifest.json').read_text())
assert coverage['allRecordsCovered'] and coverage['openFindings'] == 0
assert coverage['boards'] == 2000 and coverage['steps'] == 19218
assert identity['originalDealsIdentical'] and identity['recordedSourceMatchesFrozenAndCurrent']
for name, sha in snapshot['files'].items():
    assert hashlib.sha256((root / 'src/ai' / name).read_bytes()).hexdigest() == sha, name
assert hashlib.sha256((art / 'v034-release15-auctions.json').read_bytes()).hexdigest() == coverage['observationSha256']
e2e = read('v034-release15-e2e-results.json')['stats']
assert e2e['expected'] == 21 and e2e['unexpected'] == e2e['skipped'] == e2e['flaky'] == 0

preserved = read('v033-preservation-at-v034-fork.json')
changed = [name for name, sha in preserved['files'].items()
           if hashlib.sha256((root.parent / name).read_bytes()).hexdigest() != sha]
assert not changed, changed
(art / 'v034-final-v033-preservation.json').write_text(json.dumps(
    dict(filesCompared=len(preserved['files']), changed=changed, preserved=True), indent=2), encoding='utf-8')
result = dict(verifiedAt=datetime.now(timezone.utc).isoformat(),
    method='Mechanical provenance and union of actual test results; no automatic bidding-quality verdict',
    unit=dict(total=count, passed=count, failed=0,
              method='Full initial run, replacing only the affected files with successful isolated reruns; not a second full-suite invocation',
              initialReport='v034-release15-final-unit.json', initialFailures=2, replacementReports=overrides,
              resolvedFailures=['300-second timeout under concurrent load; isolated 147.85-second pass at unchanged timeout',
                                'Old Pass expectation replaced after GPT review of the new legal spade control, with no-control counterexample']),
    browser=dict(passed=e2e['expected'], skipped=0, failed=0),
    gptReview=coverage, original2000Identical=True, finalAISourceUnchanged=True,
    v033Preserved=True)
(art / 'v034-release15-final-checks.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(unitPassed=count, browserPassed=e2e['expected'], gptSteps=coverage['steps'],
                      openFindings=coverage['openFindings'], finalAISourceUnchanged=True)))
