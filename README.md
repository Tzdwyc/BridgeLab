# BridgeLab

BridgeLab is a local-first bridge practice app. Play South with North as your partner against two robots, study a bidding system, build custom deals, and review play with a double-dummy analyzer.

This public repository currently contains the v0.3.3 desktop/web application and its Android wrapper. App data stays in each user's browser; publishing this source repository does not upload players' local deals or analysis files.

## Quick start

Requirements: Node.js 22.12 or newer.

```powershell
cd versions/v0.3.3
npm install
npm run build
npm start
```

Open `http://localhost:5193`. On Windows, after building, you can instead double-click `启动BridgeLab-v0.3.3.cmd`. Keep the terminal or launcher window open while playing. The first visit caches offline assets for later use.

## Learn bridge and use BridgeLab

- [桥牌入门与软件使用指南](docs/桥牌入门与软件使用指南.md)
- [v0.3.3 软件说明](versions/v0.3.3/README.md)
- [叫牌体系说明](versions/v0.3.3/docs/BIDDING_SYSTEMS.md)
- [架构与测试报告](versions/v0.3.3/docs/ARCHITECTURE.md) · [测试报告](versions/v0.3.3/docs/TEST_REPORT.md)

## Android

The Android wrapper and packaged APK are under `versions/v0.3.3-mobile`. See its [README](versions/v0.3.3-mobile/README.md) for build and installation details.

## License

Original BridgeLab project files are licensed under the MIT License; see [LICENSE](LICENSE). Bundled third-party components remain under their respective licenses and notices; see [third-party license details](versions/v0.3.3/docs/THIRD_PARTY_LICENSES.md) and the license files under `versions/v0.3.3/vendor`.
