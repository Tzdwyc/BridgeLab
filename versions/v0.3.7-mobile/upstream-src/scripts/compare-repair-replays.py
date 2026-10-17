"""List changed observations only. GPT must judge their bidding and meanings."""
from pathlib import Path
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent.parent
before = json.loads((root / 'artifacts/v032-reviewed-board-replays-round2.json').read_text(encoding='utf-8'))
after = json.loads((root / 'artifacts/v032-reviewed-board-replays.json').read_text(encoding='utf-8'))
previous = {board['board']: board for board in before['boards']}
changed = []
for board in after['boards']:
    old = previous[board['board']]
    trajectory_changed = [(step['seat'], step['call']) for step in old['steps']] != [(step['seat'], step['call']) for step in board['steps']]
    meanings_changed = [step['meaning'] for step in old['steps']] != [step['meaning'] for step in board['steps']]
    if trajectory_changed or meanings_changed:
        changed.append({'board': board['board'], 'trajectoryChanged': trajectory_changed,
                        'meaningsChanged': meanings_changed, 'steps': len(board['steps'])})
report = {'beforeCodeSha256': before['codeSha256'], 'afterCodeSha256': after['codeSha256'],
          'purpose': 'Observation differences only; no correctness verdict.', 'changedBoards': changed}
(root / 'artifacts/v032-final-observation-differences.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
