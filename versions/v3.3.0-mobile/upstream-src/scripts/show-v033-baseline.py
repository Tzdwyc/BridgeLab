"""Print frozen observations only. GPT supplies all judgments."""
from pathlib import Path
import json,sys
sys.stdout.reconfigure(encoding='utf-8')
a,b=map(int,sys.argv[1:3]);r=Path(__file__).resolve().parent.parent
report=json.loads((r/'artifacts/v033-baseline-auctions.json').read_text(encoding='utf-8'))
boards=[x for x in report['boards'] if a<=x['board']<=b]
meanings={}
for x in boards:
 for t in x['steps']: meanings.setdefault(t['meaning'],len(meanings)+1)
print('Frozen code SHA256:',report['codeSha256'])
for text,i in meanings.items():print(f'M{i} {text}')
for x in boards:
 print(f"B{x['board']} dealer={x['dealer']} vul={x['vulnerability']}")
 for t in x['steps']:print(f"{t['step']} {t['seat']} {t['hand']} {t['hcp']} ->{t['call']} M{meanings[t['meaning']]}")
print(f"Displayed {len(boards)} complete boards / {sum(len(x['steps']) for x in boards)} steps; no quality verdicts.")
