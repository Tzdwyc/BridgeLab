"""Display full public step observations compactly, without any judgment."""
import gzip
import json
import sys
from pathlib import Path

start, stop = map(int, sys.argv[1:3])
source = Path(__file__).resolve().parent.parent / 'artifacts/bidding-review-foundation-6-traces.jsonl.gz'
boards = []
with gzip.open(source, 'rt', encoding='utf-8') as stream:
    for line in stream:
        row = json.loads(line)
        if start <= row['board'] <= stop:
            boards.append(row)
meanings = {}
for board in boards:
    for step in board['steps']:
        meanings.setdefault(step['meaning'], len(meanings) + 1)
print('MEANINGS (each step below references the complete text)')
for meaning, index in meanings.items():
    print(f'M{index} {meaning}')
print('BOARDS (prefix at step i consists only of preceding steps, in order)')
for board in boards:
    print(f"B{board['board']} dealer={board['dealer']} vul={board['vulnerability']}")
    for step in board['steps']:
        print(f"{step['step']} {step['seat']} {step['hand']} {step['hcp']} ->{step['call']} M{meanings[step['meaning']]}")
print(f'OBSERVATIONS ONLY: {len(boards)} boards; {sum(len(b["steps"]) for b in boards)} steps; GPT must judge individually.')
