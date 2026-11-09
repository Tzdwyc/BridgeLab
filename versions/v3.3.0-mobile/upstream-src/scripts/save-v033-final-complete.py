"""Serialize and merge explicitly authored GPT reviews, not a quality oracle."""
from pathlib import Path
import json,collections
root=Path(__file__).resolve().parent.parent
data=json.loads((root/'artifacts/v033-round2-auctions.json').read_text('utf8'))
source=data['codeSha256']
obs={(b['board'],s['step']):s for b in data['boards'] for s in b['steps']}
rows=[]
for line in (root/'artifacts/v033-final-complete-root-8-explicit.txt').read_text('utf8').splitlines():
    ident,cv,mv,reason=line.split(' ',3)
    board,step=map(int,ident.split('/'))
    rows.append(dict(obs[(board,step)],board=board,sourceSha256=source,reviewer='chatGPT-root',callVerdict=cv,meaningVerdict=mv,reason=reason))
ids=[7519,7411,7468,7487,7521,7535,7741,7777]
assert {(b,s) for b,s in obs if b in ids}=={(r['board'],r['step']) for r in rows}
(root/'artifacts/v033-final-complete-review-root-8.json').write_text(json.dumps(dict(sourceSha256=source,method='Explicit GPT judgments; serialization only',boards=ids,rows=rows),ensure_ascii=False,indent=2),encoding='utf8')
cpath=root/'artifacts/v033-final-complete-review-meanings-32.json'
if cpath.exists():
    other=json.loads(cpath.read_text('utf8'))
    assert other['sourceSha256']==source
    rows=other['rows']+rows
    selected=json.loads((root/'artifacts/v033-postfix-complete-review.json').read_text('utf8'))['selection']
    wanted={(b,s) for b,s in obs if b in selected}
    assert len(rows)==len(wanted) and {(r['board'],r['step']) for r in rows}==wanted
    out=dict(sourceSha256=source,method='Each step personally judged by GPT; serializer only checks identities and merges',reviewedBoardCount=40,reviewedStepCount=len(rows),selection=selected,callVerdictCounts=dict(collections.Counter(r['callVerdict'] for r in rows)),meaningVerdictCounts=dict(collections.Counter(r['meaningVerdict'] for r in rows)),rows=rows)
    (root/'artifacts/v033-final-complete-review.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
    print('Merged',len(rows),'steps in 40 complete auctions')
else: print('Saved root eight complete auctions:',len(rows),'steps; waiting for 32')
