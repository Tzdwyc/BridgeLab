from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent.parent
old=root.parent/'v0.3.2'
snapshot=json.loads((root/'artifacts/v032-current-preservation-snapshot.json').read_text('utf8'))
digest=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
changed=[name for name,sha in snapshot['files'].items() if not(old/name).is_file() or digest(old/name)!=sha]
archive=old/'artifacts/BridgeLab-v0.3.2-source-and-app.zip'
expected='a41c2f5cd77a08d59db088511c47938a08b2b25b862c6775ad17740f6c34fe9e'
mobile=old.parent/'v0.3.2-mobile/release/BridgeLab-v0.3.2-mobile-android.apk'
mobile_expected=(mobile.with_suffix('.sha256')).read_text('utf8').split()[0]
result=dict(filesCompared=len(snapshot['files']),changed=changed,currentWorkingSnapshotPreserved=not changed,originalDeliveredArchiveSha256=digest(archive),originalDeliveredArchivePreserved=digest(archive)==expected,oldMobileApkPreserved=digest(mobile)==mobile_expected)
(root/'artifacts/v032-current-preservation-result.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result))
assert not changed and result['originalDeliveredArchivePreserved'] and result['oldMobileApkPreserved']
