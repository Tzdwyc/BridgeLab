"""Package desktop source and ready-to-run application, including both SL models."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(root / 'scripts/verify-delivery.py')], cwd=root, check=True)
release = root / 'release'; release.mkdir(exist_ok=True)
archive = release / 'BridgeLab-v1.0-desktop.zip'
assert not archive.exists(), 'Preserve an existing release generation before packaging again'
files = []
for name in ['src', 'public', 'dist', 'scripts', 'tests', 'docs', 'vendor']:
    for path in (root / name).rglob('*'):
        if path.is_file() and not any(part in {'__pycache__', 'hands', 'node_modules', '.git'} for part in path.parts):
            files.append(path)
for name in ['README.md', 'LICENSE', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
             'playwright.config.ts', '启动BridgeLab-v1.0.cmd']:
    files.append(root / name)
for name in ['delivery-verification.json', 'v1-sl-portable-replay-tests.json', 'v1-match-version-tests.json', 'v1-final-acceptance-tests.json',
             'v1-release-verification.json', 'desktop-model-verified.png']:
    path = root / 'artifacts' / name
    if path.exists(): files.append(path)
files = sorted(set(files))
manifest = dict(version='1.0.0', files=[dict(path=p.relative_to(root).as_posix(), bytes=p.stat().st_size,
                 sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in files])
prefix = 'BridgeLab-v1.0/'
with ZipFile(archive, 'x', ZIP_DEFLATED, compresslevel=6) as z:
    for path in files: z.write(path, prefix + path.relative_to(root).as_posix())
    z.writestr(prefix + 'release-manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
with ZipFile(archive) as z:
    assert z.testzip() is None
    for item in manifest['files']:
        assert hashlib.sha256(z.read(prefix + item['path'])).hexdigest() == item['sha256']
report = dict(archive=str(archive), version='1.0.0', bytes=archive.stat().st_size,
              files=len(files), crcVerified=True, allFileHashesVerified=True,
              sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
(release / 'DESKTOP_PACKAGE_VERIFICATION.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
(release / 'BridgeLab-v1.0-desktop.sha256').write_text(report['sha256'] + '  ' + archive.name + '\n', encoding='utf-8')
print(json.dumps(report))
