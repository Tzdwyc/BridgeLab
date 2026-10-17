import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'local_asset_server.dart';
import 'diagnostics.dart';
import 'native_files.dart';

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
      title: 'BridgeLab v0.3.7',
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
  final DiagnosticMessages _diagnostics = DiagnosticMessages();
  final NativeFiles _nativeFiles = NativeFiles();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _start();
  }

  Future<void> _start() async {
    try {
      final build =
          jsonDecode(
                await rootBundle.loadString('assets/www/mobile-build.json'),
              )
              as Map<String, dynamic>;
      final expectedBundle = build['desktopMainBundle'] as String;
      if (build['desktopVersion'] != '0.3.7' ||
          !RegExp(r'^index-[\w-]+\.js$').hasMatch(expectedBundle)) {
        throw StateError('The installed v0.3.7 resource manifest is invalid.');
      }
      final startUri = await _server.start();
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(const Color(0xfff3f2ec))
        ..addJavaScriptChannel(
          'BridgeLabFiles',
          onMessageReceived: (message) async {
            final response = await _nativeFiles.handle(message.message);
            await _controller?.runJavaScript(
              'window.__bridgeNativeFilesComplete?.($response)',
            );
          },
        )
        ..setOnConsoleMessage((message) {
          _diagnostics.add(message.level.name, message.message);
        })
        ..setNavigationDelegate(
          NavigationDelegate(
            onPageStarted: (url) => _diagnostics.add('navigation', url),
            onPageFinished: (url) async {
              _diagnostics.add('page-finished', url);
              try {
                await _controller?.runJavaScript(installErrorCaptureScript);
                await _controller?.runJavaScript(installNativeFilesScript);
                await _controller?.runJavaScript(
                  packagedBundleRecoveryScript(expectedBundle),
                );
              } catch (error) {
                _diagnostics.add('capture-install', error.toString());
              }
            },
            onWebResourceError: (error) => _diagnostics.add(
              'web-resource',
              '${error.errorCode}: ${error.description}',
            ),
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
        );
      if (!mounted) return;
      setState(() => _controller = controller);
      await controller.loadRequest(startUri);
    } catch (error) {
      _diagnostics.add('startup', error.toString());
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
