"""Compact presentation only: no bridge-quality judgments or saved verdicts."""
import contextlib, io, json, runpy, sys
from pathlib import Path
root = Path(__file__).resolve().parent.parent
start, count = map(int, sys.argv[1:3])
group = sys.argv[3] if len(sys.argv) > 3 else 'core'
sys.argv = ['gpt-review-delta.py', 'summary', '--source', 'artifacts/v033-release6b-auctions.json', '--baseline', 'artifacts/v033-release5-auctions.json']
with contextlib.redirect_stdout(io.StringIO()):
    ns = runpy.run_path(str(root / 'scripts/gpt-review-delta.py'))
core = ns['source']['boards'][500:1000]
meanings = list(dict.fromkeys(s['meaning'] for b in core for s in b['steps'] if not ns['reusable'](b, s)))
boards = core if group == 'core' else ns['source']['boards'][:500]
root_meanings = list(dict.fromkeys(s['meaning'] for b in boards for s in b['steps'] if not ns['reusable'](b, s) and s['meaning'] not in meanings))
seen = ({s['meaning'] for b in boards[:start] for s in b['steps'] if not ns['reusable'](b, s)} if group == 'core'
    else set(meanings) | {s['meaning'] for b in boards[300:start] for s in b['steps'] if not ns['reusable'](b, s)})
def label(m):
    return f'M{meanings.index(m)}' if m in meanings else f'R{root_meanings.index(m)}'
batch = boards[start:start+count]
new = list(dict.fromkeys(s['meaning'] for b in batch for s in b['steps'] if not ns['reusable'](b, s) and s['meaning'] not in seen))
for m in new:
    print(f'{label(m)}: {m}')
for b in batch:
    todo = [s for s in b['steps'] if not ns['reusable'](b, s)]
    if not todo:
        print('EXACT-PRIOR-OK', b['board']); continue
    print('BOARD', b['board'], b['dealer'], b['vulnerability'])
    print('HANDS', ' '.join(f"{seat}:{hand}[{hcp}]" for seat, (hand, hcp) in {s['seat']:(s['hand'], s['hcp']) for s in b['steps']}.items()))
    print('FULL', ' '.join(f"{s['step']}:{s['seat']}:{s['call']}" for s in b['steps']))
    print('REVIEW', ' '.join(f"{s['step']}:{label(s['meaning'])}" for s in todo))
    bad = [(s['step'], ns['prior'].get((b['board'], s['step']))) for s in todo]
    for step, p in bad:
        if p and (p['callVerdict'] != 'ok' or p['meaningVerdict'] != 'ok'):
            print('PRIOR-NONOK', step, p['callVerdict'], p['meaningVerdict'], p['reason'])
