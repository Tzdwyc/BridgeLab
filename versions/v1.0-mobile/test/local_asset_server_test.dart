import 'package:bridgelab_v03_mobile/local_asset_server.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'serves JavaScript modules and WASM with WebView-compatible MIME types',
    () {
      expect(
        LocalAssetServer.contentTypeForPath('assets/app.mjs').mimeType,
        'application/javascript',
      );
      expect(
        LocalAssetServer.contentTypeForPath('assets/worker.js').mimeType,
        'application/javascript',
      );
      expect(
        LocalAssetServer.contentTypeForPath('assets/dds.wasm').mimeType,
        'application/wasm',
      );
      expect(
        LocalAssetServer.contentTypeForPath('index.html').mimeType,
        'text/html',
      );
    },
  );
}
