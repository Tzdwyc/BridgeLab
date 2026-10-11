"""Serialize GPT's explicit per-step labels; never infer a verdict from hands/calls."""
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=json.loads((root/'artifacts/v033-baseline-auctions.json').read_text(encoding='utf-8'))
spec=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
out=[]
for board,labels in spec['labels'].items():
 b=next(b for b in source['boards'] if b['board']==int(board))
 assert len(labels)==len(b['steps']), (board,len(labels),len(b['steps']))
 for t,label in zip(b['steps'],labels):
  cv,mv,reason=spec['reasons'][label]
  out.append({'board':int(board),**t,'callVerdict':cv,'meaningVerdict':mv,'reason':reason})
boards=[int(x) for x in spec['labels']]
payload={'sourceSha256':source['codeSha256'],'method':'GPT explicit per-step judgments; dictionary expands only labels selected by GPT','reviewedBoards':boards,'reviewedBoardCount':len(boards),'reviewedStepCount':len(out),'results':out}
dest=root/'artifacts/v033-review-c'/f'batch-{min(boards)}-{max(boards)}.json'
assert not dest.exists(), dest
dest.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
progress_path=root/'artifacts/v033-review-c/progress.json'
p=json.loads(progress_path.read_text(encoding='utf-8'))
assert not set(boards)&set(p['reviewedBoards'])
p['reviewedBoards']=sorted(p['reviewedBoards']+boards)
p['range']=[7146,7545]
p['reviewedBoardCount']=len(p['reviewedBoards']);p['reviewedStepCount']+=len(out);p['nextBoard']=max(p['reviewedBoards'])+1;p['complete']=p['reviewedBoardCount']==400
progress_path.write_text(json.dumps(p,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Saved {len(boards)} boards / {len(out)} explicitly judged steps; total {p["reviewedBoardCount"]}/{p["reviewedStepCount"]}; next {p["nextBoard"]}')
