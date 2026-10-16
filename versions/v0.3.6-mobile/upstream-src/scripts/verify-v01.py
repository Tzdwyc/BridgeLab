"""Read-only verification of the original v0.1 files captured before v0.2 work."""
from pathlib import Path
import hashlib
import json
from datetime import datetime, timezone

root = Path(__file__).resolve().parent.parent
baseline = json.loads((root / 'artifacts/v0.1-preservation.json').read_text(encoding='utf-8-sig'))
rows = []
for item in baseline:
    source = root.parent / item['path']
    digest = hashlib.sha256(source.read_bytes()).hexdigest() if source.is_file() else None
    rows.append({'path': item['path'], 'sha256': digest, 'expected': item['sha256'], 'unchanged': digest == item['sha256']})
report = {'executedAt': datetime.now(timezone.utc).isoformat(), 'originalRoot': str(root.parent),
          'checkedFiles': len(rows), 'allUnchanged': all(r['unchanged'] for r in rows), 'files': rows}
(root / 'artifacts/v0.1-preservation-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k != 'files'}, ensure_ascii=False))
if not report['allUnchanged']:
    raise SystemExit('v0.1 preservation verification failed')
