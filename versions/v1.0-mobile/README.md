# BridgeLab v1.0 Android

安装包：[BridgeLab-v1.0-mobile-android.apk](https://github.com/Tzdwyc/BridgeLab/releases/download/v1.0/BridgeLab-v1.0-mobile-android.apk)。版本名1.0.0、版本号45。与桌面v1.0使用同一份网页应用、旧seed 101第8轮权重和原SL备份。

默认使用第8轮。进入“设置”的“叫牌模型”页可切回原SL，也可恢复第8轮；展开记录可查看实际加载的校验码与机器人最近叫品。

包名cn.bridgelab.v03mobile、签名证书、本地地址http://127.0.0.1:51893及bridgelab.session.v3.6存档格式均沿用旧APP。安装更新前可用原有导出功能自行保留牌局文件；此更新流程不清空用户数据。

构建入口为scripts/build-android.ps1，桌面来源为../v1.0-desktop。编译使用现有Flutter、Android SDK和签名环境，没有训练入口。

已完成安装包签名、版本、资源与权重一致性检查，以及Flutter分析、测试和原生脚本检查。当前未连接Android真机，未声称完成真机安装、启动或系统文件选择器验证。
