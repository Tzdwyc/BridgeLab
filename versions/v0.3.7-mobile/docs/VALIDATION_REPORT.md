# BridgeLab v0.3.7 Android validation

- Built: 2026-10-17T12:41:46.9459076+08:00
- APK: release/BridgeLab-v0.3.7-mobile-android.apk
- SHA256: 6811670efe387813d506d09ca226e804ad51fac0a8235dec8d6c7e3290ea0021
- Preparation Dart formatting, Flutter analysis, 7 Flutter tests and 8 native-script checks reused after native input SHA-256 equality; Android release build and signature verification passed.
- All 13 frozen desktop dist assets are present in the APK. Except index.html with a mobile CSS link, their hashes match.
- Main bundle hash: 216b206397b4315b74efc50574ae80bd37452681677bd5ea1f6f430e601f25a7
- Uses the final v0.3.7 desktop build, without modifying any desktop version.
- Android installation, WebView interactions and system document picker were not exercised on a device in this task.
- Internal sideload release uses the existing debug signing certificate, with the existing application ID for upgrading v0.3.