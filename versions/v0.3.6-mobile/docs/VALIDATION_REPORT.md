# BridgeLab v0.3.6 Android validation

- Built: 2026-10-16T15:10:29.1438514+08:00
- APK: release/BridgeLab-v0.3.6-mobile-android.apk
- SHA256: 5931475af9e7e6bda161d14d430bdcdb3696d3d3d1c65c84b9ca034141874730
- Candidate1 formatting, analysis, 7 Flutter tests and 8 native-script checks reused after all recorded native/build input hashes matched; Android release build and signature verification passed.
- All 13 frozen desktop dist assets are present in the APK. Except index.html with a mobile CSS link, their hashes match.
- Main bundle hash: 983c05f0654876ad50fa9881a85ed6824948cc74b0cbacbf8c891ffc6ba3200b
- Uses the final v0.3.6 desktop build, without modifying any desktop version.
- Android installation, WebView interactions and system document picker were not exercised on a device in this task.
- Internal sideload release uses the existing debug signing certificate, with the existing application ID for upgrading v0.3.
- All 26 native/build input hashes and all three native app libraries plus DEX match candidate1; unchanged native checks are reused explicitly.
- Fresh final-bundle mobile portrait/landscape checks passed, including both teams IMP scores and net, exact native file JavaScript export/import and no horizontal overflow.
- Real code-39 cached Workbox recovery passed direct-history migration (one legacy archive), Home Continue board20 and offline bidding with original save/backup and localStorage/IndexedDB sentinels retained.
- Android installation, native WebView and the system document picker were not exercised on a physical device.
