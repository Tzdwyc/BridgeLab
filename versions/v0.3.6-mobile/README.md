# BridgeLab v0.3.6 Android

Offline Android wrapper prepared from v0.3.5 code 39. Version 0.3.6 (40), application ID cn.bridgelab.v03mobile, existing debug signing identity and loopback origin http://127.0.0.1:51893 are retained.

The lower-right diagnostics button remains removed. Silent bundle recovery and background error capture remain active. Read-only storage probes support bridgelab.session.v3.6 and preserve access to bridgelab.session.v3.5. Desktop migration is part of the frozen v0.3.6 runtime.

History JSON import/export uses Android's system document picker through the native file bridge, rather than requiring browser Blob downloads. The user chooses each file/location; no broad storage permission is requested. Picker cancellation is preserved. Files are limited to 16 MiB.

Install `release/BridgeLab-v0.3.6-mobile-android.apk` (44,451,128 bytes). SHA-256: `5931475af9e7e6bda161d14d430bdcdb3696d3d3d1c65c84b9ca034141874730`.

Current evidence: `docs/VALIDATION.json`, `docs/UPGRADE_SIGNATURE_VALIDATION.json`, `docs/NATIVE_VALIDATION_REUSE.json`, `docs/WEB_LAYOUT_VALIDATION.json`, and `docs/UPGRADE_RECOVERY_VALIDATION.json`. Candidate1 formatting, analysis, 7 Flutter tests and 8 native-script checks were reused after all 26 recorded native/build input hashes matched; three native app libraries and DEX also match candidate1 byte-for-byte. Final Gradle release/signature checks, packaged-asset hashes, mobile browser layouts with both teams' IMP scores and net, native file JavaScript roundtrip and real stale-Workbox recovery passed. All 13 desktop dist files are included; unchanged files match by SHA-256, while the mobile index adds a CSS link. The 3 wrapper-specific assets are also checked against APK bytes. Existing code-39 APK/app identity/signing certificate match for an upgrade.

Browser tests execute the exact native JavaScript with simulated picker responses; actual Android installation, WebView and the system document picker were not tested on a device. `docs/POSTBUILD_SOURCE_NOTES.json` records the final frozen source and native binary identity. Three superseded internal candidates and their original APK/proofs remain preserved under `artifacts/candidate1`, `artifacts/candidate2` and `artifacts/candidate3`. Earlier-version evidence is not copied as current proof.
