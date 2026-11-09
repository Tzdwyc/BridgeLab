"""Summarize the one sealed run; never plays, trains, or changes acceptance."""
import argparse
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('run_directory')
run = Path(parser.parse_args().run_directory).resolve()
assert run.is_relative_to((root / 'artifacts/v331-play/benchmark').resolve())
read = lambda path: json.loads(path.read_text(encoding='utf-8'))
summary = read(run / 'summary.json')
gate = read(run / 'acceptance-gate-result.json')
integrity = read(run / 'post-run-integrity.json')
assert gate['formal'] and summary['completedTables'] == summary['totalTables'] == 288
assert all(integrity[key] for key in ['candidateSourceUnchanged', 'oldSourceUnchanged',
    'boardFileUnchanged', 'harnessAndGateUnchanged', 'allTablesComplete52NoClaims'])
boards = {b['id']: b for b in read(root / 'artifacts/v331-play/benchmark/frozen-boards.json')['boards']}
names = {'declarer': '仅升级庄家方', 'defense': '仅升级防守方'}
verdict = '通过' if gate['passed'] else '未通过'
lines = ['# v3.3.1 最小出牌候选：独立验收结果', '',
    f'预注册发布门槛：{verdict}。本轮只验收运行改进和旧采样为零时的等权物理采样救援。叫牌、约定、第8轮权重、原SL备份和界面布局保持原样，没有训练。', '',
    '新的96副冻结牌按NT／高花将／低花将各32副组成均衡压力集；使用标准强度、8样本预算及1200毫秒分析／1350毫秒硬截止。三桌角色对照共288桌，每桌打完52张、无声称。它不代表自然使用分布，也不是其他强度、手机等待时间或人类专家水平评级。', '',
    '| 对照 | 副数 | 平均IMP差 | 配对95%区间 | 平均墩差 | 成约／击宕率变化 | ≥10 IMP救回／新增 |',
    '|---|---:|---:|---|---:|---:|---:|']
for role, name in names.items():
    r = summary['paired'][role]
    lo, hi = r['ci95Imp']
    lines.append(f'| {name} | {r["n"]} | {r["meanImp"]:+.3f} | [{lo:+.3f}, {hi:+.3f}] | '
        f'{r["meanTricks"]:+.3f} | {r["roleSuccessRateDelta"]*100:+.2f}个百分点 | '
        f'{len(r["rescues10Imp"])}/{len(r["newLosses10Imp"])} |')
lines += ['', '正数均从被升级一方的角度表示改善。置信区间按整副牌重采样，未将出牌步数当成独立牌例。', '',
    '## 运行表现', '', '| 指标 | 旧版 | 最小候选 |', '|---|---:|---:|']
for key, label in [('count', '决策数'), ('trueSafetyFallbacks', '真正安全回退次数'),
    ('p50Ms', '单步中位耗时／毫秒'), ('p95Ms', '单步p95／毫秒'), ('maxMs', '单步最大耗时／毫秒')]:
    values = [summary['metricsByVersion'][tag][key] for tag in ['old', 'candidate']]
    values = [f'{v:.2f}' if isinstance(v, float) else str(v) for v in values]
    lines.append(f'| {label} | {values[0]} | {values[1]} |')
rows = {p.stem: read(p) for p in run.glob('heldout-*.json') if p.stem.rsplit('-', 1)[-1] in ['old', 'declarer', 'defense']}
steps = [s for row in rows.values() for s in row['steps'] if s['version'] == 'candidate']
recoveries = [s for s in steps if s.get('emptyRecovery', {}).get('triggered')]
recovery_report = {'candidateDecisions': len(steps), 'triggered': len(recoveries),
    'validDDS': sum(s.get('sampleCount', 0) > 0 and bool(s.get('candidates')) for s in recoveries),
    'zeroCompleted': sum(s.get('sampleCount', 0) == 0 for s in recoveries)}
lines += ['', f'零样本救援触发{len(recoveries)}次，其中获得有效DDS候选{recovery_report["validDDS"]}次。'
    '样本不足但仍使用DDS与真正回到安全打法分别统计。上述计时来自本地CPU，不能作为手机等待时间。', '',
    '## 全部≥10 IMP差异', '', '首个出牌分歧只是复盘入口，不等于整副结果的唯一原因。以下保留全部正反例。', '']
