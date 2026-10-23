"""Print selected recorded complete auctions for GPT; no quality judgment."""
from pathlib import Path
import json,sys
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent.parent
ids=json.loads((root/'artifacts/v033-postfix-complete-review.json').read_text('utf8'))['selection'][int(sys.argv[1]):int(sys.argv[2])]
path=sys.argv[3] if len(sys.argv)>3 else 'artifacts/v033-round2-auctions.json'
obs=json.loads((root/path).read_text('utf8'))
rows=[b for id in ids for b in obs['boards'] if b['board']==id]
meanings={}
for b in rows:
    for s in b['steps']:meanings.setdefault(s['meaning'],len(meanings)+1)
print('SOURCE',obs['codeSha256'])
for m,i in meanings.items():print(f'M{i} {m}')
for b in rows:
    print('BOARD',b['board'],'VUL',b['vulnerability'],'RESULT',b['result'])
    for s in b['steps']:print(f"B{b['board']}/{s['step']} {s['seat']} {s['hand']} HCP={s['hcp']} => {s['call']} M{meanings[s['meaning']]}")
