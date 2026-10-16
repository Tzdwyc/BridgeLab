"""Serialize GPT-authored verdicts; identity/coverage checks do not judge bidding."""
from pathlib import Path
import json
root=Path(__file__).resolve().parent.parent
observations=json.loads((root/'artifacts/v033-release2-auctions.json').read_text('utf8'))
boards={b['board']:b for b in observations['boards']}
rows=[]
for line in (root/'artifacts/v033-release2-root-explicit.txt').read_text('utf8').splitlines():
    board,step,cv,mv,reason=line.split(' ',4)
    board,step=int(board),int(step)
    row=dict(boards[board]['steps'][step-1])
    assert row['step']==step
    row.update(board=board,callVerdict=cv,meaningVerdict=mv,reason=reason,reviewer='chatGPT-root')
    rows.append(row)
ids=[7519,7411,7468,7487,7521,7535,7741,7777]
assert {(r['board'],r['step']) for r in rows}=={(b,s['step']) for b in ids for s in boards[b]['steps']}
assert len(rows)==len({(r['board'],r['step']) for r in rows})
replay=json.loads((root/'artifacts/v033-release2-findings-replay.json').read_text('utf8'))
assert replay['sourceSha256']==observations['codeSha256']
authored=[
 (4244,11,'ok','ok','十八点五梅花与同伴低花偏好，三梅花保留邀请与额外实力空间，不再最低重复黑桃掩盖强牌。'),
 (4390,10,'ok','ok','十四点第二套四黑桃回答第四花色，仍是四张，不因为重复变为六张。'),
 (4390,12,'ok','ok','十二点两黑桃不能接受六张差配合，二无将描述邀请并继续交流。'),
 (4607,7,'ok','ok','十六点六张KQT红心技术加倍后续叫真实长套；说明明确六张好套可酌减至十六，未假称本手十七点。'),
 (4682,7,'ok','ok','九点八黑桃在强跳移逼局后描述真实长套，三黑桃仍受进局逼叫保护。'),
 (7318,11,'uncertain','ok','已Pass应叫人的二方块自然不逼叫，Pass不违反义务；开叫人单方块时回三支持红心可能更好，策略分歧保留。'),
 (7411,10,'ok','ok','对手已叫方块黑桃梅花，选择唯一未叫红心而非错误称黑桃未叫；被迫选择不承诺四张。'),
 (7672,5,'ok','ok','十八点五红心无同伴点力承诺，不盲签三无将，选择真实长套竞争。'),
 (7774,8,'ok','ok','三点不是被迫应叫，继续Pass，不再自由叫二红心而违背建设性实力要求。'),
]
targets=[]
for board,step,cv,mv,reason in authored:
    match=[r for r in replay['rows'] if (r['board'],r['step'])==(board,step)]
    assert len(match)==1
    row=dict(match[0]);row.update(callVerdict=cv,meaningVerdict=mv,reason=reason,reviewer='chatGPT-root')
    targets.append(row)
result=dict(sourceSha256=observations['codeSha256'],method='Explicit GPT rereading and individually authored verdicts; serializer checks identity only',completeBoards=ids,completeSteps=len(rows),rows=rows,targets=targets,scopeBoundary='Eight complete final auctions and nine frozen target positions, not another full 2000-board audit of final source')
(root/'artifacts/v033-release2-root-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print('Serialized GPT judgments:',len(rows),'complete-auction steps,',len(targets),'target positions')
