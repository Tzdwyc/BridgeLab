import 'dart:convert';

import 'package:bridgelab_v03_mobile/native_files.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'passes export text to native picker and preserves cancellation',
    () async {
      final files = NativeFiles(
        invoke: (method, arguments) async {
          expect(method, 'saveFile');
          expect(arguments, {'name': 'history.json', 'text': '{"中文":1}'});
          return false;
        },
      );
      final response = jsonDecode(
        await files.handle(
          jsonEncode({
            'id': '1',
            'action': 'saveFile',
            'name': 'history.json',
            'text': '{"中文":1}',
          }),
        ),
      );
      expect(response, {'id': '1', 'value': false});
    },
  );
  test(
    'returns selected import content and rejects unsupported actions',
    () async {
      final files = NativeFiles(
        invoke: (method, arguments) async {
          expect(method, 'openFile');
          expect(arguments, isNull);
          return {'name': 'history.json', 'text': '{"history":[]}'};
        },
      );
      final response = jsonDecode(
        await files.handle('{"id":"2","action":"openFile"}'),
      );
      expect(response['value']['text'], '{"history":[]}');
      final invalid = jsonDecode(
        await files.handle('{"id":"3","action":"delete"}'),
      );
      expect(invalid['error'], contains('Unsupported file action'));
    },
  );
}
