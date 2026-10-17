"""Compact frozen-release presentation only; no quality judgments or verdicts."""
import contextlib, io, runpy, sys
from pathlib import Path
root = Path(__file__).resolve().parent.parent
start, count = map(int, sys.argv[1:3])
group = sys.argv[3] if len(sys.argv) > 3 else 'core'
sys.argv = ['gpt-review-delta.py', 'summary', '--source', 'artifacts/v033-release7-auctions.json', '--baseline', 'artifacts/v033-release6b-auctions.json']
with contextlib.redirect_stdout(io.StringIO()):
    ns = runpy.run_path(str(root / 'scripts/gpt-review-delta.py'))
offset = ['root', 'core', 'meanings', 'competition'].index(group) * 500
boards = ns['source']['boards'][offset:offset + 500]
meanings = list(dict.fromkeys(s['meaning'] for b in boards for s in b['steps'] if not ns['reusable'](b, s)))
seen = set()
batch = boards[start:start + count]
print('CODE', ns['source']['codeSha256'], 'GROUP', group, 'POSITIONS', start, start + len(batch))
for meaning in dict.fromkeys(s['meaning'] for b in batch for s in b['steps'] if not ns['reusable'](b, s) and s['meaning'] not in seen):
    print(f'M{meanings.index(meaning)}: {meaning}')
for b in batch:
    todo = [s for s in b['steps'] if not ns['reusable'](b, s)]
    if not todo:
        print('EXACT-PRIOR-OK', b['board']); continue
    print('BOARD', b['board'], b['dealer'], b['vulnerability'])
    print('HANDS', ' '.join(f'{seat}:{hand}[{hcp}]' for seat, (hand, hcp) in {s['seat']:(s['hand'], s['hcp']) for s in b['steps']}.items()))
    print('FULL', ' '.join(f"{s['step']}:{s['seat']}:{s['call']}" for s in b['steps']))
    print('REVIEW', ' '.join(f"{s['step']}:M{meanings.index(s['meaning'])}" for s in todo))
    for s in todo:
        prior = ns['prior'].get((b['board'], s['step']))
        if prior and (prior['callVerdict'] != 'ok' or prior['meaningVerdict'] != 'ok'):
            print('PRIOR-NONOK', s['step'], prior['callVerdict'], prior['meaningVerdict'], prior['reason'])
