"""Package v330 systems and Drury and only its bounded evidence."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(root / 'scripts/verify-delivery.py')], cwd=root, check=True)
release = root / 'release'; release.mkdir(exist_ok=True)
archive = release / 'BridgeLab-v3.3.0-desktop.zip'
assert not archive.exists(), 'Preserve an existing package; do not overwrite'
files = []
for folder in ['src','public','dist','scripts','tests','docs','vendor']:
    files.extend(p for p in (root / folder).rglob('*') if p.is_file() and not any(x in {'node_modules','__pycache__','.git'} for x in p.parts))
for name in ['README.md','LICENSE','index.html','package.json','package-lock.json','tsconfig.json','vite.config.ts','启动BridgeLab-v3.3.0.cmd']:
    files.append(root / name)
files.extend(p for p in root.glob('playwright*.config.*') if p.is_file())
evidence = root / 'artifacts/v330-systems-drury-20261109'
files.extend(p for p in evidence.rglob('*') if p.is_file() and p.suffix in {'.py','.json','.md','.png','.log','.html','.mjs','.ts','.tsx','.css'} and p.name != 'FINAL_ACCEPTANCE.json' and not p.name.startswith('package-'))
files.extend(p for p in (root / 'artifacts').glob('*v3.3.0*.json') if p.is_file())
files = sorted(set(files))
manifest = {'version':'3.3.0','scope':'Systems, Drury, fixed challenge and public UI changes; no training',
            'files':[{'path':p.relative_to(root).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
prefix = 'BridgeLab-v3.3.0/'
with ZipFile(archive,'x',ZIP_DEFLATED,compresslevel=6) as package:
    for p in files: package.write(p, prefix + p.relative_to(root).as_posix())
    package.writestr(prefix+'release-manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
with ZipFile(archive) as package:
    assert package.testzip() is None
    for row in manifest['files']: assert hashlib.sha256(package.read(prefix+row['path'])).hexdigest() == row['sha256']
report = {'version':'3.3.0','archive':str(archive),'bytes':archive.stat().st_size,'files':len(files),
          'crcVerified':True,'allFileHashesVerified':True,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
(release/'BridgeLab-v3.3.0-desktop.sha256').write_text(report['sha256']+'  '+archive.name+'\n',encoding='utf-8')
(release/'DESKTOP_PACKAGE_VERIFICATION_v3.3.0.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
