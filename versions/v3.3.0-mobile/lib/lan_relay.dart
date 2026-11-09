import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart';

/// The LAN listener accepts only game messages. The bundled web app polls
/// the separate loopback listener to dispatch them to its game engine.
class LanRelay {
  static const _platform = MethodChannel('cn.bridgelab.v03mobile/lan');
  static const _messagePath = '/api/lan/message';
  static const _maxBytes = 256 * 1024;
  static const _deadline = Duration(seconds: 6);
  final _pending = <int, _PendingMessage>{};
  HttpServer? _server;
  Timer? _lease;
  bool _changing = false;
  int _nextId = 0;

  static bool isPrivateAddress(String address) {
    final ip = InternetAddress.tryParse(address);
    if (ip == null ||
        ip.type != InternetAddressType.IPv4 ||
        ip.address != address) {
      return false;
    }
    final bytes = ip.rawAddress;
    return bytes[0] == 10 ||
        (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
        (bytes[0] == 192 && bytes[1] == 168);
  }

  Future<void> serveLocal(HttpRequest request, String origin) async {
    final headers = request.headers;
    final requestOrigin = headers.value('origin');
    if (headers.value(HttpHeaders.hostHeader) != Uri.parse(origin).authority ||
        (requestOrigin != null && requestOrigin != origin) ||
        headers.value('sec-fetch-site') == 'cross-site') {
      await _respond(request, HttpStatus.forbidden, {'error': '请求来源无效'});
      return;
    }
    await _handle(request, (body) async {
      switch (request.uri.path) {
        case '/api/lan/capabilities':
          return {'canHost': true};
        case '/api/lan/start':
          return _start();
        case '/api/lan/stop':
          await stop();
          return {};
        case '/api/lan/connect':
          return _connect(body);
        case '/api/lan/poll':
          if (_server == null) {
            throw const _LanError(HttpStatus.gone, '房主已停止联机');
          }
          _renewLease();
          for (final entry in _pending.entries) {
            final message = entry.value;
            if (!message.delivered) {
              message.delivered = true;
              return {'id': entry.key, 'payload': message.payload};
            }
          }
          return {};
        case '/api/lan/reply':
          final message = _pending[body['id']];
          if (message == null ||
              !message.delivered ||
              message.reply.isCompleted) {
            throw const _LanError(HttpStatus.notFound, '联机消息已过期');
          }
          message.reply.complete(_object(body['payload']));
          return {};
        default:
          throw const _LanError(HttpStatus.notFound, '未知的联机操作');
      }
    });
  }

  Future<Map<String, dynamic>> _start() async {
    if (_changing) {
      throw const _LanError(HttpStatus.conflict, '房主服务正在切换状态');
    }
    _changing = true;
    try {
      if (_server == null) {
        final address = await _platform.invokeMethod<String>('wifiAddress');
        if (address == null || !isPrivateAddress(address)) {
          throw const _LanError(
            HttpStatus.serviceUnavailable,
            '请先连接分配了内网 IPv4 地址的 Wi-Fi',
          );
        }
        final server = await HttpServer.bind(InternetAddress(address), 51894);
        try {
          await _platform.invokeMethod<void>('keepAwake', true);
        } catch (_) {
          await server.close(force: true);
          rethrow;
        }
        server.idleTimeout = _deadline;
        _server = server;
        server.listen(_serveRemote);
      }
      _renewLease();
      return {'address': _server!.address.address, 'port': _server!.port};
    } finally {
      _changing = false;
    }
  }

  void _renewLease() {
    _lease?.cancel();
    _lease = Timer(const Duration(seconds: 12), () {
      unawaited(stop());
    });
  }

  Future<void> stop() async {
    if (_changing) {
      throw const _LanError(HttpStatus.conflict, '房主服务正在切换状态');
    }
    final server = _server;
    if (server == null) return;
    _changing = true;
    _lease?.cancel();
    _lease = null;
    _server = null;
    try {
      for (final message in _pending.values) {
        if (!message.reply.isCompleted) {
          message.reply.complete({'error': '房主已停止联机'});
        }
      }
      _pending.clear();
      await server.close(force: true);
    } finally {
      try {
        await _platform.invokeMethod<void>('keepAwake', false);
      } finally {
        _changing = false;
      }
    }
  }

  Future<void> _serveRemote(HttpRequest request) async {
    if (request.uri.path != _messagePath) {
      await _respond(request, HttpStatus.notFound, {'error': '未知的联机接口'});
      return;
    }
    if (request.headers.value('origin') != null ||
        !isPrivateAddress(
          request.connectionInfo?.remoteAddress.address ?? '',
        )) {
      await _respond(request, HttpStatus.forbidden, {'error': '联机请求来源无效'});
      return;
    }
    await _handle(request, (payload) async {
      if (_server == null || _pending.length >= 24) {
        throw const _LanError(HttpStatus.serviceUnavailable, '房主服务暂不可用');
      }
      final id = ++_nextId;
      final message = _PendingMessage(payload);
      _pending[id] = message;
      try {
        return await message.reply.future.timeout(_deadline);
      } finally {
        _pending.remove(id);
      }
    });
  }

  Future<Map<String, dynamic>> _connect(Map<String, dynamic> body) async {
    final address = body['address'];
    final port = body['port'];
    if (address is! String ||
        !isPrivateAddress(address) ||
        port is! int ||
        port < 1024 ||
        port > 65535) {
      throw const _LanError(HttpStatus.badRequest, '请输入有效的内网 IPv4 地址和端口');
    }
    final payload = _object(body['payload']);
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 2)
      ..autoUncompress = false
      ..findProxy = (_) => 'DIRECT';
    try {
      return await (() async {
        final uri = Uri(
          scheme: 'http',
          host: address,
          port: port,
          path: _messagePath,
        );
        final request = await client.postUrl(uri);
        request.followRedirects = false;
        request.headers.contentType = ContentType.json;
        request.add(utf8.encode(jsonEncode(payload)));
        final response = await request.close();
        if (response.statusCode != HttpStatus.ok ||
            response.headers.contentType?.mimeType != 'application/json') {
          throw const _LanError(HttpStatus.badGateway, '房主拒绝了联机请求');
        }
        return _readObject(response);
      })().timeout(_deadline + const Duration(seconds: 1));
    } on SocketException {
      throw const _LanError(HttpStatus.badGateway, '无法连接房主，请检查地址和 Wi-Fi');
    } on HttpException {
      throw const _LanError(HttpStatus.badGateway, '与房主的连接已断开');
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _handle(
    HttpRequest request,
    Future<Map<String, dynamic>> Function(Map<String, dynamic>) action,
  ) async {
    try {
      if (request.method != 'POST') {
        throw const _LanError(HttpStatus.methodNotAllowed, '联机接口只接受 POST 请求');
      }
      if (request.headers.contentType?.mimeType != 'application/json') {
        throw const _LanError(
          HttpStatus.unsupportedMediaType,
          '联机请求需要 JSON 内容类型',
        );
      }
      final body = await _readObject(request).timeout(_deadline);
      final result = await action(body);
      await _respond(request, HttpStatus.ok, result);
    } on _LanError catch (error) {
      await _respond(request, error.status, {'error': error.message});
    } on FormatException {
      await _respond(request, HttpStatus.badRequest, {
        'error': '联机消息的 JSON 格式无效',
      });
    } on TimeoutException {
      await _respond(request, HttpStatus.gatewayTimeout, {'error': '联机请求超时'});
    } on Exception {
      await _respond(request, HttpStatus.serviceUnavailable, {
        'error': '联机服务暂不可用',
      });
    }
  }

  static Future<Map<String, dynamic>> _readObject(
    Stream<List<int>> stream,
  ) async {
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in stream) {
      if (bytes.length + chunk.length > _maxBytes) {
        throw const _LanError(HttpStatus.requestEntityTooLarge, '联机消息过大');
      }
      bytes.add(chunk);
    }
    return _object(jsonDecode(utf8.decode(bytes.takeBytes())));
  }

  static Map<String, dynamic> _object(Object? value) {
    if (value is! Map<String, dynamic>) {
      throw const FormatException('Expected a JSON object');
    }
    return value;
  }

  static Future<void> _respond(
    HttpRequest request,
    int status,
    Map<String, dynamic> data,
  ) async {
    final response = request.response;
    response.statusCode = status;
    response.headers.contentType = ContentType.json;
    response.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.persistentConnection = false;
    response.add(utf8.encode(jsonEncode(data)));
    try {
      await response.close();
    } on IOException {
      // The peer may have disconnected while the web app was handling it.
    }
  }
}

class _PendingMessage {
  _PendingMessage(this.payload);
  final Map<String, dynamic> payload;
  final reply = Completer<Map<String, dynamic>>();
  bool delivered = false;
}

class _LanError implements Exception {
  const _LanError(this.status, this.message);
  final int status;
  final String message;
}
