"""Check original deal identity and source bytes only, never auction quality."""
import argparse
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--baseline', required=True)
parser.add_argument('--snapshot', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
source_path = root / args.source
source = json.loads(source_path.read_text(encoding='utf-8-sig'))
baseline = json.loads((root / args.baseline).read_text(encoding='utf-8-sig'))
manifest = json.loads((root / args.snapshot / 'manifest.json').read_text(encoding='utf-8'))
assert len(source['boards']) == len(baseline['boards']) == 2000
assert [b['board'] for b in source['boards']] == [b['board'] for b in baseline['boards']]
for new, old in zip(source['boards'], baseline['boards']):
    for field in ['board', 'seed', 'dealer', 'vulnerability']:
        assert new[field] == old[field], (new['board'], field)
    hands = lambda b: {s['seat']: s['hand'] for s in b['steps']}
    assert hands(new) == hands(old) and len(hands(new)) == 4, new['board']
digest = hashlib.sha256()
for name, expected in manifest['files'].items():
    current = (root / 'src' / 'ai' / name).read_bytes()
    frozen = (root / args.snapshot / name).read_bytes()
    assert current == frozen and hashlib.sha256(current).hexdigest() == expected, name
for name in ['bidding.ts', 'bidding-semantics.ts', 'competition.ts', 'systems.ts', 'suit-evaluation.ts']:
    digest.update(name.encode())
    digest.update((root / args.snapshot / name).read_bytes())
assert source['codeSha256'] == manifest['codeSha256'] == digest.hexdigest()
assert source['totalSteps'] == sum(len(b['steps']) for b in source['boards'])
result = {'boards': 2000, 'steps': source['totalSteps'], 'originalDealsIdentical': True,
          'recordedSourceMatchesFrozenAndCurrent': True, 'sourceSha256': digest.hexdigest(),
          'sourceObservationSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
          'purpose': 'Identity and byte provenance only; no bidding-quality verdict'}
(root / args.output).write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
