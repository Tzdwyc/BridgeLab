# 第三方软件与许可证

BridgeLab v0.3.3 的运行时代码使用以下第三方组件：

| 组件 | 版本 | 用途 | 许可证 | 随包许可文件 |
| --- | --- | --- | --- | --- |
| bridge-dds | 1.4.0 | 浏览器内 DDS WASM 封装 | Apache-2.0 | `vendor/bridge-dds-LICENSE` |
| DDS | 2.9.0 | 独立原生参考源码，仅用于验收 | Apache-2.0 | `vendor/dds-reference/LICENSE` |
| React / React DOM | 19.x | 用户界面 | MIT | `vendor/licenses/react-LICENSE`、`vendor/licenses/react-dom-LICENSE` |
| Zustand | 5.x | 本地状态管理 | MIT | `vendor/licenses/zustand-LICENSE` |
| Workbox | 7.x | PWA 离线缓存 | MIT | `vendor/licenses/workbox-window-LICENSE` |

生产包中的 DDS 来自固定依赖 `bridge-dds@1.4.0`。`scripts/prepare-dds.mjs` 只在 JavaScript 加载器上暴露 WASM 内存字节数，用于页面诊断；嵌入的 WASM 字节保持不变。原始加载器和准备后文件的 SHA-256 记录在 `artifacts/dds-loader-provenance.json`。

官方 DDS 参考源码固定在 v2.9.0、提交 `8d75755c8df81999557758c9757514edb94017bc`。它不会被网页加载；`scripts/build-dds-reference.ps1` 只用于将其编译成测试参考程序。

完整依赖版本和间接开发依赖记录在 `package-lock.json`。发布压缩包不包含 `node_modules`、嵌套 Git 元数据或官方参考库中约 52 MB 的示例牌库；参考源码、接口、文档、测试、许可证和本次编译的参考程序均保留。
