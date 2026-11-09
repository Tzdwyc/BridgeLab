import 'dart:convert';
import 'dart:io';

import 'package:bridgelab_v03_mobile/lan_relay.dart';
import 'package:bridgelab_v03_mobile/local_asset_server.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final testOverrides = HttpOverrides.current;
  setUpAll(() => HttpOverrides.global = null);
  tearDownAll(() => HttpOverrides.global = testOverrides);

  const platform = MethodChannel('cn.bridgelab.v03mobile/lan');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final privateAddress = Platform.environment['BRIDGELAB_TEST_LAN_ADDRESS'];
  late LocalAssetServer server;
  late HttpClient client;
  final wake = <bool>[];

  setUp(() async {
    wake.clear();
    messenger.setMockMethodCallHandler(platform, (call) async {
      if (call.method == 'wifiAddress') return privateAddress;
      if (call.method == 'keepAwake') wake.add(call.arguments as bool);
      return null;
    });
    server = LocalAssetServer();
    await server.start();
    client = HttpClient()..findProxy = (_) => 'DIRECT';
  });

  tearDown(() async {
    client.close(force: true);
    await server.close();
    messenger.setMockMethodCallHandler(platform, null);
  });

  Future<(int, Map<String, dynamic>)> post(
    String operation,
    Map<String, dynamic> body, {
    String base = LocalAssetServer.origin,
    String? origin,
    String? host,
    ContentType? contentType,
  }) async {
    final request = await client.postUrl(Uri.parse('$base/api/lan/$operation'));
    request.headers.contentType = contentType ?? ContentType.json;
    if (origin != null) request.headers.set('Origin', origin);
    if (host != null) request.headers.set('Host', host);
    request.write(jsonEncode(body));
    final response = await request.close();
    final data = jsonDecode(await utf8.decoder.bind(response).join());
    return (response.statusCode, data as Map<String, dynamic>);
  }

  test('loopback guards reject cross-origin and non-private targets', () async {
    expect((await post('capabilities', {})).$2, {'canHost': true});
    expect(
      (await post('stop', {}, origin: 'https://example.test')).$1,
      HttpStatus.forbidden,
    );
    expect(
      (await post('stop', {}, host: 'example.test')).$1,
      HttpStatus.forbidden,
    );
    expect(
      (await post('stop', {}, contentType: ContentType.text)).$1,
      HttpStatus.unsupportedMediaType,
    );
    for (final target in [
      '127.0.0.1',
      '8.8.8.8',
      '192.168.0.01',
      'localhost',
    ]) {
      expect(
        (await post('connect', {'address': target, 'port': 51894})).$1,
        HttpStatus.badRequest,
      );
    }
    expect((await post('poll', {})).$1, HttpStatus.gone);
  });

  test(
    'forwards only game messages and returns the host reply via loopback',
    () async {
      final (started, info) = await post('start', {});
      expect(started, HttpStatus.ok);
      expect(info, {'address': privateAddress, 'port': 51894});
      expect(wake, [true]);
      final base = 'http://$privateAddress:51894';
      expect((await post('poll', {}, base: base)).$1, HttpStatus.notFound);
      expect(
        (await post(
          'message',
          {},
          base: base,
          origin: 'https://example.test',
        )).$1,
        HttpStatus.forbidden,
      );
      final payload = {'type': 'join', 'room': 'test'};
      final connecting = post('connect', {...info, 'payload': payload});
      Map<String, dynamic> envelope = {};
      final deadline = DateTime.now().add(const Duration(seconds: 3));
      while (envelope.isEmpty && DateTime.now().isBefore(deadline)) {
        envelope = (await post('poll', {})).$2;
        if (envelope.isEmpty) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
        }
      }
      expect(envelope['payload'], payload);
      expect((await post('poll', {})).$2, isEmpty);
      final reply = {'ok': true, 'revision': 1};
      expect(
        (await post('reply', {'id': envelope['id'], 'payload': reply})).$1,
        HttpStatus.ok,
      );
      expect((await connecting).$2, reply);
      expect((await post('stop', {})).$1, HttpStatus.ok);
      expect((await post('poll', {})).$1, HttpStatus.gone);
      expect(wake, [true, false]);
    },
    skip: privateAddress == null
        ? 'Set BRIDGELAB_TEST_LAN_ADDRESS to a private local IPv4 address.'
        : !LanRelay.isPrivateAddress(privateAddress),
  );
}
