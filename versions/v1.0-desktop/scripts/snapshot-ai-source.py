"""Preserve exact AI source bytes for an observation generation; no quality verdicts."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('generation')
args = parser.parse_args()
assert args.generation.startswith('v034-release') and args.generation.replace('-', '').isalnum()
dest = root / 'artifacts' / (args.generation + '-source-snapshot')
if dest.exists() and any(dest.iterdir()):
    raise SystemExit('Refusing to replace an existing source snapshot')
dest.mkdir(exist_ok=True)
digest = hashlib.sha256()
files = {}
for name in ['bidding.ts', 'bidding-semantics.ts', 'competition.ts', 'systems.ts', 'suit-evaluation.ts']:
    data = (root / 'src' / 'ai' / name).read_bytes()
    digest.update(name.encode())
    digest.update(data)
    (dest / name).write_bytes(data)
    files[name] = hashlib.sha256(data).hexdigest()
manifest = {'version': '0.3.4', 'frozenAt': datetime.now(timezone.utc).isoformat(),
            'codeSha256': digest.hexdigest(), 'files': files}
(dest / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(manifest))
