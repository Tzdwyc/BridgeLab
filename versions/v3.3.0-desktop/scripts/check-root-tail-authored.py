import collections
import pathlib
import runpy
import sys

sys.argv = ['delta', 'summary', '--source', 'artifacts/v033-release6b-auctions.json', '--baseline', 'artifacts/v033-release5-auctions.json']
data = runpy.run_path('scripts/gpt-review-delta.py')
boards = data['source']['boards'][300:500]
expected = {(b['board'], s['step']) for b in boards for s in b['steps']}
required = {(b['board'], s['step']) for b in boards for s in b['steps'] if not data['reusable'](b, s)}
actual, duplicates, invalid = {}, [], []
counts = collections.Counter()
for line in pathlib.Path('artifacts/v033-release6b-root-tail200-authored.txt').read_text(encoding='utf-8-sig').splitlines():
    if not line.strip() or line.startswith('#'):
        continue
    board, steps, cv, mv, reason = line.split(' ', 4)
    for step in steps.split(','):
        key = int(board), int(step)
        if key in actual:
            duplicates.append(key)
        if key not in expected:
            invalid.append(key)
        actual[key] = cv, mv, reason
        counts[cv, mv] += 1
print({'boards': len(boards), 'totalSteps': len(expected), 'freshRequired': len(required), 'authored': len(actual), 'missing': sorted(required - actual.keys()), 'invalid': invalid, 'duplicates': duplicates, 'verdictCounts': {str(k): v for k, v in counts.items()}})
