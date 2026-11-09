"""Count and join explicitly authored GPT reviews; never judge bidding quality."""
from pathlib import Path
import hashlib
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent.parent
source = root / 'artifacts/v033-baseline-auctions.json'
baseline = json.loads(source.read_text(encoding='utf-8'))
lock = json.loads((root / 'artifacts/v033-baseline-lock.json').read_text(encoding='utf-8'))
assert hashlib.sha256(source.read_bytes()).hexdigest() == lock['sha256'], 'Frozen baseline changed'
expected = {(b['board'], s['step']): s for b in baseline['boards'] for s in b['steps']}
counts = {b['board']: len(b['steps']) for b in baseline['boards']}
records = {}
files = []
reviewers = {}
for folder in sorted((root / 'artifacts').glob('v033-review-*')):
    if not folder.is_dir():
        continue
    reviewer_records = []
    for path in sorted(folder.glob('batch-*.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        assert data.get('sourceSha256', data.get('codeSha256')) == baseline['codeSha256'], str(path)
        rows = data.get('results')
        if rows is None:
            rows = [dict(s, board=b['board']) for b in data['boards'] for s in b['steps']]
        for row in rows:
            key = (row['board'], row['step'])
            assert key in expected and key not in records, f'Duplicate or unexpected review: {key}'
            for field in ['seat', 'hand', 'publicHistory', 'call', 'meaning']:
                assert row[field] == expected[key][field], f'Observation mismatch {key}/{field}'
            for field in ['callVerdict', 'meaningVerdict']:
                assert row[field] in {'ok', 'error', 'uncertain'}, f'Invalid verdict {key}/{field}'
            assert row['reason'].strip(), f'Missing GPT reason {key}'
            records[key] = dict(row, reviewer=folder.name)
            reviewer_records.append(key)
        files.append({'file': path.relative_to(root).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    reviewers[folder.name] = {'boards': len(set(k[0] for k in reviewer_records)), 'steps': len(reviewer_records)}
complete = [b for b, n in counts.items() if sum((b, s) in records for s in range(1, n + 1)) == n]
findings = [records[k] for k in sorted(records) if records[k]['callVerdict'] != 'ok' or records[k]['meaningVerdict'] != 'ok']
report = {'method': 'Counts of GPT-authored per-step judgments only; no automatic bidding-quality oracle.',
          'baselineSHA256': lock['sha256'], 'codeSha256': baseline['codeSha256'],
          'targetBoards': len(counts), 'targetSteps': len(expected), 'completedBoards': len(complete),
          'completedSteps': len(records), 'remainingBoards': len(counts) - len(complete),
          'complete': len(records) == len(expected), 'reviewers': reviewers, 'completeBoardIds': complete,
          'reviewFiles': files,
          'callErrors': sum(r['callVerdict'] == 'error' for r in records.values()),
          'meaningErrors': sum(r['meaningVerdict'] == 'error' for r in records.values()),
          'uncertainSteps': sum('uncertain' in (r['callVerdict'], r['meaningVerdict']) for r in records.values())}
(root / 'artifacts/v033-model-review-coverage.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
(root / 'artifacts/v033-model-review-findings.json').write_text(json.dumps(findings, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k not in {'completeBoardIds', 'reviewFiles'}}, ensure_ascii=False))
