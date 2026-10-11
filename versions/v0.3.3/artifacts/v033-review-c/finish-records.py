"""Explicit editorial corrections and record bookkeeping, no bridge judgment algorithm."""
import json
from pathlib import Path
r=Path(__file__).resolve().parent
corrections={
 ('batch-7326-7365.json',7358,4):'自然D争叫后自己9点六S，1S是建设性新花色应叫8+五张、NF；不是开叫方一盖一F1，也不是自己首次争叫，固定悬停准确。',
 ('batch-7486-7525.json',7504,6):'二盖一2C已建立GF，开叫人真实六D以2D描述第二套；公开只承诺4+张D、原GF继续，说明未把D当H或虚构更高点力。',
 ('batch-7526-7545.json',7530,4):'自己8点、无四高花且六C，3-3-1-6并非均型；当前13+GF的二阶C不能使用，1NT为可用限制描述，但提示固定均型过窄，应允许长套或半均型用途。',
 ('batch-7526-7545.json',7541,7):'技术X后自己19点、真实六S，随后自由2S显示17+点五张以上S；不是被迫答扣叫，强长套与说明正确。'
}
for name in sorted({k[0] for k in corrections}):
 p=r/name;d=json.loads(p.read_text(encoding='utf-8'))
 for t in d['results']:
  k=(name,t['board'],t['step'])
  if k in corrections:t['reason']=corrections[k]
 p.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
files=sorted(r.glob('batch-*.json'));all_records=[];boards=[];shas=set()
for f in files:
 d=json.loads(f.read_text(encoding='utf-8'));all_records+=d['results'];boards+=d['reviewedBoards'];shas.add(d['sourceSha256'])
 assert len(d['results'])==d['reviewedStepCount']
 assert all(t['reason'] and t['callVerdict'] in ('ok','error','uncertain') and t['meaningVerdict'] in ('ok','error','uncertain') for t in d['results'])
assert len(boards)==len(set(boards))==400
assert set(boards)==set(range(7146,7546))
assert len(all_records)==3616
assert shas=={'a7ee9885b5e92deaaccf691e8c6677692c8a362454f6e73f5ac4822ade1d1472'}
assert len({(t['board'],t['step']) for t in all_records})==3616
counts={v:sum(t['callVerdict']==v for t in all_records) for v in ('ok','error','uncertain')}
meanings={v:sum(t['meaningVerdict']==v for t in all_records) for v in ('ok','error','uncertain')}
summary={'sourceSha256':next(iter(shas)),'range':[7146,7545],'reviewedBoardCount':400,'reviewedStepCount':3616,'nextBoard':7546,'complete':True,'method':'Every step individually read and judged by this GPT chat; no hidden partner hand or quality oracle. Scripts only display observations and serialize explicit decisions.','callVerdictCounts':counts,'meaningVerdictCounts':meanings,'batchFiles':[p.name for p in files],'editorialReasonCorrections':[{'board':k[1],'step':k[2],'reason':v} for k,v in corrections.items()]}
(r/'completion.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k not in ('batchFiles','editorialReasonCorrections')},ensure_ascii=False))
