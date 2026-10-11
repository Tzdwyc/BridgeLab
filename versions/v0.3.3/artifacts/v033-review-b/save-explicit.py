"""Store GPT's explicit per-step opinions. No automatic bidding judgment."""
import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
folder = Path(__file__).resolve().parent
source = json.loads((folder.parent / 'v033-baseline-auctions.json').read_text(encoding='utf-8'))
sha = 'a7ee9885b5e92deaaccf691e8c6677692c8a362454f6e73f5ac4822ade1d1472'
assert source['codeSha256'] == sha
opinions_file = folder / sys.argv[1]
opinions = {}
current = None
for line in opinions_file.read_text(encoding='utf-8').splitlines():
    if not line.strip(): continue
    if line.isdigit():
        current = int(line)
        assert current not in opinions
        opinions[current] = []
    else:
        c, m, reason = line.split('|', 2)
        assert c in ('o', 'e', 'u') and m in ('o', 'e', 'u')
        opinions[current].append((c, m, reason))
labels = {'o': 'ok', 'e': 'error', 'u': 'uncertain'}
boards = []
for b in source['boards']:
    if b['board'] not in opinions: continue
    rows = opinions[b['board']]
    assert len(rows) == len(b['steps']), (b['board'], len(rows), len(b['steps']))
    steps = [{**s, 'sourceSha256': sha, 'board': b['board'], 'callVerdict': labels[c],
              'meaningVerdict': labels[m], 'reason': reason}
             for s, (c, m, reason) in zip(b['steps'], rows)]
    boards.append({'board': b['board'], 'steps': steps})
assert len(boards) == len(opinions)
output = {'sourceSha256': sha, 'method': 'GPT逐步仅用当家牌和此前公开叫牌人工判断；程序仅存显式意见。',
          'reviewedBoards': len(boards), 'reviewedSteps': sum(len(b['steps']) for b in boards), 'boards': boards}
destination = folder / (opinions_file.stem + '.json')
destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
saved = [json.loads(p.read_text(encoding='utf-8')) for p in folder.glob('batch-*.json')]
completed = sorted(b['board'] for report in saved for b in report['boards'])
assert len(completed) == len(set(completed))
progress = {'sourceSha256': sha, 'assignedStart': 4033, 'assignedEnd': 4532,
            'completedBoards': completed, 'completedBoardCount': len(completed),
            'completedStepCount': sum(r['reviewedSteps'] for r in saved),
            'nextBoard': completed[-1] + 1 if completed else 4033}
(folder / 'progress.json').write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'saved': destination.name, 'batchBoards': output['reviewedBoards'],
                  'batchSteps': output['reviewedSteps'], 'totalBoards': progress['completedBoardCount'],
                  'totalSteps': progress['completedStepCount'], 'nextBoard': progress['nextBoard']}, ensure_ascii=False))
