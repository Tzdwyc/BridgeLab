# BridgeLab v0.3.3 Mobile 第三方软件说明

手机端仅增加 Flutter 壳和 Android WebView 接入。网页业务资源来自桌面 ``versions/v0.3.3/dist``；其 JavaScript、DDS 与 PWA 依赖清单保留在同步快照 ``upstream-src/docs/THIRD_PARTY_LICENSES.md``，DDS 原始许可证保留在 ``upstream-src/vendor/bridge-dds-LICENSE``。

| 组件 | 用途 | 许可证 |
|---|---|---|
| Flutter SDK、Flutter Engine | Android 应用壳、生命周期、安全区与资源打包 | BSD 3-Clause；SDK 自带 ``LICENSE`` 与 ``flutter_tools`` 法律文件 |
| ``webview_flutter`` | 在 Android System WebView 中显示本地 BridgeLab 页面 | BSD 3-Clause |
| ``webview_flutter_android`` | ``webview_flutter`` 的 Android 实现 | BSD 3-Clause |
| AndroidX WebKit 及 AndroidX 基础组件 | Android WebView 兼容层与 Flutter 插件传递依赖 | Apache License 2.0 |
| Android Gradle Plugin、Gradle、Kotlin Android 工具链 | APK 构建 | 各项目自带许可证；仅参与构建，不作为独立产品功能分发 |

依赖的确切版本由 ``pubspec.lock`` 和 Android Gradle 锁定配置记录。构建产物还会包含 Flutter 引擎的 ``NOTICES.Z`` 法律通知文件，可在 APK 中核验。
