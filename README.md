# BridgeLab

BridgeLab 是一款本地运行的桥牌练习软件。玩家坐南家，与北家机器人搭档，对阵东西两位机器人；可以练习叫牌和打牌，建立自定义牌例，并使用双明手分析室复盘。

当前公开仓库包含 v0.3.3 桌面／网页源码和 Android 外壳源码。应用数据保存在每位使用者自己的浏览器中；公开源代码不会上传本地牌局或分析档案。

## 快速开始

需要 Node.js 22.12 或更新版本。在项目目录运行：

```powershell
cd versions/v0.3.3
npm install
npm run build
npm start
```

然后打开 `http://localhost:5193`。Windows 用户也可在构建完成后双击 `启动BridgeLab-v0.3.3.cmd`。游戏期间请保持启动窗口打开。首次加载并缓存资源后，网页可离线使用。

## 入门与使用

- [桥牌入门与 BridgeLab 使用指南](docs/桥牌入门与软件使用指南.md)
- [v0.3.3 软件说明](versions/v0.3.3/README.md)
- [叫牌体系说明](versions/v0.3.3/docs/BIDDING_SYSTEMS.md)
- [架构说明](versions/v0.3.3/docs/ARCHITECTURE.md) · [测试报告](versions/v0.3.3/docs/TEST_REPORT.md)

## Android

Android 工程位于 `versions/v0.3.3-mobile`。当前公开快照未附带可直接安装的 APK；请查阅该目录中的构建说明，并在自己的 Android 设备上验证构建结果。

## 许可证

BridgeLab 原创项目文件使用 MIT 许可证，见 [LICENSE](LICENSE)。随仓库分发的第三方组件仍遵循各自许可和版权声明，详见[第三方许可说明](versions/v0.3.3/docs/THIRD_PARTY_LICENSES.md)及 `versions/v0.3.3/vendor` 中的许可文件。

