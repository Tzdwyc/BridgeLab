"""Persist GPT-authored per-step labels. Never compute a bidding verdict."""
import gzip
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
path = root / sys.argv[1]
authored = json.loads(path.read_text(encoding='utf-8'))
sources = {}
with gzip.open(root / 'artifacts/bidding-review-foundation-6-traces.jsonl.gz', 'rt', encoding='utf-8') as stream:
    wanted = {row['board'] for row in authored}
    for line in stream:
        row = json.loads(line)
        if row['board'] in wanted:
            sources[row['board']] = row
output = root / 'artifacts/chat-model-review-d.jsonl'
existing = {json.loads(line)['board'] for line in output.read_text(encoding='utf-8').splitlines()} if output.exists() else set()
records = []
labels = {'O': 'ok', 'I': 'issue', 'U': 'uncertain'}
for row in authored:
    source = sources[row['board']]
    assert row['board'] not in existing, 'Refuse duplicate persisted review'
    # Compact input still supplies two explicit GPT labels for EVERY step.
    # This is formatting only: no hand/auction/meaning-based verdict inference.
    supplied = row.get('reviews')
    if supplied is None:
        tokens = row['codes'].split()
        assert all(len(token) == 2 for token in tokens)
        notes = row.get('notes', {})
        supplied = [token + ' ' + notes.get(str(i + 1), row['okayReason']) for i, token in enumerate(tokens)]
        assert all(token == 'OO' or str(i + 1) in notes for i, token in enumerate(tokens)), 'Non-ok labels require a GPT-authored step note'
    assert len(supplied) == len(source['steps']), f"{row['board']}: every step must have a GPT opinion"
    opinions = []
    for step, authored_opinion in zip(source['steps'], supplied):
        assert authored_opinion[0] in labels and authored_opinion[1] in labels and authored_opinion[2:].strip()
        opinions.append({'step': step['step'], 'callVerdict': labels[authored_opinion[0]],
            'meaningVerdict': labels[authored_opinion[1]], 'reason': authored_opinion[2:].strip()})
    records.append({'board': row['board'], 'reviewer': 'current-chat-GPT-root',
        'method': 'GPT read every own hand, prior public calls and complete meaning; script only persists supplied judgments', 'steps': opinions})
with output.open('a', encoding='utf-8') as stream:
    for row in records:
        stream.write(json.dumps(row, ensure_ascii=False) + '\n')
print(json.dumps({'savedBoards': len(records), 'savedSteps': sum(len(row['steps']) for row in records), 'judgments': 'GPT-authored; no automatic oracle'}))
