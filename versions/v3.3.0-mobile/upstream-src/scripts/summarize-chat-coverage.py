"""Count saved GPT step reviews; never decide whether a bridge call is correct.

The immutable source supplies the context where a reviewer saved just a step
number. All call/meaning verdicts and reasons are copied from the GPT records.
Incomplete records are reported and excluded from complete-board coverage.
"""
from pathlib import Path
from collections import Counter
import gzip
import hashlib
import json

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'artifacts'
SOURCE = ART / 'bidding-review-foundation-6-traces.jsonl.gz'
source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
reviews = {}
duplicates = []
for label in ('a', 'b', 'c', 'd'):
    path = ART / f'chat-model-review-{label}.jsonl'
    if not path.exists():
        continue
    for line in path.read_text(encoding='utf-8').splitlines():
        record = json.loads(line)
        board = record['board']
        if board in reviews:
            duplicates.append(board)
        reviews[board] = (label, record)

complete = []
incomplete = []
counts = Counter()
joined = []
with gzip.open(SOURCE, 'rt', encoding='utf-8') as stream:
    for line in stream:
        source = json.loads(line)
        board = source['board']
        if board not in reviews:
            continue
        label, review = reviews[board]
        judgments = {step['step']: step for step in review['steps']}
        valid = set(judgments) == {s['step'] for s in source['steps']}
        valid = valid and len(judgments) == len(review['steps'])
        valid = valid and all(s.get('reason') and s.get('callVerdict') in ('ok', 'issue', 'uncertain')
            and s.get('meaningVerdict') in ('ok', 'issue', 'uncertain') for s in judgments.values())
        # Detect references to another record, not bridge correctness.
        for actual in source['steps']:
            opinion = judgments.get(actual['step'], {})
            for field, original in [('hand', actual['hand']), ('seat', actual['seat']),
                ('actualCall', actual['call']), ('call', actual['call']),
                ('publicHistory', actual['auction']), ('auction', actual['auction']),
                ('actualMeaning', actual['meaning']), ('meaning', actual['meaning'])]:
                if field in opinion and opinion[field] != original:
                    valid = False
        if not valid:
            incomplete.append(board)
            continue
        complete.append(board)
        counts[f'agent_{label}_boards'] += 1
        counts[f'agent_{label}_steps'] += len(judgments)
        steps = []
        for actual in source['steps']:
            opinion = judgments[actual['step']]
            counts['steps'] += 1
            counts[f'call_{opinion["callVerdict"]}'] += 1
            counts[f'meaning_{opinion["meaningVerdict"]}'] += 1
            steps.append({**actual, 'gptJudgment': opinion})
        joined.append({'board': board, 'sourceSHA256': source_hash,
            'reviewer': 'current-chat-GPT', 'agent': label, 'steps': steps})

summary = {'source': SOURCE.name, 'sourceSHA256': source_hash, 'targetBoards': 10000,
    'completeReviewedBoards': len(complete), 'remainingBoards': 10000 - len(complete),
    'completeReviewedBoardIds': complete, 'incompleteRecordBoards': incomplete,
    'duplicateRecordBoards': duplicates, **counts,
    'complete': len(complete) == 10000 and not incomplete and not duplicates,
    'method': 'Counts persisted GPT-authored judgments only. No automatic bidding or meaning verdicts.'}
(ART / 'chat-model-review-coverage.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
(ART / 'chat-model-review-context.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False)+'\n' for r in joined), encoding='utf-8')
print(json.dumps({k: v for k, v in summary.items() if k != 'completeReviewedBoardIds'}, ensure_ascii=False, indent=2))
