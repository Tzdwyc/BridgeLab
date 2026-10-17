from pathlib import Path
import json
import urllib.request
root=Path(__file__).resolve().parent.parent
dist=root/'dist'
paths=['index.html','sw.js','manifest.webmanifest']+[p.relative_to(dist).as_posix() for p in (dist/'assets').iterdir() if p.suffix in {'.js','.css'}]
checks=[]
for path in paths:
    with urllib.request.urlopen('http://localhost:5194/'+path,timeout=10) as response:
        checks.append(dict(path=path,matches=response.read()==(dist/path).read_bytes()))
assert all(item['matches'] for item in checks)
result=dict(url='http://localhost:5194/#/table',allMatch=True,files=checks)
(root/'artifacts/v034-live-serving-validation.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print('Verified live v0.3.4 server files:',len(checks))
