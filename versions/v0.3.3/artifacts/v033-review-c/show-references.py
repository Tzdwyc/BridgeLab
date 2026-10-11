"""Observations only; exact repeated meanings reference first already displayed occurrence."""
import json,sys
from pathlib import Path
r=Path(__file__).resolve().parents[2];a,z=map(int,sys.argv[1:3])
s=json.loads((r/'artifacts/v033-baseline-auctions.json').read_text(encoding='utf-8'));seen={}
for b in s['boards']:
 if 7286<=b['board']<a:
  for t in b['steps']:seen.setdefault(t['meaning'],f"{b['board']}.{t['step']}")
selected=[b for b in s['boards'] if a<=b['board']<=z]
for b in selected:
 for t in b['steps']:
  if t['meaning'] not in seen:
   ref=f"{b['board']}.{t['step']}";seen[t['meaning']]=ref;print('NEW',ref,t['meaning'])
for b in selected:
 print(f"B{b['board']} dealer={b['dealer']} vul={b['vulnerability']}")
 for t in b['steps']:print(f"{t['step']} {t['seat']} {t['hand']} {t['hcp']} {t['call']} R{seen[t['meaning']]}")
print('Complete observations:',len(selected),'boards',sum(len(b['steps']) for b in selected),'steps')
