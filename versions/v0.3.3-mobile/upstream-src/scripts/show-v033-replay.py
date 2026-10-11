"""Display recorded positions, never judge bidding quality."""
from pathlib import Path
import json, sys
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent.parent
start, stop = map(int, sys.argv[1:3])
path = sys.argv[3] if len(sys.argv) > 3 else 'artifacts/v033-round2-findings-replay.json'
report = json.loads((root / path).read_text(encoding='utf-8'))
meanings = {}
for row in report['rows'][start:stop]:
    meanings.setdefault(row['newMeaning'], len(meanings) + 1)
print('SOURCE', report['sourceSha256'])
for meaning, number in meanings.items():
    print(f'M{number} {meaning}')
for index in range(start, min(stop, len(report['rows']))):
    row = report['rows'][index]
    print(f"R{index} B{row['board']}/{row['step']} {row['seat']} {row['hand']} HCP={row.get('hcp', '?')} {row['publicHistory']} => {row['newCall']} M{meanings[row['newMeaning']]}")
print('No automatic quality verdicts.')
