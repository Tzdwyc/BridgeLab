import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Serves the bundled BridgeLab build from a stable loopback-only origin.
class LocalAssetServer {
  static const int port = 51893;
  static const String origin = 'http://127.0.0.1:$port';
  HttpServer? _server;

  Future<Uri> start() async {
    _server ??= await HttpServer.bind(
      InternetAddress.loopbackIPv4,
      port,
      shared: false,
    );
    unawaited(_server!.forEach(_serve));
    return Uri.parse('$origin/index.html');
  }

  Future<void> close() async {
    await _server?.close(force: true);
    _server = null;
  }

  Future<void> _serve(HttpRequest request) async {
    final response = request.response;
    response.headers
      ..set(HttpHeaders.cacheControlHeader, 'no-cache')
      ..set('X-Content-Type-Options', 'nosniff')
      ..set(
        'Content-Security-Policy',
        "default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
      );

    if (request.method != 'GET' && request.method != 'HEAD') {
      response.statusCode = HttpStatus.methodNotAllowed;
      await response.close();
      return;
    }

    var path = request.uri.path;
    if (path == '/' || path.isEmpty) path = '/index.html';
    final normalized = Uri.decodeComponent(path.substring(1));
    if (normalized.contains('..') || normalized.contains('\\')) {
      response.statusCode = HttpStatus.badRequest;
      await response.close();
      return;
    }

    try {
      final data = await rootBundle.load('assets/www/$normalized');
      response.headers.contentType = contentTypeForPath(normalized);
      response.contentLength = data.lengthInBytes;
      if (request.method == 'GET') {
        response.add(
          data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
        );
      }
    } on FlutterError {
      response.statusCode = HttpStatus.notFound;
      response.headers.contentType = ContentType.html;
      response.add(
        utf8.encode(
          '<!doctype html><meta charset="utf-8"><title>未找到资源</title><h1>BridgeLab 资源不完整</h1>',
        ),
      );
    } finally {
      await response.close();
    }
  }

  static ContentType contentTypeForPath(String path) {
    final extension = path.split('.').last.toLowerCase();
    return switch (extension) {
      'html' => ContentType.html,
      'js' ||
      'mjs' => ContentType('application', 'javascript', charset: 'utf-8'),
      'css' => ContentType('text', 'css', charset: 'utf-8'),
      'json' ||
      'webmanifest' => ContentType('application', 'json', charset: 'utf-8'),
      'svg' => ContentType('image', 'svg+xml'),
      'png' => ContentType('image', 'png'),
      'jpg' || 'jpeg' => ContentType('image', 'jpeg'),
      'webp' => ContentType('image', 'webp'),
      'wasm' => ContentType('application', 'wasm'),
      'woff2' => ContentType('font', 'woff2'),
      _ => ContentType.binary,
    };
  }
}
