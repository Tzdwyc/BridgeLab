"""Seal the fixed v3.1 UI acceptance, without changing game or AI sources."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
read = lambda p: json.loads((root / p).read_text(encoding='utf-8-sig'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assets = read('artifacts/delivery-verification-v3.1.json')
baseline = read('artifacts/V31_BUSINESS_BASELINE.json')
assert all(sha(root / x['path']) == x['sha256'] for x in baseline['files'])
typing = read('artifacts/typecheck-v31.json')
assert typing['exitCode'] == 0
unit = read('artifacts/v31-regression.json')
assert unit['success'] and unit['numPassedTests'] == 153 and unit['numFailedTests'] == 0
assert read('artifacts/v31-regression-process.json')['exitCode'] == 0
ui = read('artifacts/v31-ui/results.json')['stats']
lan = read('artifacts/v31-lan-ui/results.json')['stats']
for stats, count in [(ui, 33), (lan, 12)]:
    assert stats['expected'] == count and stats['unexpected'] == stats['skipped'] == stats['flaky'] == 0
offline = read('artifacts/v31-ui/offline.json')
assert offline['passed'] and all(offline['fonts'].values())
assert offline['bundle'] == assets['mainBundle'] and offline['bundleSHA256'] == assets['mainBundleSHA256']
assert offline['stylesheet'] == assets['stylesheet'] and offline['css']['sha256'] == assets['stylesheetSHA256']
assert read('artifacts/v31-ui/settings-models.json')['passed']
assert sha(root.parent / 'v3-desktop/release/BridgeLab-v3-desktop.zip') == 'f9ea0e68dac2054946e165e3a9c4e92ff2501aa0c4c5812d4fb525033bfa88a8'
assert sha(root.parent / 'v3-mobile/release/BridgeLab-v3.0.0-mobile-android.apk') == '68040d66436f47d8bbe2303461eb4e9432569442c6a6db7a73c9c02106d929d8'
report = dict(version='3.1.0', sealedAtUTC=datetime.now(timezone.utc).isoformat(),
              assets=assets, unchangedBusinessFiles=len(baseline['files']), oldV3PackagesUnchanged=True,
              typecheck=typing, unitPassed=153, productionUI=ui, componentLAN=lan, offline=offline,
              actualSLProfileSwitch=read('artifacts/v31-ui/settings-models.json'), trainingRun=False,
              viewports=['360x640', '390x844', '412x635', '635x388', '844x390', '1440x900'],
              boundaries=['LAN component fixture uses deterministic private snapshots and real room request validation',
                          'Native Android runtime validation is recorded separately in mobile/docs',
                          '44px target applies to main buttons; compact card exposure is tested by actual rank hit points',
                          'No physical-phone same-WiFi validation claim'])
(root / 'artifacts/V31_ACCEPTANCE.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
text = f'''# BridgeLab v3.1 体验改版验收

版本为3.1.0。主视觉采用墨绿牌桌、暖白纸牌及本地字体；单机、联机共用四方牌桌组件。桌面有右侧操作栏，手机根据横竖屏分配手牌及叫牌器，保留底部四个入口。设置首屏提供标准／125%大字、传统黑红／四色及动画开关。

| 核验 | 最终结果 |
| --- | --- |
| 生产版Edge | 33/33通过 |
| LAN呈现与真实room request校验 | 12/12通过 |
| 核心、存档、比赛、控制器与联机回归 | 153项通过，零失败 |
| 严格TypeScript检查 | exitCode 0 |
| 离线重载 | 主程序、最终CSS与三款字体均通过，无外部字体请求 |
| 模型设置 | 实际切换并加载原SL与第8轮，SHA均对应原权重 |
| 业务源文件 | AI、核心、控制器、联机协议、存档、比赛等55个文件与v3哈希一致 |
| 原v3安装包 | 桌面ZIP及APK原哈希均保持不变 |

固定窗口为360×640、390×844、412×635、635×388、844×390、1440×900。覆盖四个明手席位、本人E/W视角、单花色长套、合法控制权与跟牌、叫牌器最低合法阶数、长按说明不提交、大字与偏好独立持久化。对牌角进行elementFromPoint触点检查，并查看实际PNG，避免仅以矩形未溢出代替无遮挡验证。一副牌通过实际界面点击完成全部52张出牌至结算，没有用声称代替。

本次不修改叫牌约定、模型、计分、联机协议或训练数据，没有追加训练。固定短方块精确卡和自然体系继续使用v3的已有入口。

最终程序：{assets['mainBundle']}，SHA-256：{assets['mainBundleSHA256']}。

最终样式：{assets['stylesheet']}，SHA-256：{assets['stylesheetSHA256']}。

字体为思源黑体官方简体区域版、Inter和Source Serif4，原始来源及许可证随public/fonts提供。安卓实测曾发现完整区域大字库在Chrome113 WebView解码失败；该负证据保留，最终改用同款官方简体区域文件并先通过真实WebView解码探针，未将桌面通过替代安卓字体验证。

LAN浏览器呈现测试使用隔离组件fixture及真实房间动作校验，不冒称物理网络测试。Android最终安装、旧存档保留、实际JS/CSS与字体、触控及机器人补位报告位于相邻v3.1-mobile/docs。模拟器测试不等于实体手机同Wi-Fi实测。

主要叫牌和通用操作按钮按44px目标验证；窄屏叠牌露边及部分紧凑明手牌小于44px，另用真实牌角触点、合法动作回调和原生截图核验，不将这些纸牌宣称为44×44。

本轮按上述固定场景收尾；不借视觉改版扩展叫牌规则审计。
'''
(root / 'docs/V31_ACCEPTANCE.md').write_text(text, encoding='utf-8')
print(json.dumps({'sealed': True, 'ui': 33, 'lan': 12, 'unit': 153, 'unchangedBusinessFiles': 55}))
