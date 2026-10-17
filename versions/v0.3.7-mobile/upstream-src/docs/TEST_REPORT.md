# BridgeLab v0.3.7 双柱比分修订

日期：2026年10月17日。仍为v0.3.7，Android内部版本由43升至44。code43电脑包与证据存于artifacts/previous-score-revision43，安卓工程另存previous-code43，不修改v0.3.6。

## 用户批准的界面

采用“双柱对比”，删除左侧0、墩、13刻度。两根竖柱以同一13墩比例显示南北和东西实际墩数，数值直接标注；庄家方有成约目标线，目标为定约阶数加6。

目标判断只使用已分配的公开墩数与剩余墩数。可显示还需若干墩、已确保成约或已确定宕约，不调用DDS作预判。声称终局显示最终裁定分配及声称已结算，不能把未打出的墩伪装成实际完成记录。四家Pass没有定约目标。

原位明手、东西分花色真实牌面、隐藏手牌边界、叫牌框内部滚动、悬停／长按说明及技术诊断隐藏保持有效。新比分在不同尺寸按可用空间紧凑摆放，整页与牌桌不滚动。

## 本轮证据

- artifacts/score-columns/validation.json：新双柱场景、数学状态、目标位置、无左刻度和五视口布局。含真实退出码、运行源哈希和截图。
- artifacts/score-columns/regressions/validation.json：冻结源上重跑既有40项东西分套、20项固定桌／叫牌设置与明手、4项诊断隐藏、5项叫牌框滚动。各组原始Playwright报告、退出码及运行前后源码哈希一并保存。
- artifacts/score-columns/production/：最终正式构建实打52张、13墩，南家和北明手各13次真实界面点击，不能使用声称捷径代替。
- artifacts/v037-typecheck.json与v037-production-build.json：完整项目类型检查及正式构建的实际退出码。

实际通过数量和结果以报告为准；任何失败或源哈希不一致会阻止最终打包。前版工作台／首页／历史页等未改模块作为既有基线保留，不宣称本轮全量重跑。旧截图保留所属版本，不用修改旧哈希冒充本轮结果。

## 安卓升级与边界

同级v0.3.7-mobile/release/BridgeLab-v0.3.7-mobile-android.apk使用versionName0.3.7、versionCode44，直接升级基线为已交付code43。包名cn.bridgelab.v03mobile、原签名、127.0.0.1:51893来源及v3.6存储格式保持不变。

原生逻辑未改，原生7项Flutter／8项脚本结果按输入哈希继承；pubspec的43→44元数据差异单列。新包构建、签名、全部dist资源及源快照核对实际执行；浏览器核对手机双柱、原位分套、历史框滚动、真实code43旧Service Worker升级恢复、存档保留及离线回放。

未连接安卓设备；覆盖安装、实际WebView触控及系统文件选择器未实机测试，浏览器和安装包检查不能替代。最终交付要求delivery-verification.json为passed，ZIP CRC及逐文件哈希通过，解压后独立启动检查通过。
