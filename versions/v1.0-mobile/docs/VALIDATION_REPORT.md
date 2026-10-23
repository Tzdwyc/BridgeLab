# BridgeLab v1.0 Android validation

- Built: 2026-10-23T14:42:39.6189540+08:00
- APK: release/BridgeLab-v1.0-mobile-android.apk
- SHA256: 602d3f68881084149a00e1da701f4848ef34b7fb3185b0d986d759abec926efd
- Preparation Dart formatting, Flutter analysis, 7 Flutter tests and 8 native-script checks reused after native input SHA-256 equality; Android release build and signature verification passed.
- All 21 frozen desktop dist assets are present in the APK. Except index.html with a mobile CSS link, their hashes match.
- Main bundle hash: d1542e7857f9a307e100da93183535f12ba6c5a758f8f868ea28e289d756a11f
- Uses the final v1.0 desktop build, without modifying any desktop version.
- Android installation, WebView interactions and system document picker were not exercised on a device in this task.
- Internal sideload release uses the existing debug signing certificate, with the existing application ID for upgrading v0.3.