"""Read-only verification: original AI bytes, changing only outward relative imports.
Run from versions/v3.3.0-desktop. The browser-model bridge is a declared exception.
"""
from pathlib import Path
import hashlib,json,re
source=Path('../v3.2.9-desktop/src/ai').resolve()
target=Path('src/ai/natural-v329').resolve()
manifest=json.loads(Path('artifacts/v330-systems-drury-20261109/NATURAL_V329_FREEZE.json').read_text('utf-8'))
sha=lambda b:hashlib.sha256(b).hexdigest()
results=[]
for row in manifest['files']:
    raw=(source/row['file']).read_bytes()
    frozen=(target/row['file']).read_bytes()
    assert sha(raw)==row['sourceSHA256'],row['file']+' source hash'
    assert sha(frozen)==row['frozenSHA256'],row['file']+' frozen hash'
    if row['file']=='neural/browser-model.ts':
        results.append({'file':row['file'],'verified':'declared shared-singleton bridge','sha256':sha(frozen)})
        continue
    def rewrite(match):
        spec=match.group(2)
        if spec.startswith('.') and not (source/row['file']).parent.joinpath(spec).resolve().is_relative_to(source):
            return match.group(1)+'../'+spec+match.group(3)
        return match.group(0)
    expected=re.sub(r"((?:from\s*|import\s*)['\"])([^'\"]+)(['\"])",rewrite,raw.decode('utf-8')).encode('utf-8')
    assert frozen==expected,row['file']+' has changes beyond import relocation'
    results.append({'file':row['file'],'verified':'exact source bytes after import-only relocation'})
print(json.dumps({'allVerified':True,'files':results},indent=2))
