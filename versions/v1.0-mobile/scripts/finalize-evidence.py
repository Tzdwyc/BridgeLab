"""Validate the double-column code44 release with truthful code43/44 evidence."""
from pathlib import Path
import hashlib,json,re,zipfile
from datetime import datetime,timezone
root=Path(__file__).resolve().parent.parent;desktop=root.parent/'v0.3.7';docs=root/'docs';previous=root/'artifacts/previous-code43'
def digest(path):
 with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def write(name,value):(docs/name).write_text(json.dumps(value,indent=2),encoding='utf-8')
validation=read(docs/'VALIDATION.json');sync=read(docs/'SYNC_MANIFEST.json')
assert validation['versionCode']==44 and validation['versionName']=='0.3.7'
assert digest(validation['apk'])==validation['sha256']
assert validation['applicationId']=='cn.bridgelab.v03mobile' and validation['storageOrigin']=='http://127.0.0.1:51893'
assert validation['storageKey']=='bridgelab.session.v3.6' and sync['desktopVersion']=='0.3.7'
old036=read(docs/'PREPARATION.json')
for row in old036['previousFiles']:assert digest(Path(old036['sourceMobile'])/row['path'])==row['sha256'],row['path']
previous_manifest=read(previous/'PRESERVATION_MANIFEST.json')
for row in previous_manifest['files']:assert digest(previous/row['path'])==row['sha256'],row['path']
for row in sync['desktopDistFiles']:assert digest(desktop/'dist'/row['path'])==row['sha256'],row['path']
post_sync_docs=[]
for row in sync['sourceSnapshotFiles']:
 snapshot=root/'upstream-src'/row['path'];assert digest(snapshot)==row['sha256'],row['path']
 if digest(desktop/row['path'])!=row['sha256']:
  if row['path'].startswith('docs/'):post_sync_docs.append(row['path'])
  else:raise AssertionError(row['path'])
source_lines=[f"{row['path']}={row['sha256']}" for row in sync['sourceSnapshotFiles']]
assert hashlib.sha256('\n'.join(source_lines).encode()).hexdigest()==sync['sourceSnapshotSha256']
native_inputs=read(docs/'NATIVE_VALIDATION_INPUTS_CODE44.json')
assert native_inputs['nativeSourcesAndDependenciesUnchanged']
for row in native_inputs['files']:assert digest(root/row['path'])==row['sha256'],row['path']
layout=read(docs/'WEB_LAYOUT_VALIDATION.json');recovery=read(docs/'UPGRADE_RECOVERY_VALIDATION.json');upgrade=read(docs/'UPGRADE_SIGNATURE_VALIDATION.json')
assert layout['version']=='0.3.7+44' and recovery['previousVersion']=='0.3.7+43' and recovery['version']=='0.3.7+44'
assert layout['desktopMainBundle']==validation['desktopMainBundle']==recovery['currentBundle']
web_inputs=read(docs/'WEB_VERIFICATION_INPUTS_CODE44.json')
assert web_inputs['freshBrowserVerification'] and web_inputs['desktopMainBundle']==validation['desktopMainBundle']
for row in web_inputs['files']:assert digest(root/'assets/www'/row['path'])==row['sha256'],row['path']
assert all(row['auctionHistoryScrollsInsideFrame'] and row['auctionHistoryPaginationRemoved'] and row['allAuctionCallsRendered'] for row in layout['results'])
assert all(all(check['suitsInSeparateHorizontalRows'] and check['allCardFacesInsideSeat'] for check in row['publicDummyChecks']) for row in layout['results'])
assert all(len(row['trickScoreChecks'])==6 and all(check['correctValues'] and check['correctTarget'] and check['verticalColumns'] and check['noLeftScale'] and check['noDocumentScroll'] for check in row['trickScoreChecks']) for row in layout['results'])
assert all(row['fixedNorthSouthSeats'] and row['noHandSwitchControls'] and row['dummyRemainsNorthAfterAction'] and row['publicEastDummyCardsRendered'] and row['publicWestDummyCardsRendered'] and row['hiddenOpponentCardsRemainHidden'] for row in layout['results'])
assert recovery['sessionV36UnchangedBeforeUserAction'] and recovery['existingV36ArchiveUnchanged'] and recovery['noV037StorageKeyCreated']
assert recovery['stalePreviousWorkboxCacheReproduced'] and recovery['offlineReloadAndContinuedBid'] and recovery['offlineArchivedReplay'] and recovery['offlineReplayPositions']==[0,1,52,0]
assert upgrade['current']['versionCode']==44 and upgrade['previous']['versionCode']==43
assert upgrade['sameApplicationId'] and upgrade['samePublicCertificate'] and upgrade['versionCodeIncreased']
native_entries=[]
with zipfile.ZipFile(validation['apk']) as current,zipfile.ZipFile(previous/'release/BridgeLab-v0.3.7-mobile-android.apk') as old:
 for name in current.namelist():
  if re.fullmatch(r'classes\d*\.dex|lib/[^/]+/libapp\.so',name):
   current_hash=hashlib.sha256(current.read(name)).hexdigest();previous_hash=hashlib.sha256(old.read(name)).hexdigest()
   native_entries.append({'path':name,'sha256':current_hash,'code43Sha256':previous_hash,'sameAsCode43':current_hash==previous_hash})
