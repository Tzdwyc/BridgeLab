# BridgeLab v3.3.0 Android validation

- Built: 2026-11-09T14:38:00.7650175+08:00
- APK: release/BridgeLab-v3.3.0-mobile-android.apk
- SHA256: 803debe10e44a679f9fdf468b5c1e3d2369efcd6e5801b6c82f2167034941dc1
- Fresh Dart formatting, Flutter analysis, Flutter tests and native-script checks passed; Android release build and signature verification passed.
- All 29 frozen desktop dist assets are present in the APK. Except index.html with a mobile CSS link, their hashes match.
- Main bundle hash: 71590f79cfd2fa1506fca429b00871d73d8c6dbe817f918c4e1b063fd5391c04
- Uses the final v3.3.0 desktop build, without modifying any desktop version.
- Android installation, WebView interactions and system document picker were not exercised on a device in this task.
- Internal sideload release uses the existing debug signing certificate, with the existing application ID for sideload upgrades.