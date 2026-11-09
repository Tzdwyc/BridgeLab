import 'dart:convert';

import 'package:flutter/services.dart';

typedef NativeFileInvoker =
    Future<Object?> Function(String method, Map<String, Object?>? arguments);

/// Files are selected by Android's document picker; no broad storage permission.
class NativeFiles {
  NativeFiles({NativeFileInvoker? invoke})
    : _invoke = invoke ?? _platformInvoke;

  static const _channel = MethodChannel('cn.bridgelab.v03mobile/files');
  final NativeFileInvoker _invoke;

  static Future<Object?> _platformInvoke(
    String method,
    Map<String, Object?>? arguments,
  ) => _channel.invokeMethod<Object?>(method, arguments);

  Future<String> handle(String message) async {
    String? id;
    try {
      final payload = jsonDecode(message) as Map<String, dynamic>;
      id = payload['id'] as String;
      if (id.length > 64) throw const FormatException('Invalid request ID');
      final action = payload['action'];
      Object? value;
      if (action == 'saveFile') {
        final name = payload['name'] as String;
        final text = payload['text'] as String;
        if (name.length > 200 || utf8.encode(text).length > 16777216) {
          throw const FormatException('File is too large');
        }
        value = await _invoke('saveFile', {'name': name, 'text': text});
      } else if (action == 'openFile') {
        value = await _invoke('openFile', null);
      } else {
        throw const FormatException('Unsupported file action');
      }
      return jsonEncode({'id': id, 'value': value});
    } catch (error) {
      return jsonEncode({'id': id, 'error': error.toString()});
    }
  }
}

const installNativeFilesScript = r'''
(() => {
  if (window.BridgeLabNativeFiles) return;
  let serial = 0;
  const pending = new Map();
  const request = (action, fields = {}) => new Promise((resolve, reject) => {
    const id = String(++serial);
    pending.set(id, {resolve, reject});
    BridgeLabFiles.postMessage(JSON.stringify({id, action, ...fields}));
  });
  window.__bridgeNativeFilesComplete = response => {
    const task = pending.get(response.id);
    if (!task) return;
    pending.delete(response.id);
    if (response.error) task.reject(new Error(response.error));
    else task.resolve(response.value);
  };
  window.BridgeLabNativeFiles = {
    saveFile: (name, text) => request('saveFile', {name, text}),
    openFile: () => request('openFile'),
  };
})()
''';
