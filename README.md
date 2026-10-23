# BridgeLab

当前应用版本为v1.0。桌面和Android均使用获批的旧seed 101第8轮SL叫牌模型，设置中可切回随包保留的原SL。此次接入没有修改叫牌规则，也没有追加训练。

- 桌面应用：[v1.0-desktop说明](versions/v1.0-desktop/README.md)，也可下载[桌面发布包](https://github.com/Tzdwyc/BridgeLab/releases/download/v1.0/BridgeLab-v1.0-desktop.zip)。双击包内的“启动BridgeLab-v1.0.cmd”，默认打开http://localhost:5200。
- Android安装包：[BridgeLab-v1.0-mobile-android.apk](https://github.com/Tzdwyc/BridgeLab/releases/download/v1.0/BridgeLab-v1.0-mobile-android.apk)。版本1.0.0（45），沿用旧APP包名和签名。
- 原v0.3.7桌面与Android版本保留在对应旧目录；原有v1.0、v1.0-precision和v1.0-b2研究目录也独立保留。

桌面浏览器已验证实际权重加载与叫牌路径；Android已核对安装包内代码、模型、签名与资源一致性，当前未连接真机进行安装启动验证。模型来源和第三方许可证见桌面应用说明。

新桌面入口采用独立端口，旧桌面历史记录可通过已有导出、导入功能转移。Android沿用原本地存档格式。项目源码许可见[LICENSE](LICENSE)。
