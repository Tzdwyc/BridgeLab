"""Seal local v3 desktop evidence after the fixed acceptance gates pass."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
read = lambda name: json.loads((root / name).read_text(encoding='utf-8-sig'))
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
fresh = read('artifacts/precision-v3/512-summary.json')
legacy = read('artifacts/precision-v3-legacy500/legacy500-summary.json')
for result, count in [(fresh, 512), (legacy, 500)]:
    assert result['count'] == result['completed'] == count
    assert result['problematicBoards'] == 0 and result['issues'] == []
    assert result['naturalSLLoaded'] is False
frozen = read('artifacts/precision-v3/512-freeze.json')['sourceHashes']
assert frozen == read('artifacts/precision-v3-legacy500/legacy500-freeze.json')['sourceHashes']
assert all(sha(root / name) == digest for name, digest in frozen.items())
focused = read('artifacts/v3-precision-final.json')
regression = read('artifacts/v3-regression-final.json')
assert focused['success'] and focused['numPassedTests'] == 181 and focused['numFailedTests'] == 0
assert regression['success'] and regression['numPassedTests'] == 694 and regression['numFailedTests'] == 0
assert read('artifacts/v3-precision-process.json')['exitCode'] == 0
typing = read('artifacts/typecheck-v3-delivery.json')
assert typing['exitCode'] == 0
ui = read('artifacts/v3-ui/results.json')['stats']
assert ui['expected'] == 4 and ui['unexpected'] == ui['skipped'] == ui['flaky'] == 0
delivery = read('artifacts/delivery-verification-v3.json')
assert sha(root / 'dist/assets' / delivery['mainBundle']) == delivery['mainBundleSHA256']
baseline = read('docs/V3_SOURCE_BASELINE.json')
old = root.parent / 'v2-desktop'
assert all(sha(old / item['path']) == item['sha256'] for item in baseline['files'])
report = {
    'version': '3.0.0', 'sealedAtUTC': datetime.now(timezone.utc).isoformat(),
    'agreementVersion': fresh['agreementVersion'], 'fresh512': fresh, 'legacy500': legacy,
    'precisionFocused': 108, 'originalNaturalFitTests': 73, 'currentRegression': 694,
    'legacyAssertionsNotApplicable': 18, 'legacy500HarnessReplacedByProductionReplay': True,
    'strictTypecheck': typing, 'productionEdge': ui, 'distribution': delivery,
    'originalV2SourceFilesUnchanged': len(baseline['files']), 'trainingRun': False,
    'limits': ['Fixed short-diamond Precision card; no complex relay, Ogust or gambling 3NT',
               'Functional agreement verification is not an expert-strength comparison',
               '844x390 landscape retains existing partial card-rank overlap; no layout redesign'],
}
(root / 'artifacts/V3_ACCEPTANCE.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
ui_report = read('artifacts/v3-ui/acceptance-summary.json')
ui_report['result'] = ui
ui_report['distribution'] = delivery
ui_report['generation'] = 'final-delivery'
(root / 'artifacts/v3-ui/acceptance-summary.json').write_text(json.dumps(ui_report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
text = f'''# BridgeLab v3 验收记录

交付版本为 3.0.0，固定短方块精确卡为 {fresh['agreementVersion']}。精确制已接入单机、比赛主桌与参考桌、提示、存档、分析室及联机机器人。自然体系仍保留第8轮及原SL切换；本轮没有训练。

| 核验 | 结果 |
| --- | --- |
| 精确制专项 | 108项通过 |
| 原自然制配合及RKCB回归 | 73项通过 |
| 当前综合回归 | 694项通过，零失败 |
| 固定新牌 | 512/512完整结算，零协议问题 |
| 原有精确制种子 | 500/500经实际生产入口完整结算，零协议问题 |
| 历史牌与公开解释 | 32副完整牌；251个前序、9538条解释、1485项未来独立性检查通过 |
| 严格类型检查 | exitCode 0 |
| 最终生产版Edge | 4/4通过 |
| v2源文件 | 249个原哈希保持一致 |

新牌与旧牌共8791次实际叫牌，均通过候选资格与公开语义检查；精确制未加载SL。NT问叫解释与义务入口同时核对。资格过滤后的自然选择分别为15及16次，仍使用同一候选约束。全部失败生成与具体前序均已保留在 artifacts 下的历史代目录。

历史宽跑713项的原始结果保留在 artifacts/v3-regression.json。18项旧精确制合成断言使用与0–7负应不相容的手牌或旧满贯预期，没有计入当前通过数量；另外1项旧混合入口的500副脚本改由同种子、真实生产入口逐副重放。当前694项有效断言全部重新执行，不通过改写旧断言取得通过。

最终主程序为 {delivery['mainBundle']}，SHA-256 为 {delivery['mainBundleSHA256']}。默认第8轮及原SL的实际加载和机器人叫牌均经浏览器验证；精确制在SL文件返回404时仍完成机器人叫牌、提示和参考桌结算。导出、导入、刷新及旧记录未知体系标记通过。

安卓包与原生验证另见 ../v3-mobile/docs 的最终验证报告。模拟器原生房主、客户端、断线恢复、隐私和完整52张出牌的预验证证据保留其实际包哈希；最终包另核对实际加载的新程序及机器人。ADB辅助的模拟器网络不等于实体手机同Wi-Fi实测。

本轮完成固定精确卡的功能闭环，不把此结果表述为专家级牌力或相对自然制的牌力提升。复杂强梅花接力、Ogust及赌博3NT不在本卡。844×390横屏仍有既存的手牌牌点局部遮挡，本轮没有扩展布局修改。
'''
(root / 'docs/V3_ACCEPTANCE.md').write_text(text, encoding='utf-8')
print(json.dumps({'sealed': True, 'fresh': 512, 'legacy': 500, 'regression': 694, 'mainBundle': delivery['mainBundle']}))
