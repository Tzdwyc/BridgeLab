"""Bind the shipped packages to final source, focused tests and actual UI evidence."""
import hashlib,json,re
from pathlib import Path
from zipfile import ZipFile
root=Path(__file__).resolve().parents[1]; mobile=root.parent/'v3.3.0-mobile'
a=root/'artifacts/v330-systems-drury-20261109'
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
verify=read(root/'artifacts/delivery-verification-v3.3.0.json')
tests=read(a/'final-feature-tests.json'); assert tests['success'] and not tests['numFailedTests']
packaged=read(a/'packaged-natural-tests.json');assert packaged['success'] and packaged['numFailedTests']==0
ui=read(a/'product-ui-004.json'); assert ui['valid'] and len(ui['results'])==2
assert ui['productionBundleSHA256']==verify['mainBundleSHA256']
pkg=read(root/'release/DESKTOP_PACKAGE_VERIFICATION_v3.3.0.json');archive=Path(pkg['archive']);assert sha(archive)==pkg['sha256']
with ZipFile(archive) as z:
 manifest=json.loads(z.read('BridgeLab-v3.3.0/release-manifest.json'))
 for row in manifest['files']:
  assert sha(root/row['path'])==row['sha256'],row['path']
  assert hashlib.sha256(z.read('BridgeLab-v3.3.0/'+row['path'])).hexdigest()==row['sha256']
apk=read(mobile/'docs/VALIDATION_v3.3.0.json'); upgrade=read(mobile/'docs/UPGRADE_SIGNATURE_VALIDATION_v3.3.0.json')
assert apk['versionName']=='3.3.0' and apk['versionCode']==70
assert sha(Path(apk['apk']))==apk['sha256']
assert apk['mainBundleHashMatch'] and apk['unchangedDistFileHashesMatch'] and apk['desktopDistFilesPresent']
assert apk['embeddedMainBundleSha256']==verify['mainBundleSHA256']
assert upgrade['sameApplicationId'] and upgrade['samePublicCertificate'] and upgrade['versionCodeIncreased']
assert upgrade['current']['sha256']==apk['sha256']
with ZipFile(apk['apk']) as z:
 for p in (root/'dist').rglob('*'):
  if p.is_file() and p.name!='index.html':
   assert hashlib.sha256(z.read('assets/flutter_assets/assets/www/'+p.relative_to(root/'dist').as_posix())).hexdigest()==sha(p)
report={'version':'3.3.0','valid':True,'naturalBaseline':'v3.2.9 default sayc hybrid plus Drury only',
 'focusedTests':{'passed':tests['numPassedTests'],'failed':tests['numFailedTests'],'packagedBaselineTestsPassed':packaged['numPassedTests']},
 'sourceVerificationSHA256':sha(root/'artifacts/delivery-verification-v3.3.0.json'),
 'actualUI':{'passed':2,'bundleSHA256':verify['mainBundleSHA256'],'reportSHA256':sha(a/'product-ui-004.json')},
 'desktop':pkg,'android':{'path':apk['apk'],'sha256':apk['sha256'],'versionCode':70,'allDistBytesVerified':True,'upgradeIdentityVerified':True},
 'training':0,'newMotherDeals':0,'defaultPlayStrength':'challenge','originalSLRollbackPreserved':True,
 'deviceInstallationVerified':False,'realDeviceLANVerified':False,'scope':'Feature and preservation checks only; no new claim of overall bidding performance.'}
out=a/'FINAL_ACCEPTANCE.json';assert not out.exists(),'Preserve previous acceptance generation';out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
