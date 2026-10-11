import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'local_asset_server.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(DeviceOrientation.values);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Color(0xff123c32),
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xfff3f2ec),
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const BridgeLabMobileApp());
}

class BridgeLabMobileApp extends StatelessWidget {
  const BridgeLabMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BridgeLab v0.3.3',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff174e3d)),
        scaffoldBackgroundColor: const Color(0xfff3f2ec),
      ),
      home: const BridgeLabScreen(),
    );
  }
}

class BridgeLabScreen extends StatefulWidget {
  const BridgeLabScreen({super.key});

  @override
  State<BridgeLabScreen> createState() => _BridgeLabScreenState();
}

class _BridgeLabScreenState extends State<BridgeLabScreen>
    with WidgetsBindingObserver {
  final LocalAssetServer _server = LocalAssetServer();
  WebViewController? _controller;
  Object? _startupError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _start();
  }

  Future<void> _start() async {
    try {
      final startUri = await _server.start();
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(const Color(0xfff3f2ec))
        ..setNavigationDelegate(
          NavigationDelegate(
            onNavigationRequest: (request) {
              final uri = Uri.tryParse(request.url);
              if (uri != null &&
                  uri.host == '127.0.0.1' &&
                  uri.port == LocalAssetServer.port) {
                return NavigationDecision.navigate;
              }
              return NavigationDecision.prevent;
            },
          ),
        )
        ..loadRequest(startUri);
      if (!mounted) return;
      setState(() => _controller = controller);
    } catch (error) {
      if (!mounted) return;
      setState(() => _startupError = error);
    }
  }

  @override
  Future<bool> didPopRoute() async {
    final controller = _controller;
    if (controller != null && await controller.canGoBack()) {
      await controller.goBack();
      return true;
    }
    return false;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _server.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      body: SafeArea(
        child: _startupError != null
            ? _StartupError(
                error: _startupError!,
                retry: () {
                  setState(() => _startupError = null);
                  _start();
                },
              )
            : controller == null
            ? const Center(child: CircularProgressIndicator())
            : WebViewWidget(controller: controller),
      ),
    );
  }
}

class _StartupError extends StatelessWidget {
  const _StartupError({required this.error, required this.retry});

  final Object error;
  final VoidCallback retry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'BridgeLab 启动失败',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 12),
            const Text(
              '应用内资源未能启动。牌局数据仍保存在本机，可重试打开。',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            Text(
              '$error',
              style: const TextStyle(fontSize: 11),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            FilledButton(onPressed: retry, child: const Text('重新启动')),
          ],
        ),
      ),
    );
  }
}
