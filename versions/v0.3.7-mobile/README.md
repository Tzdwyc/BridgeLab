# BridgeLab v0.3.7 Android

Independent offline Android wrapper for the v0.3.7 fixed-screen BBO interface. Version 0.3.7 (44), application ID `cn.bridgelab.v03mobile`, existing signing identity and loopback origin `http://127.0.0.1:51893` are retained.

This UI upgrade retains `bridgelab.session.v3.6`, the v3.5 legacy fallback and `bridgelab.library.v3.6`. The native diagnostic backup format remains v036 because the saved-data schema is unchanged. No save data is cleared. Silent bundle recovery unregisters an outdated service worker and reloads the packaged bundle once.

Android SafeArea and minimal mobile overrides preserve the desktop layout. History import/export uses the existing native system document picker. No broad storage permission is requested.

Build and verification evidence is available under `docs/` for this version. Historical v0.3.6 proofs were not copied as current evidence. Android installation, WebView interactions and the system document picker remain unverified on a physical device.

Code42 fixed-seat revision: South stays at the bottom, North dummy stays at the original North seat, and the hand/dummy seat-switch control is removed. Publicly revealed East/West dummy hands use real card faces at their original seats; unrevealed hands remain hidden. Code41 release and proofs are preserved under `artifacts/previous-code41`.



Code44 double-column revision: NS/EW tricks appear as two vertical columns without the left numeric scale, with the contract target on the declaring side. East/West public dummy cards retain real CardView faces and their original seats, with one horizontal row per suit (S/H/D/C). Code43 release, source and evidence are preserved under `artifacts/previous-code43`.

<!-- FINAL_VALIDATION -->
Install `release/BridgeLab-v0.3.7-mobile-android.apk` (code44; 44,476,680 bytes). SHA-256: `6811670efe387813d506d09ca226e804ad51fac0a8235dec8d6c7e3290ea0021`.

Fresh double-column tricks display, side-suit horizontal-row and fixed-seat mobile browser checks, exact code43 stale-Workbox recovery, v3.6 data retention, offline continued bid and 52-play archived replay passed. Package/assets/signature and code43 -> code44 upgrade compatibility passed. Native code is unchanged; prior format/analysis/7 Flutter tests/8 JavaScript checks were reused with SHA-256 equality and the explicit pubspec version metadata exception. Physical Android installation, WebView and document picker remain untested.
