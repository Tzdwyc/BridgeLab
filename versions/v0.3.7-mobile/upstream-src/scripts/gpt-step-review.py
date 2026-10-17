"""Present auction observations and serialize explicit GPT judgments.

This utility checks record identity/coverage only. It contains no rule that
labels a bid or tooltip as good or bad, and supplies no default verdict.
"""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['show', 'save', 'coverage'])
parser.add_argument('--source', required=True)
parser.add_argument('--group', choices=['root', 'core', 'meanings', 'competition'])
parser.add_argument('--start', type=int, default=0)
parser.add_argument('--count', type=int, default=20)
parser.add_argument('--authored')
parser.add_argument('--output')
args = parser.parse_args()
source_path = ROOT / args.source
source = json.loads(source_path.read_text(encoding='utf-8-sig'))
groups = ['root', 'core', 'meanings', 'competition']
assert len(source['boards']) == 2000
offset = groups.index(args.group) * 500 if args.group else 0
assigned = source['boards'][offset:offset + 500] if args.group else source['boards']

if args.action == 'show':
    chosen = assigned[args.start:args.start + args.count]
    meanings = list(dict.fromkeys(s['meaning'] for b in chosen for s in b['steps']))
    print('CODE', source['codeSha256'], 'GROUP', args.group, 'POSITIONS', args.start, args.start + len(chosen))
    print('Meanings (exact strings; each step references its M number):')
    for index, text in enumerate(meanings):
        print(f'M{index}: {text}')
    for b in chosen:
        print(f"BOARD {b['board']} dealer={b['dealer']} vul={b['vulnerability']}")
        hands = {s['seat']: (s['hand'], s['hcp']) for s in b['steps']}
        print('HANDS', ' '.join(f'{seat}:{hand}[{hcp}]' for seat, (hand, hcp) in hands.items()))
        print('STEPS', ' '.join(f"{s['step']}:{s['seat']}:{s['call']}:M{meanings.index(s['meaning'])}" for s in b['steps']))
        print('RESULT', b['result'])
elif args.action == 'save':
    expected = {(b['board'], s['step']): (b, s) for b in assigned for s in b['steps']}
    authored = {}
    for line in (ROOT / args.authored).read_text(encoding='utf-8-sig').splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        bid, indices, cv, mv, reason = line.split(' ', 4)
        assert cv in {'ok', 'error', 'needs-system-definition'}
        assert mv in {'ok', 'error', 'needs-system-definition'}
        for step in indices.split(','):
            key = int(bid), int(step)
            assert key in expected, ('unexpected step', key)
            assert key not in authored, ('duplicate step', key)
            authored[key] = (cv, mv, reason)
    rows = []
    for key, (cv, mv, reason) in sorted(authored.items()):
        b, s = expected[key]
        rows.append({**s, 'board': b['board'], 'vulnerability': b['vulnerability'],
                     'callVerdict': cv, 'meaningVerdict': mv, 'reason': reason})
    report = {'sourceArtifact': args.source, 'sourceSha256': source['codeSha256'],
              'sourceObservationSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
              'reviewer': 'GPT-' + str(args.group), 'method': 'Explicit GPT step judgments; no automatic quality oracle',
              'completed': len(authored) == len(expected), 'expectedBoards': len(assigned),
              'reviewedBoards': len({r['board'] for r in rows}), 'reviewedSteps': len(rows),
              'missingSteps': sorted(set(expected) - set(authored)), 'rows': rows}
    (ROOT / args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: report[k] for k in ['completed', 'expectedBoards', 'reviewedBoards', 'reviewedSteps']}))
else:
    all_expected = {(b['board'], s['step']): s for b in source['boards'] for s in b['steps']}
    found = set()
    records = {}
    for group in groups:
        path = ROOT / 'artifacts' / f"{source_path.stem}-{group}-gpt-review.json"
        data = json.loads(path.read_text(encoding='utf-8-sig'))
        assert data['completed'] and data['sourceSha256'] == source['codeSha256']
        assert data['sourceObservationSha256'] == hashlib.sha256(source_path.read_bytes()).hexdigest()
        for r in data['rows']:
            key = r['board'], r['step']
            assert key not in found
            found.add(key)
            for field in ['seat', 'hand', 'hcp', 'publicHistory', 'call', 'meaning']:
                assert r[field] == all_expected[key][field], (key, field)
        records[group] = {'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                          'boards': data['reviewedBoards'], 'steps': data['reviewedSteps']}
    assert found == set(all_expected), ('missing or extra identities', len(found), len(all_expected))
    output = {'sourceArtifact': args.source, 'sourceSha256': source['codeSha256'],
              'sourceObservationSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
              'boards': len(source['boards']), 'steps': len(found), 'records': records,
              'purpose': 'Identity and coverage only; judgments explicitly authored by GPT'}
    (ROOT / args.output).write_text(json.dumps(output, indent=2), encoding='utf-8')
    print(json.dumps(output))
