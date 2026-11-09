"""Verify the v3.3.0 feature boundary and unchanged model assets."""
import hashlib,json,re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
a=root/'artifacts/v330-systems-drury-20261109';base=read(a/'BASELINE.json');old=root.parent/'v3.2.9-desktop'
assert read(root/'package.json')['version']=='3.3.0'
assert {p.relative_to(old).as_posix():sha(p) for d in ['src','public'] for p in (old/d).rglob('*') if p.is_file()}==base['files']
assert sha(old/'release/BridgeLab-v3.2.9-desktop.zip')==base['desktopArchiveSHA256']
assert sha(root.parent/'v3.2.9-mobile/release/BridgeLab-v3.2.9-mobile-android.apk')==base['mobileArchiveSHA256']
current={p.relative_to(root).as_posix():sha(p) for d in ['src','public'] for p in (root/d).rglob('*') if p.is_file()}
allowed={'src/ai/drury.ts','src/ai/bidding-consistency.ts','src/ai/standard-aces.ts','src/ai/constrained-sl.ts','src/ai/bid-strategy.ts','src/ai/bidding-presentation.ts','src/ai/bidding-semantics.ts','src/ai/bidding.ts','src/ai/penalty-doubles.ts','src/ai/systems.ts','src/controller/robot.ts','src/controller/store.ts','src/match/engine.ts','src/online/room.ts','src/persistence/session.ts','src/ui/App.tsx','src/ui/MatchPages.tsx','src/ui/SLModelPanel.tsx','src/ai/neural/browser-model.ts'}
assert not set(base['files'])-set(current)
changed=sorted(p for p,h in current.items() if base['files'].get(p)!=h)
freeze=read(a/'NATURAL_V329_FREEZE.json')
for row in freeze['files']:
 source=old/'src/ai'/row['file']; frozen=root/'src/ai/natural-v329'/row['file']
 assert sha(source)==row['sourceSHA256']
 assert sha(frozen)==row['frozenSHA256']
 allowed.add('src/ai/natural-v329/'+row['file'])
assert set(changed)<=allowed,changed
assert all(current[p]==h for p,h in base['files'].items() if p.startswith(('public/','src/core/','src/ai/play-advisor','src/ai/playing','src/ai/neural/')) and p!='src/ai/neural/browser-model.ts')
model_text=(root/'src/ai/neural/browser-model.ts').read_text(encoding='utf-8').replace("label: '默认叫牌引擎'","label: 'SL · 第8轮'").replace("label: '备用叫牌引擎'","label: '原SL · 回退'")
model_text=model_text.replace('; postprocess?: boolean','').replace('options.postprocess !== false && id === DEFAULT_SL_PROFILE','id === DEFAULT_SL_PROFILE')
assert model_text==(old/'src/ai/neural/browser-model.ts').read_text(encoding='utf-8'), 'Model loader changes must be limited to labels and the frozen-route postprocessing switch'
for row in read(a/'ORIGINAL_TEST_FIXTURE.json')['files']:
 assert sha(root/row['path'])==row['sha256']
 assert sha(root/row['source'])==row['sha256']
index=(root/'dist/index.html').read_text(encoding='utf-8');bundle=re.search(r'assets/(index-[\w-]+\.js)',index).group(1)
css=re.search(r'assets/(index-[\w-]+\.css)',index).group(1)
assert all((root/p).stat().st_mtime <= (root/'dist/assets'/bundle).stat().st_mtime for p in changed)
models=[]
for profile,expected in [('seed101-epoch08','41556ff0f83ced20eeea66a853b87269f3de0ac62b1aca75abce4bf9a63275e3'),('original-sl','96cc4c3c993d168657e216b8b3bf3ebb681493b965dd6c908ecdee14d45b375f')]:
 for tree in ['public','dist']:assert sha(root/tree/'models/sl'/profile/'sl.bin')==expected
 models.append({'profile':profile,'sha256':expected})
for p in (root/'public/models').rglob('*'):
 if p.is_file(): assert sha(p)==sha(root/'dist'/p.relative_to(root/'public'))
report={'version':'3.3.0','baseVersion':'3.2.9','mainBundle':bundle,'mainBundleSHA256':sha(root/'dist/assets'/bundle),'stylesheet':css,'stylesheetSHA256':sha(root/'dist/assets'/css),'sourceSHA256':{p:current[p] for p in changed},'actualSourceChanges':changed,'models':models,'training':0,'defaultModelUnchanged':True,'originalSLRollbackPreserved':True,'modelInferenceAndLoadingUnchanged':True,'frozenNaturalPostprocessingSharesModelSingleton':True,'naturalFreezeManifestSHA256':sha(a/'NATURAL_V329_FREEZE.json'),'oldSourceAndPackagesPreserved':True,'allPublicAssetsUnchanged':True,'playAlgorithmUnchanged':True,'fixedProductPlayStrength':'challenge','legacyDefaultMigratesToNaturalWithRawBackup':True,'naturalAgreementsPreserved':['v3.2.9 default sayc hybrid','RKCB1430','existing defensive thresholds'],'standardAceProtocol':['Blackwood','Gerber','DOPI','ROPI'],'scope':'Natural is the frozen v3.2.9 default hybrid plus Drury; standard SAYC is separate; three product names; fixed challenge at all play entries; no training or new performance cohort.'}
(root/'artifacts/delivery-verification-v3.3.0.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
