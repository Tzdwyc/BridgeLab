"""Seal the approved three-part v3.1.1 presentation revision."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
read = lambda p: json.loads((root / p).read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assets = read('artifacts/delivery-verification-v3.1.1.json')
baseline = read('artifacts/V311_BUSINESS_BASELINE.json')
assert all(sha(root / x['path']) == x['sha256'] for x in baseline['files'])
typing = read('artifacts/typecheck-v311.json')
assert typing['exitCode'] == 0
unit = read('artifacts/v311-regression.json')
assert unit['success'] and unit['numPassedTests'] == 153 and unit['numFailedTests'] == 0
assert read('artifacts/v311-regression-process.json')['exitCode'] == 0
ui = read('artifacts/v311-ui/results.json')['stats']
lan = read('artifacts/v311-lan-ui/results.json')['stats']
for stats, count in [(ui, 40), (lan, 13)]:
    assert stats['expected'] == count and stats['unexpected'] == stats['skipped'] == stats['flaky'] == 0
offline = read('artifacts/v311-ui/offline.json')
assert offline['passed'] and all(offline['fonts'].values())
assert offline['bundleSHA256'] == assets['mainBundleSHA256']
assert offline['css']['sha256'] == assets['stylesheetSHA256']
assert read('artifacts/v311-ui/settings-models.json')['passed']
assert read('artifacts/v311-ui/tab-return.json')['passed']
assert sha(root.parent / 'v3.1-desktop/release/BridgeLab-v3.1-desktop.zip') == '48f5b52624620d90171411f86802d35dfd5fbcb55a478358f242c20cb0609283'
assert sha(root.parent / 'v3.1-mobile/release/BridgeLab-v3.1.0-mobile-android.apk') == '7cbb70dde2965cc580b0de2dcfb92ebef650682e62389d695590a3d3b36a669b'
report = dict(version='3.1.1', sealedAtUTC=datetime.now(timezone.utc).isoformat(),
              assets=assets, unchangedBusinessFiles=len(baseline['files']), oldV31PackagesUnchanged=True,
              typecheck=typing, unitPassed=153, productionUI=ui, componentLAN=lan, offline=offline,
              tabReturn=read('artifacts/v311-ui/tab-return.json'), trainingRun=False,
              viewports=['360x640','390x844','412x635','635x388','844x390','1440x900'],
              scope=['Full persistent auction while bidding','Flat icon and text navigation',
                     'One-row ordinary player hand; explicitly suit-grouped dummy at its seat'],
              boundaries=['LAN fixture is presentation plus real room-request validation',
                          'Native Android proof is recorded separately in mobile/docs',
                          'No physical same-WiFi validation claim'])
(root / 'artifacts/V311_ACCEPTANCE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
text = f'''# BridgeLab v3.1.1 三项界面修订验收

本次按批准范围完成三项修订，字体、配色与其他业务沿用v3.1。

1. 叫牌阶段默认显示完整四列记录，保留全部前序；正常长度直接阅读，长序列在记录区滚动，可回到首叫。没有以最近叫品卡替代完整记录。打牌后记录仍可回看。
2. 底部改为图标和文字一体的标签导航，无独立按钮边框、阴影或选中胶囊。历史、分析、联机切回单机时，直接返回当前牌桌并保持当前记录。
3. 普通本人手牌平直单排，保留所有牌角点数和花色。明手显式按四花色分组摆在相应席位；本人恰为明手也进入分组模式，不混用普通手牌样式。

| 核验 | 结果 |
| --- | --- |
| 最终生产版界面 | 40/40通过 |
| 联机呈现与真实房间动作校验 | 13/13通过 |
| 核心、存档、比赛、控制器、联机回归 | 153项通过，零失败 |
| 严格类型检查 | exitCode 0 |
| 离线重载 | 最终JS、CSS与三款字体通过 |
| 标签切换 | 三页返回当前桌，原current记录完全相同 |
| 模型切换 | 原SL与第8轮实际加载对应原SHA |
| 业务保护 | AI、核心、控制器、协议、存档、比赛等55个文件与v3.1逐字哈希相同 |
| 旧版保护 | v3.1原ZIP及APK哈希保持不变 |

窗口为360×640、390×844、412×635、635×388、844×390、1440×900。覆盖本人单排、四个明手席位及本人作为明手、缺门与13张长套、完整长叫牌记录上滚、125%字号、牌角遮挡命中、真实合法出牌与全部52张界面结算。触控目标尺寸与紧凑叠牌露边分别记录，不将所有露边宣称44px。

完整表格立即显示，历史说明只在悬停、聚焦或长按时按原公共前序求值并缓存；没有修改AI说明函数或叫牌规则。初稿遮挡失败与修复复验另存，不代替最终生产结果。

最终程序：{assets['mainBundle']}，SHA-256：{assets['mainBundleSHA256']}。

最终样式：{assets['stylesheet']}，SHA-256：{assets['stylesheetSHA256']}。

Android实际升级、旧存档、真实JS/CSS与字体、横竖屏触控、本人明手与联机视角报告独立位于相邻v3.1.1-mobile/docs。模拟器不等于实体手机同Wi-Fi验证。本轮不训练、不扩展叫牌规则审计。
'''
(root / 'docs/V311_ACCEPTANCE.md').write_text(text,encoding='utf-8')
print(json.dumps({'sealed':True,'ui':40,'lan':13,'unit':153,'unchangedBusinessFiles':55}))
