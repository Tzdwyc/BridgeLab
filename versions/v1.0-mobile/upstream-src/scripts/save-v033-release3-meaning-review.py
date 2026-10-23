"""Preserve individually authored final GPT judgments; no inferred quality verdicts."""
from pathlib import Path
import collections
import json

root = Path(__file__).resolve().parent.parent
data = json.loads((root / 'artifacts/v033-release3-auctions.json').read_text('utf8'))
sha = 'f72ee33435d9c8c172c8a876b491db1819ee9712af80090e063fc18ae034324d'
assert data['codeSha256'] == sha
targets = json.loads((root / 'artifacts/v033-final-hover-targets.json').read_text('utf8'))['targets']
target_keys = {(t['board'], t['priorStep']) for t in targets} | {(1131, 6), (4607, 7), (7738, 8)}
observations = {(b['board'], s['step']): s for b in data['boards'] for s in b['steps']}
complete_keys = {key for key in observations if key[0] in {976, 4390}}
wanted = target_keys | complete_keys
rows = []
for line in (root / 'artifacts/v033-release3-meaning-explicit.txt').read_text('utf8').splitlines():
    identity, call_verdict, meaning_verdict, reason = line.split(' ', 3)
    board, step = map(int, identity.split('/'))
    rows.append(dict(observations[(board, step)], board=board, sourceSha256=sha,
                     scope='complete-auction' if board in {976, 4390} else 'repaired-target',
                     callVerdict=call_verdict, meaningVerdict=meaning_verdict, reason=reason))
assert len(target_keys) == 18 and len(complete_keys) == 32
assert len(rows) == len(wanted) == 50
assert {(r['board'], r['step']) for r in rows} == wanted
out = dict(sourceSha256=sha, reviewer='GPT-meanings',
           method='Personally read the final observations, actual actor hands, and public prefixes for eighteen fixed targets and both complete changed NT auctions. Each verdict and reason is authored explicitly; this serializer only checks coverage and preserves observations.',
           repairedTargetCount=18, completeBoards=[976, 4390], completeAuctionStepCount=32, reviewedStepCount=len(rows),
           callVerdictCounts=dict(collections.Counter(r['callVerdict'] for r in rows)),
           meaningVerdictCounts=dict(collections.Counter(r['meaningVerdict'] for r in rows)), rows=rows,
           limitations='Bounded eighteen-target follow-up plus two expressly requested complete changed NT auctions. Does not re-audit the entire 2000-board corpus or fixed forty-board sample. 4283/11 retains call-strategy uncertainty. All prior hash-bound records remain unchanged. No source edits were made in this review.')
(root / 'artifacts/v033-release3-meaning-review.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(dict(steps=len(rows), calls=out['callVerdictCounts'], meanings=out['meaningVerdictCounts'])))
