from pathlib import Path
import json, sys

# Formatting/storage only: every verdict and reason comes from explicit GPT rows.
root = Path(__file__).resolve().parents[2]
source = json.loads((root / 'artifacts/v033-baseline-auctions.json').read_text(encoding='utf-8'))
observations = {b['board']: b for b in source['boards']}
manual = Path(sys.argv[1])
rows = {}
board = None
for line in manual.read_text(encoding='utf-8').splitlines():
    if not line.strip(): continue
    if line.startswith('B') and line[1:].isdigit():
        board = int(line[1:]); rows[board] = []; continue
    verdicts, reason = line.split(' ', 1)
    call, meaning = verdicts.split('/')
    if call not in ('ok', 'error', 'uncertain') or meaning not in ('ok', 'error', 'uncertain'):
        raise ValueError('Invalid explicit verdict')
    rows[board].append({'callVerdict': call, 'meaningVerdict': meaning, 'reason': reason})
boards = []
for number, judgments in rows.items():
    original = observations[number]
    if len(judgments) != len(original['steps']):
        raise ValueError(f'Incomplete human rows B{number}: {len(judgments)} / {len(original["steps"])}')
    boards.append({'board': number, 'steps': [{**step, **judgment, 'sourceSha256': source['codeSha256']}
        for step, judgment in zip(original['steps'], judgments)]})
result = {'sourceSha256': source['codeSha256'], 'reviewer': 'current-chat-GPT',
    'basis': 'Every step read with acting hand, cumulative public prefix and full meaning; explicit GPT verdicts only.',
    'boards': boards, 'actualBoardCount': len(boards), 'actualStepCount': sum(len(b['steps']) for b in boards)}
out = manual.with_suffix('.json')
out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
all_boards = {}
for path in out.parent.glob('batch-*.json'):
    batch = json.loads(path.read_text(encoding='utf-8'))
    for b in batch['boards']:
        if b['board'] in all_boards: raise ValueError('Duplicate saved review')
        all_boards[b['board']] = b
numbers = sorted(all_boards)
progress = {'sourceSha256': source['codeSha256'], 'assignedFirstBoard': 540, 'assignedLastBoard': 939,
    'actualCompletedBoards': numbers, 'actualBoardCount': len(numbers),
    'actualStepCount': sum(len(b['steps']) for b in all_boards.values()), 'nextBoard': numbers[-1]+1,
    'status': 'in_progress' if len(numbers) < 400 else 'complete-for-assigned-scope'}
(out.parent / 'progress.json').write_text(json.dumps(progress, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(f'Saved {out.name}: {result["actualBoardCount"]} boards / {result["actualStepCount"]} steps; cumulative {len(numbers)} / {progress["actualStepCount"]}')
