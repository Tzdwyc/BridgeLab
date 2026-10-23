"""Serialize final-source explicitly authored GPT judgments; not a bidding oracle."""
from pathlib import Path
import collections
import json

root = Path(__file__).resolve().parent.parent
data = json.loads((root / 'artifacts/v033-release2-auctions.json').read_text('utf8'))
sha = '52396f47643f77e4111e1deae4de45d940163df5f275957aa28016614eedb1db'
assert data['codeSha256'] == sha
targets = json.loads((root / 'artifacts/v033-final-hover-targets.json').read_text('utf8'))['targets']
wanted = {(t['board'], t['priorStep']) for t in targets} | {(1131, 6), (4607, 7), (7738, 8)}
observations = {(b['board'], s['step']): s for b in data['boards'] for s in b['steps']}
rows = []
for line in (root / 'artifacts/v033-release2-meaning-explicit.txt').read_text('utf8').splitlines():
    identity, call_verdict, meaning_verdict, reason = line.split(' ', 3)
    board, step = map(int, identity.split('/'))
    rows.append(dict(observations[(board, step)], board=board, sourceSha256=sha,
                     callVerdict=call_verdict, meaningVerdict=meaning_verdict, reason=reason))
assert len(rows) == len(wanted) == 18
assert {(r['board'], r['step']) for r in rows} == wanted
out = dict(sourceSha256=sha, reviewer='GPT-meanings',
           method='All eighteen final observations were personally read and judged using the actual actor hand and public prefix. Serialization only verifies identities and preserves authored judgments; verdicts are not inferred from tests or prior JSON.',
           reviewedTargetCount=len(rows),
           callVerdictCounts=dict(collections.Counter(r['callVerdict'] for r in rows)),
           meaningVerdictCounts=dict(collections.Counter(r['meaningVerdict'] for r in rows)),
           rows=rows,
           limitations='Bounded follow-up of fifteen originally repaired public meanings plus three expressly authorized final strength corrections. Not a second complete 2000-board or forty-board manual review. 4283/11 retains call-strategy uncertainty. The original 147c review and older frozen complete reviews remain preserved under their own hashes. No source edits were made during this follow-up.')
(root / 'artifacts/v033-release2-meaning-review.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(dict(targets=len(rows), callVerdicts=out['callVerdictCounts'], meaningVerdicts=out['meaningVerdictCounts'])))
