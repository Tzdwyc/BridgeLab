"""Display complete public trajectories and count GPT-authored verdicts; no quality oracle."""
from pathlib import Path
import argparse, hashlib, json
root = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser()
p.add_argument('command', choices=['show', 'summary'])
p.add_argument('generation')
p.add_argument('--start', type=int, default=1)
p.add_argument('--end', type=int, default=200)
a = p.parse_args()
source = root / 'artifacts' / f'v035-{a.generation}-auctions.json'
data = json.loads(source.read_text(encoding='utf8'))
if a.command == 'show':
    for b in data['boards']:
        if not a.start <= b['board'] <= a.end: continue
        print(f"BOARD {b['board']} {b['stratum']} dealer={b['dealer']} vul={b['vulnerability']}")
        for s in b['steps']:
            print(f"{s['step']} {s['seat']} {s['hand']} HCP{s['hcp']} ->{s['call']} | {s['meaning']}")
        print('END ' + b['result'])
else:
    rows = []
    observations = {}
    priorReports = {}
    for observation in (root / 'artifacts').glob('v035-*-auctions.json'):
        observations[hashlib.sha256(observation.read_bytes()).hexdigest()] = json.loads(observation.read_text(encoding='utf8'))
    reports = list((root / 'artifacts').glob(f'v035-{a.generation}-*-gpt-review.json'))
    includedReports = []
    sha = hashlib.sha256(source.read_bytes()).hexdigest()
    for file in reports:
        r = json.loads(file.read_text(encoding='utf-8-sig'))
        if 'observationSha256' not in r or 'steps' not in r:
            continue  # A separately named regression-assertion audit is not a board-step report.
        includedReports.append(file.name)
        assert r['observationSha256'] == sha, file
        for row in r['steps']:
            assert row.get('reason') or row.get('note'), (file, row)
            if row.get('method') == 'exact-prefix-prior-gpt':
                reference = row['reusedFrom']
                priorFile = root / 'artifacts' / Path(reference['report'] if isinstance(reference, dict) else reference).name
                if priorFile.name not in priorReports:
                    priorReports[priorFile.name] = json.loads(priorFile.read_text(encoding='utf-8-sig'))
                prior = priorReports[priorFile.name]
                oldRow = next(s for s in prior['steps'] if (s['board'], s['step']) == (row['board'], row['step']))
                assert oldRow['callVerdict'] == oldRow['meaningVerdict'] == 'ok', (file, row)
                priorData = observations[prior['observationSha256']]
                oldBoard = next(b for b in priorData['boards'] if b['board'] == row['board'])
                newBoard = next(b for b in data['boards'] if b['board'] == row['board'])
                assert newBoard['steps'][:row['step']] == oldBoard['steps'][:row['step']], (file, row)
        rows.extend(r['steps'])
    expected = {(b['board'], s['step']) for b in data['boards'] for s in b['steps']}
    seen = {(r['board'], r['step']) for r in rows}
    assert len(seen) == len(rows), 'duplicate GPT rows'
    assert seen <= expected, 'out of scope'
    issues = [r for r in rows if r['callVerdict'] != 'ok' or r['meaningVerdict'] != 'ok']
    result = dict(generation=a.generation, boards=len(data['boards']), totalSteps=len(expected),
                  reviewedSteps=len(rows), allCovered=seen == expected, openFindings=len(issues),
                  freshGPTSteps=sum(r.get('method') != 'exact-prefix-prior-gpt' for r in rows),
                  exactPrefixPriorGPTSteps=sum(r.get('method') == 'exact-prefix-prior-gpt' for r in rows),
                  observationSha256=sha, codeSha256=data['codeSha256'],
                  method='Mechanical coverage of explicit GPT judgments only; no automatic quality evaluation',
                  reports=includedReports, issues=issues)
    (root / 'artifacts' / f'v035-{a.generation}-gpt-coverage.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({k: v for k, v in result.items() if k not in ['issues', 'reports']}, ensure_ascii=False))