details = []
replay_dir = run / 'analysis-replays'
replay_dir.mkdir(exist_ok=True)
for role, name in names.items():
    for group, label in [('rescues10Imp', '救回'), ('newLosses10Imp', '新增失分')]:
        for pair in summary['paired'][role][group]:
            board = boards[pair['id']]
            old, new = [rows[f'{pair["id"]}-{tag}'] for tag in ['old', role]]
            plays = [[a for a in row['actions'] if a['kind'] == 'play'] for row in [old, new]]
            first = next((i for i in range(52) if plays[0][i] != plays[1][i]), None)
            contract = board['contract']
            strain = {'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣', 'NT': 'NT'}[contract['strain']]
            lines += [f'### {pair["id"]}：{name}，{label}，{pair["imp"]:+d} IMP', '',
                f'{contract["level"]}{strain}{["", " X", " XX"][contract["doubled"]]}，{contract["declarer"]}庄，'
                f'局况{board["vulnerability"]}。旧版{old["declarerTricks"]}墩／庄家分{old["declarerScore"]:+d}；'
                f'候选{new["declarerTricks"]}墩／庄家分{new["declarerScore"]:+d}。', '']
            if first is not None:
                lines += [f'首个分歧：第{first//4+1}墩第{first%4+1}张，{plays[0][first]["seat"]}出牌，'
                    f'{plays[0][first]["cardId"]} → {plays[1][first]["cardId"]}。', '']
            files = []
            for tag, row in [('old', old), (role, new)]:
                doc = {'version': 2, 'name': f'{pair["id"]} {role} {tag}', 'cursor': first or 0,
                    'activeBranch': None, 'branches': [], 'analysisContract': None,
                    'source': {'board': board['board'], 'seed': board['seed'], 'actions': row['actions'],
                        'biddingSystem': 'two-over-one', 'agreementVersion': 'two-over-one-v2.1',
                        'customSetup': {'dealer': board['dealer'], 'vulnerability': board['vulnerability'], 'hands': board['hands']}}}
                path = replay_dir / f'{pair["id"]}-{role}-{tag}.analysis.json'
                path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding='utf-8')
                files.append(path.name)
            details.append({**pair, 'role': role, 'category': group, 'contract': contract,
                'firstDivergencePly': first, 'oldAction': plays[0][first] if first is not None else None,
                'newAction': plays[1][first] if first is not None else None, 'analysisFiles': files})
            lines += [f'分析室导入文件：`{files[0]}` 与 `{files[1]}`。', '']
if not details:
    lines += ['两角色均没有达到10 IMP的差异牌例。', '']
lines += ['## 验收与后续状态', '']
labels = {'completeScope': '完整96副／288桌', 'legalCompleteNoClaims': '合法52张、无声称',
    'eachRoleMeanNonnegative': '两角色均值均不退步', 'positiveConfidenceAtLeastOneRole': '至少一角色95%区间下界为正',
    'totalRescuesExceedNewLosses': '大亏救回合计多于新增', 'eachRoleLossCountNotAboveRescue': '各角色新增大亏不多于救回',
    'candidateP95WithinHardLimit': '候选p95在1350毫秒内'}
lines += [f'- {labels.get(k,k)}：{"通过" if v else "未通过"}。' for k,v in gate['checks'].items()]
lines += ['', '源码、旧基线、冻结输入、工具与门槛的运行后完整性检查全部通过。'
    '仅向求解器传递公开观察及据此生成的假设布局，完整实牌仅用于执行合法牌局与计分。', '',
    ('通过本轮离线门槛，后续接入与桌面／APP验证另行记录；本报告本身不代表已经发布。' if gate['passed'] else
    '未通过发布门槛，停止本候选；不按本轮结果调参、重跑、追加牌或训练。正式桌面和APP保持v3.2.1，未接入联机。'), '',
    '组件归因另见V331_COMPONENT_FINDINGS.md；首次分歧诊断与18点局部实验不作为新的整局牌力证据。', '']
target = root / 'docs/V331_OFFLINE_RESULT.md'
target.write_text('\n'.join(lines), encoding='utf-8')
for name, data in [('large-loss-cases.json', details), ('empty-recovery-coverage.json', recovery_report)]:
    (run / name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'report': str(target), 'gatePassed': gate['passed'], 'largeCases': len(details),
    'reportSha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'recoveries': recovery_report}, ensure_ascii=False))
