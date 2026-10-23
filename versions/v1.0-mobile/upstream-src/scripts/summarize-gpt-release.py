"""Count explicit GPT judgments and check their provenance; never judge bids."""
import argparse
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('generation')
args = parser.parse_args()
assert args.generation.startswith('v034-release') and args.generation.replace('-', '').isalnum()
source_path = root / 'artifacts' / f'{args.generation}-auctions.json'
source = json.loads(source_path.read_text(encoding='utf-8-sig'))
observation_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
expected = {(board['board'], step['step']): step
            for board in source['boards'] for step in board['steps']}
seen = set()
groups = []
findings = []
fresh = reused = 0
for name in ['root', 'core', 'meanings', 'competition']:
    path = root / 'artifacts' / f'{args.generation}-auctions-{name}-gpt-review.json'
    review = json.loads(path.read_text(encoding='utf-8-sig'))
    assert review['completed'], (name, review.get('missingSteps'))
    assert review['sourceSha256'] == source['codeSha256']
    assert review['sourceObservationSha256'] == observation_hash
    for row in review['rows']:
        key = row['board'], row['step']
        assert key in expected and key not in seen, key
        seen.add(key)
        for field in ['seat', 'hand', 'hcp', 'publicHistory', 'call', 'meaning']:
            assert row[field] == expected[key][field], (key, field)
        provenance = row['reviewProvenance']
        assert provenance in ['fresh-explicit-GPT', 'exact-observation-prior-GPT']
        fresh += provenance == 'fresh-explicit-GPT'
        reused += provenance == 'exact-observation-prior-GPT'
        if row['callVerdict'] != 'ok' or row['meaningVerdict'] != 'ok':
            findings.append(row)
    groups.append({key: review[key] for key in
                   ['reviewer', 'reviewedBoards', 'reviewedSteps', 'freshlyReviewedSteps']})
assert seen == set(expected) and len(seen) == source['totalSteps']
report = {
    'generation': args.generation, 'method': 'Counts and exact-record provenance only; no automatic quality verdicts',
    'allRecordsCovered': True, 'boards': len(source['boards']), 'steps': len(seen),
    'freshGPTSteps': fresh, 'exactPrefixPriorGPTSteps': reused,
    'openFindings': len(findings), 'affectedBoards': len({row['board'] for row in findings}),
    'sourceSha256': source['codeSha256'], 'observationSha256': observation_hash,
    'groups': groups,
}
for suffix, data in [('gpt-coverage', report), ('gpt-open-findings', {'steps': findings})]:
    (root / 'artifacts' / f'{args.generation}-{suffix}.json').write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
