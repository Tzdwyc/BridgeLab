"""Present changed observations and serialize explicit GPT re-adjudications.

Unchanged observations can retain prior explicit GPT judgments. They are labelled
as reused, never as fresh review. Non-OK prior judgments always require explicit
re-adjudication even if the observation is unchanged. No bidding-quality rules.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['show', 'save', 'summary'])
parser.add_argument('--source', required=True)
parser.add_argument('--baseline', required=True)
parser.add_argument('--group', choices=['root', 'core', 'meanings', 'competition'])
parser.add_argument('--start', type=int, default=0)
parser.add_argument('--count', type=int, default=20)
parser.add_argument('--authored')
parser.add_argument('--output')
parser.add_argument('--compact', action='store_true', help='Omit repeated old reasons from presentation, never from verdict records')
args = parser.parse_args()
groups = ['root', 'core', 'meanings', 'competition']
source_path, baseline_path = ROOT / args.source, ROOT / args.baseline
source, baseline = [json.loads(p.read_text(encoding='utf-8-sig')) for p in [source_path, baseline_path]]
baseline_observation_sha256 = hashlib.sha256(baseline_path.read_bytes()).hexdigest()
assert [b['board'] for b in source['boards']] == [b['board'] for b in baseline['boards']]
fields = ['seat', 'hand', 'hcp', 'publicHistory', 'call', 'meaning']
prior = {}
for group in groups:
    path = ROOT / 'artifacts' / f'{baseline_path.stem}-{group}-gpt-review.json'
    review = json.loads(path.read_text(encoding='utf-8-sig'))
    assert review['completed'] and review['sourceObservationSha256'] == baseline_observation_sha256
    for row in review['rows']:
        prior[row['board'], row['step']] = row
baseline_boards = {b['board']: b for b in baseline['boards']}
def reusable(board, step):
    old = prior.get((board['board'], step['step']))
    if not old or not all(old[f] == step[f] for f in fields) or old['callVerdict'] != 'ok' or old['meaningVerdict'] != 'ok':
        return False
    # A unchanged current tooltip cannot hide a changed meaning earlier in its
    # public prefix. Reuse requires the complete preceding observations too.
    old_prefix = baseline_boards[board['board']]['steps'][:step['step']]
    new_prefix = board['steps'][:step['step']]
    return len(old_prefix) == len(new_prefix) and all(
        all(a[f] == b[f] for f in fields) for a, b in zip(old_prefix, new_prefix))

if args.action == 'summary':
    changed = [(b['board'], s['step']) for b in source['boards'] for s in b['steps'] if not reusable(b, s)]
    print(json.dumps({'boards': len(source['boards']), 'steps': source['totalSteps'],
                      'requireExplicitReAdjudication': len(changed),
                      'boardsRequiringReAdjudication': len(set(b for b, _ in changed))}))
else:
    offset = groups.index(args.group) * 500
    assigned = source['boards'][offset:offset + 500]
    if args.action == 'show':
        chosen = assigned[args.start:args.start + args.count]
        changed_boards = [b for b in chosen if any(not reusable(b, s) for s in b['steps'])]
        # A fresh decision must be read with every preceding public meaning,
        # even when those preceding judgments can be reused. For example,
        # a GF repeat can retain five cards while a quiet NF repeat shows six.
        # This presents evidence only; it does not judge bidding quality.
        dictionary = list(dict.fromkeys(s['meaning'] for b in changed_boards for s in b['steps']))
        print('CODE', source['codeSha256'], 'GROUP', args.group, 'POSITIONS', args.start, args.start + len(chosen))
        for i, text in enumerate(dictionary):
            print(f'M{i}: {text}')
        for b in chosen:
            todo = [s for s in b['steps'] if not reusable(b, s)]
            if not todo:
                print('UNCHANGED-EXACT-PRIOR-GPT-OK', b['board'])
                continue
            print('BOARD', b['board'], 'dealer', b['dealer'], 'vul', b['vulnerability'])
            hands = {s['seat']: (s['hand'], s['hcp']) for s in b['steps']}
            print('HANDS', ' '.join(f'{seat}:{h}[{p}]' for seat, (h, p) in hands.items()))
            print('FULL', ' '.join(f"{s['step']}:{s['seat']}:{s['call']}:M{dictionary.index(s['meaning'])}" for s in b['steps']))
            for s in todo:
                old = prior.get((b['board'], s['step']))
                old_text = f"previous {old['call']}: {old['callVerdict']}/{old['meaningVerdict']}" + ('' if args.compact else f" {old['reason']}") if old else 'new step'
                print(f"REVIEW {s['step']}:{s['seat']}:{s['call']}:M{dictionary.index(s['meaning'])} | {old_text}")
            print('RESULT', b['result'])
    else:
        expected = {(b['board'], s['step']): (b, s) for b in assigned for s in b['steps']}
        authored = {}
        for line in (ROOT / args.authored).read_text(encoding='utf-8-sig').splitlines():
            if not line.strip() or line.startswith('#'):
                continue
            board, steps, cv, mv, reason = line.split(' ', 4)
            assert cv in {'ok', 'error', 'needs-system-definition'} and mv in {'ok', 'error', 'needs-system-definition'}
            for step in steps.split(','):
                key = int(board), int(step)
                assert key in expected and key not in authored, key
                authored[key] = cv, mv, reason
        rows, missing = [], []
        for key, (b, s) in sorted(expected.items()):
            if key in authored:
                cv, mv, reason = authored[key]
                provenance = {'reviewProvenance': 'fresh-explicit-GPT'}
            elif reusable(b, s):
                old = prior[key]
                cv, mv, reason = old['callVerdict'], old['meaningVerdict'], old['reason']
                provenance = {'reviewProvenance': 'exact-observation-prior-GPT', 'priorSourceArtifact': args.baseline,
                              'priorObservationSha256': baseline_observation_sha256}
            else:
                missing.append(key)
                continue
            rows.append({**s, 'board': b['board'], 'vulnerability': b['vulnerability'],
                         'callVerdict': cv, 'meaningVerdict': mv, 'reason': reason, **provenance})
        report = {'sourceArtifact': args.source, 'sourceSha256': source['codeSha256'],
                  'sourceObservationSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
                  'reviewer': 'GPT-' + args.group, 'method': 'Explicit GPT re-adjudication with identified exact-observation prior GPT reuse; no automatic quality oracle',
                  'completed': not missing, 'expectedBoards': len(assigned), 'reviewedBoards': len({r['board'] for r in rows}),
                  'reviewedSteps': len(rows), 'freshlyReviewedSteps': len(authored), 'missingSteps': missing, 'rows': rows}
        (ROOT / args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({k: report[k] for k in ['completed', 'reviewedBoards', 'reviewedSteps', 'freshlyReviewedSteps']}))
