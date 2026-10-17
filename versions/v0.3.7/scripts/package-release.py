"""Package verified source + built PWA; skip dependencies and transient caches."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from os import walk
import hashlib
import json
import subprocess
import sys


root = Path(__file__).resolve().parent.parent
# Recheck current evidence and exact APK/dist bytes immediately before packaging.
subprocess.run([sys.executable, str(root / 'scripts/verify-delivery.py')], cwd=root, check=True)
dest = root / 'artifacts' / 'BridgeLab-v0.3.7-source-and-app.zip'
temp_dest = dest.with_name(dest.name + '.tmp')
prefix = 'BridgeLab-v0.3.7/'
excluded = {'node_modules', '.git', 'test-results', 'playwright-report', '.agents', '.codex', '__pycache__', 'release4-preserved', 'type-trace', 'e2e-inherited-traces', 'table-runs', 'v037-pages-tests', 'v037-table-tests', 'workbench-special-test', 'workbench-test-results'}
required = ['README.md', 'dist/sw.js', 'src/core/game.ts', 'src/analysis/vendor/dds.mjs',
            '启动BridgeLab-v0.3.7.cmd', 'docs/TEST_REPORT.md', 'docs/THIRD_PARTY_LICENSES.md',
            'vendor/dds-reference/LICENSE', 'vendor/bridge-dds-LICENSE', 'artifacts/delivery-verification.json']
missing = [path for path in required if not (root / path).is_file()]
if missing or not list((root / 'dist/assets').glob('worker-*.js')) or not list((root / 'dist/assets').glob('play-advisor-worker-*.js')):
    raise SystemExit(f'Release prerequisites missing: {missing or ["dist/assets/worker-*.js"]}')
files = []
for directory, dirs, names in walk(root):
    dirs[:] = [name for name in dirs if name not in excluded and not name.startswith(('pages-final', 'type-trace', 'playwright-trace', 'failed-trace', 'previous-')) and
               Path(directory, name) != root / 'vendor' / 'dds-reference' / 'hands']
    for name in names:
        p = Path(directory) / name
        # Keep final reports/screenshots and small negative JSON evidence; traces stay local.
        if p.name.endswith(('.zip.tmp', '.trace', '.webm')) or (p.is_relative_to(root / 'artifacts') and p.suffix == '.json' and p.stat().st_size > 2 * 1024 * 1024 and any(x in p.name for x in ('failed', 'before', 'attempt'))):
            continue
        if p.suffix in {'.zip', '.tsbuildinfo', '.log'} or p.name in {'release-manifest.json', 'release-summary.json', '清理旧版-用户本机执行.ps1'} or p.name.startswith('runtime.'):
            continue
        files.append(p)
files.sort()
manifest = {'version': '0.3.7', 'files': []}
for p in files:
    manifest['files'].append({'path': p.relative_to(root).as_posix(),
                              'bytes': p.stat().st_size,
                              'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
(root / 'artifacts' / 'release-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
if temp_dest.exists():
    temp_dest.unlink()
with ZipFile(temp_dest, 'w', ZIP_DEFLATED) as z:
    for p in files:
        z.write(p, prefix + p.relative_to(root).as_posix())
    z.write(root / 'artifacts' / 'release-manifest.json', prefix + 'artifacts/release-manifest.json')
with ZipFile(temp_dest) as z:
    assert z.testzip() is None
    for path in required:
        assert prefix + path in z.namelist(), path
    assert any(name.startswith(prefix + 'dist/assets/worker-') for name in z.namelist())
    assert not any('/node_modules/' in name or '/.git/' in name or '/vendor/dds-reference/hands/' in name for name in z.namelist())
    for item in manifest['files']:
        assert hashlib.sha256(z.read(prefix + item['path'])).hexdigest() == item['sha256'], item['path']
temp_dest.replace(dest)
summary = {'archive': str(dest), 'version': '0.3.7', 'files': len(files)+1, 'bytes': dest.stat().st_size,
           'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'crcVerified': True, 'allFileHashesVerified': True}
(root / 'artifacts' / 'release-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False))