assert len(native_entries)==4 and all(row['sameAsCode43'] for row in native_entries)
paths=[]
for folder in ['lib','test','scripts']:paths.extend(path for path in (root/folder).rglob('*') if path.is_file() and '__pycache__' not in path.parts)
paths.extend(path for path in (root/'android/app/src').rglob('*') if path.is_file())
for name in ['pubspec.yaml','pubspec.lock','analysis_options.yaml','mobile-overrides/mobile.css','android/app/build.gradle.kts','android/build.gradle.kts','android/settings.gradle.kts','android/gradle.properties','android/gradle/wrapper/gradle-wrapper.properties']:paths.append(root/name)
write('MOBILE_BUILD_INPUTS.json',{'verifiedAt':datetime.now(timezone.utc).isoformat(),'version':'0.3.7+44','files':[{'path':path.relative_to(root).as_posix(),'sha256':digest(path)} for path in sorted(set(paths))]})
notes={'verifiedAt':datetime.now(timezone.utc).isoformat(),'version':'0.3.7+44','previousVersion':'0.3.7+43','previousCandidate':'artifacts/previous-code43','previousApkSha256':upgrade['previous']['sha256'],'finalApkSha256':validation['sha256'],'bytes':validation['bytes'],'bundle':validation['desktopMainBundle'],'desktopDistFilesMatched':len(sync['desktopDistFiles']),'upstreamSourceSnapshotFilesVerified':len(sync['sourceSnapshotFiles']),'runtimeSourceAndDistUnchanged':True,'postSyncDocumentationChanges':post_sync_docs,'sourceSnapshotSha256':sync['sourceSnapshotSha256'],'upstreamDeliveryVerifierSha256':digest(root/'upstream-src/scripts/verify-delivery.py'),'previousV036AnchorsUnchanged':len(old036['previousFiles']),'previousCode43PreservedFilesVerified':len(previous_manifest['files']),'storageKey':'bridgelab.session.v3.6','libraryDatabase':'bridgelab.library.v3.6','nativeSourcesAndDependenciesUnchangedFromCode41':True,'controlledVersionMetadataChanges':native_inputs['controlledVersionMetadataChanges'],'nativeBinaryEntriesComparedToCode43':native_entries,'browserVerification':'Fresh code44 double-column tricks display and side-suit horizontal rows, 25-call internal history scrolling and fixed-seat portrait/landscape, file bridge and real code43 SW recovery/offline 52-play replay','physicalDeviceTested':False,'evidenceBoundary':'Unchanged native source tests reused with a recorded version-metadata exception; new APK signature/assets and fixed-seat browser behavior verified fresh. No physical Android/WebView/document-picker test.'}
write('POSTBUILD_SOURCE_NOTES.json',notes)
text=(root/'README.md').read_text(encoding='utf-8').split('\n<!-- FINAL_VALIDATION -->')[0]
text=text.replace('Version 0.3.7 (43)', 'Version 0.3.7 (44)')
text=re.sub(r'\nCode(?:43|44) (?:side-suit|double-column) revision:[^\n]*\n','\n',text)
text+='\nCode44 double-column revision: NS/EW tricks appear as two vertical columns without the left numeric scale, with the contract target on the declaring side. East/West public dummy cards retain real CardView faces and their original seats, with one horizontal row per suit (S/H/D/C). Code43 release, source and evidence are preserved under `artifacts/previous-code43`.\n'
text+='\n<!-- FINAL_VALIDATION -->\nInstall `release/BridgeLab-v0.3.7-mobile-android.apk` (code44; '+f"{validation['bytes']:,}"+' bytes). SHA-256: `'+validation['sha256']+'`.\n\nFresh double-column tricks display, side-suit horizontal-row and fixed-seat mobile browser checks, exact code43 stale-Workbox recovery, v3.6 data retention, offline continued bid and 52-play archived replay passed. Package/assets/signature and code43 -> code44 upgrade compatibility passed. Native code is unchanged; prior format/analysis/7 Flutter tests/8 JavaScript checks were reused with SHA-256 equality and the explicit pubspec version metadata exception. Physical Android installation, WebView and document picker remain untested.\n'
(root/'README.md').write_text(text,encoding='utf-8')
write('CURRENT_GENERATION.json',{'updatedAt':datetime.now(timezone.utc).isoformat(),'version':'0.3.7+44','status':'Final APK built and verified','apk':'release/BridgeLab-v0.3.7-mobile-android.apk','sha256':validation['sha256'],'previousDeliveredVersion':'0.3.7+43','previousDelivery':'artifacts/previous-code43','authoritativeReports':['docs/VALIDATION.json','docs/UPGRADE_SIGNATURE_VALIDATION.json','docs/WEB_LAYOUT_VALIDATION.json','docs/UPGRADE_RECOVERY_VALIDATION.json','docs/POSTBUILD_SOURCE_NOTES.json','docs/BUILD_LOG_CODE44.txt'],'physicalDeviceTested':False})
print(json.dumps(notes,indent=2))
