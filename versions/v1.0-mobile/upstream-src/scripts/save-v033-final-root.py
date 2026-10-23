"""Serialize explicitly written GPT judgments; never generate quality verdicts."""
from pathlib import Path
import json
root=Path(__file__).resolve().parent.parent
data=json.loads((root/'artifacts/v033-round2-findings-replay.json').read_text('utf8'))
rows=[]
for line in (root/'artifacts/v033-final-root-explicit.txt').read_text('utf8').splitlines():
    index,cv,mv,reason=line.split(' ',3)
    row=dict(data['rows'][int(index)])
    row.update(index=int(index),callVerdict=cv,meaningVerdict=mv,reason=reason,reviewer='chatGPT-root')
    rows.append(row)
assert [r['index'] for r in rows]==list(range(352,532))
target=root/'artifacts/v033-final-review-root.json'
target.write_text(json.dumps(dict(sourceSha256=data['sourceSha256'],method='Explicit GPT judgments; serializer only',rows=rows),ensure_ascii=False,indent=2),encoding='utf8')
print('Saved',len(rows),'personally reviewed positions')
