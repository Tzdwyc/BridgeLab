"""Serialize explicitly authored GPT verdicts; never infer bidding correctness."""
from pathlib import Path
import collections
import json

root = Path(__file__).resolve().parent.parent
source = json.loads((root / 'artifacts/v033-release-auctions.json').read_text('utf8'))
sha = '147c2b7091bc3af53c8526d57b7c94c97dfae0ef757b2c88ff2b08bf57b0418d'
assert source['codeSha256'] == sha
observations = {(b['board'], s['step']): s for b in source['boards'] for s in b['steps']}
targets = json.loads((root / 'artifacts/v033-final-hover-targets.json').read_text('utf8'))['targets']
wanted = {(t['board'], t['priorStep']) for t in targets}
rows = []
for line in (root / 'artifacts/v033-release-meaning-explicit.txt').read_text('utf8').splitlines():
    identity, call_verdict, meaning_verdict, reason = line.split(' ', 3)
    board, step = map(int, identity.split('/'))
    rows.append(dict(observations[(board, step)], board=board, sourceSha256=sha,
                     callVerdict=call_verdict, meaningVerdict=meaning_verdict, reason=reason))
assert len(rows) == len(wanted) == 15
assert {(r['board'], r['step']) for r in rows} == wanted
out = dict(sourceSha256=sha, reviewer='GPT-meanings',
           method='Each selected final observation, actual hand, and public auction prefix personally judged by GPT. This script only preserves observations, checks target identities, and serializes authored judgments.',
           reviewedTargetCount=len(rows),
           callVerdictCounts=dict(collections.Counter(r['callVerdict'] for r in rows)),
           meaningVerdictCounts=dict(collections.Counter(r['meaningVerdict'] for r in rows)),
           rows=rows,
           limitations='Bounded fifteen-target follow-up of repaired meanings, not a second complete 2000-board or forty-board review. Call strategic uncertainty is retained at 4283/11. Previous frozen review and explicit withdrawal of 700/8 remain separately preserved. No source edits were made during this follow-up.')
(root / 'artifacts/v033-release-meaning-review.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(dict(targets=len(rows), callVerdicts=out['callVerdictCounts'], meaningVerdicts=out['meaningVerdictCounts'])))
