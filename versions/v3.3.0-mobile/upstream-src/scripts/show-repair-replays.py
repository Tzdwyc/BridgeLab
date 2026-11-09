"""Display recorded public observations only; GPT supplies every verdict."""
from pathlib import Path
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
start, end = map(int, sys.argv[1:3])
root = Path(__file__).resolve().parent.parent
report = json.loads((root / 'artifacts/v032-reviewed-board-replays.json').read_text(encoding='utf-8'))
boards = [board for board in report['boards'] if start <= board['board'] <= end]
meanings = {}
for board in boards:
    for step in board['steps']:
        meanings.setdefault(step['meaning'], len(meanings) + 1)
print('Code SHA256:', report['codeSha256'])
for text, index in meanings.items():
    print(f'M{index} {text}')
for board in boards:
    print(f"B{board['board']} dealer={board['dealer']} vul={board['vulnerability']}")
    for step in board['steps']:
        print(f"{step['step']} {step['seat']} {step['hand']} {step['hcp']} ->{step['call']} M{meanings[step['meaning']]}")
print(f'Observations only: {len(boards)} boards, {sum(len(board["steps"]) for board in boards)} steps.')
