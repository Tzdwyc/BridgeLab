"""Carry forward authorized GPT judgments only after exact observation-field comparison."""
from pathlib import Path
import collections
import json

root = Path(__file__).resolve().parent.parent
prior = json.loads((root / 'artifacts/v033-release3-meaning-review.json').read_text('utf8'))
data = json.loads((root / 'artifacts/v033-release4-auctions.json').read_text('utf8'))
sha = 'be21682e468bb3da7b7de04800950e6bcaa6f31b86d6d08d8e9343e4adcc16a4'
assert data['codeSha256'] == sha
fields = ['step', 'seat', 'hand', 'hcp', 'publicHistory', 'call', 'meaning']
observations = {(b['board'], s['step']): s for b in data['boards'] for s in b['steps']}
prior_keys = {(r['board'], r['step']) for r in prior['rows']}
assert len(prior['rows']) == len(prior_keys) == 50
assert {key for key in observations if key[0] in {976, 4390}} == {key for key in prior_keys if key[0] in {976, 4390}}
rows = []
for previous in prior['rows']:
    key = (previous['board'], previous['step'])
    current = observations[key]
    assert all(previous[field] == current[field] for field in fields), f'Changed observation requires personal re-review: {key}'
    rows.append(dict(current, board=key[0], sourceSha256=sha, scope=previous['scope'],
                     callVerdict=previous['callVerdict'], meaningVerdict=previous['meaningVerdict'], reason=previous['reason'],
                     verdictOrigin='Prior explicitly authored GPT judgment inherited after all seven actual observation fields matched exactly',
                     verdictOriginSourceSha256=prior['sourceSha256'],
                     fieldComparison=dict(status='identical', fields=fields)))
out = dict(sourceSha256=sha, reviewer='GPT-meanings',
           method='Root expressly authorized field-verified inheritance for unchanged observations. Compared all seven actual fields of all fifty selected steps with the prior personally authored release3 judgments. All fifty were identical; no quality verdict was newly inferred by software and no fresh full manual audit is claimed.',
           priorReview='v033-release3-meaning-review.json', priorSourceSha256=prior['sourceSha256'],
           repairedTargetCount=18, completeBoards=[976, 4390], completeAuctionStepCount=32,
           boundObservationCount=len(rows), unchangedObservationCount=len(rows), changedObservationCount=0,
           callVerdictCounts=dict(collections.Counter(r['callVerdict'] for r in rows)),
           meaningVerdictCounts=dict(collections.Counter(r['meaningVerdict'] for r in rows)), rows=rows,
           limitations='This is a provenance-preserving rebind of fifty unchanged observations to the final source after exact field checks, not fifty newly authored judgments or a new 2000-board/fixed-forty-board audit. Existing call-strategy uncertainty at 4283/11 remains. Earlier hash-bound files were not overwritten; no source edits were made.')
(root / 'artifacts/v033-release4-meaning-review.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(dict(bound=len(rows), unchanged=len(rows), changed=0, calls=out['callVerdictCounts'], meanings=out['meaningVerdictCounts'])))
