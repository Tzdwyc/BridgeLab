# v0.3.5 清理记录

已完成删除前的原始牌例保留与核验。尚未完成物理删除：自动审批策略先后拒绝了批量校验目录后删除，以及固定绝对路径的原生删除；工具返回 blocked by policy，未实际执行删除。

## 保留原 2000 副

- 原文件：versions/v0.3.2/artifacts/bidding-review-foundation-6-traces.jsonl.gz。
- 原文件 SHA-256：dd0e08988a9c5dc4c974b5ebb4b15f723704a09eaf3adeea12eb7ba91d113d19。
- 原文件实测共 10000 副；保留编号 540–1206、4033–4699、7146–7811，共 2000 副。
- 新入口：resources/original-2000/original-2000-foundation6.jsonl；共 17650 个原始叫牌步骤，9944296 字节。
- 保留文件 SHA-256：5037bb01c615a31fc6105a247452b0076c7dfbe69a32bc3de1cebcfb32a75cbe。
- 已逐行校验保留文件与原始 JSONL 完全相等，完整保留全部手牌、公开前缀、步骤与原始说明。
- 与 v0.3.4 的 v034-release15-auctions.json 逐副核验 seed、dealer、vulnerability 与四家手牌完全相同。
- 待删 v0.3.2 旧 GPT 审阅的 1920 副与本次保留 2000 副没有交集。2000 副历代 GPT 审阅完整保留在 v0.3.3 与 v0.3.4 原目录。
- 详情见 resources/original-2000/manifest.json；旧路径为历史来源，新入口不要求修改冻结版本元数据。

## 范围与边界

授权清理的目录为 versions 下的 v0.1、v0.2、v0.3、v0.3-mobile、v0.3.1、v0.3.2、v0.3.2-mobile。删除前字节和文件数写入同目录 v035-cleanup.json；130 个保留源码及 v0.3.4 最终证据的核验摘要见 v035-cleanup-protected.json。

当前 8000 副未保留记录仍位于原始 10000 副文件中，因为物理删除被审批阻断。未删除发布 ZIP，未修改 v0.3.3、v0.3.4 源码、测试、冻结观察、审阅证据及交付清单。根目录资源和许可保留。
