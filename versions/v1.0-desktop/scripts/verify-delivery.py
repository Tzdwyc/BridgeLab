"""Check the v1.0 built application's pinned assets before local packaging."""
import hashlib
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
assert package['version'] == '1.0.0'
index = (root / 'dist/index.html').read_text(encoding='utf-8')
bundle = re.search(r'assets/(index-[\w-]+\.js)', index).group(1)
bundle_path = root / 'dist/assets' / bundle
javascript = bundle_path.read_text(encoding='utf-8')
models = []
for profile, expected in [
    ('seed101-epoch08', '41556ff0f83ced20eeea66a853b87269f3de0ac62b1aca75abce4bf9a63275e3'),
    ('original-sl', '96cc4c3c993d168657e216b8b3bf3ebb681493b965dd6c908ecdee14d45b375f'),
]:
    assert expected in javascript, 'Model identity missing from the application bundle'
    for prefix in ['public', 'dist']:
        folder = root / prefix / 'models/sl' / profile
        assert sha(folder / 'sl.bin') == expected
        assert sha(folder / 'sl.json') == 'ca0a297cb401400465ef0a40088348db2f2241816da11f9ce948c3bcf4b572e9'
        assert (folder / 'LICENSE').is_file() and (folder / 'NOTICE.txt').is_file()
    models.append(dict(profile=profile, weightsSHA256=expected, publicAndBuiltBytesIdentical=True))
assert 'sl-legal' in javascript
for name in ['sw.js', 'manifest.webmanifest']:
    assert (root / 'dist' / name).is_file()
assert (root / 'scripts/start-desktop.ps1').is_file()
report = dict(version='1.0.0', mainBundle=bundle, mainBundleSHA256=sha(bundle_path),
              models=models, defaultProfile='seed101-epoch08', rollbackProfile='original-sl',
              trainingRun=False, scope='Local application asset verification; runtime evidence is separate')
(root / 'artifacts').mkdir(exist_ok=True)
(root / 'artifacts/delivery-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
