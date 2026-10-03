# Fox Bot Android companion

Android 10+ Kotlin/Compose application. Android holds a hardware-backed/non-exportable P-256 signing key in Android Keystore; model credentials and execution remain on the PC. Public host identity is pinned from the QR. The app refuses plaintext relay endpoints. Google Play services are needed for the integrated QR scanner; pasting the QR JSON works without the scanner.

## Build

Install JDK 17 and Android SDK platform 35/build-tools 35.0.0. Set `ANDROID_HOME` or ignored `local.properties` with `sdk.dir`. Run `./gradlew assembleDebug testDebugUnitTest` (Windows: `gradlew.bat`). Debug output: `app/build/outputs/apk/debug/app-debug.apk`. Universal APK includes arm64-v8a and x86_64 WebRTC libraries.

Release: set `FOX_ANDROID_KEYSTORE`, `FOX_ANDROID_STORE_PASSWORD`, `FOX_ANDROID_KEY_ALIAS`, `FOX_ANDROID_KEY_PASSWORD` as process/CI environment variables, then `./gradlew assembleRelease`. Release signing validation fails without these. Never commit a key/password. Preserve and back up the private release key for APK updates.

## Pair and connect

1. Configure a self-hosted HTTPS/WSS signaling and TURN service on the PC (see `../../services/signaling/README.md`).
2. In Settings scan the PC QR or paste its JSON. Pair codes are single-use and expire in five minutes.
3. Compare the eight hexadecimal verification digits on both devices before approving on PC.
4. Both endpoints sign signaling using ECDSA P-256/SHA-256. The phone rejects host-key changes, invalid signatures, wrong destinations, unknown sessions and replayed sequence numbers before processing SDP or ICE.
5. Remote mutations use UUID commands over the encrypted WebRTC `fox-rpc` data channel. No chat payloads pass through signaling. Reconnect requests fresh TURN credentials and a fresh session. The PC enforces device trust, approvals and revisions.

Unsent drafts persist on the phone. Offline mutation controls are disabled or explicitly reject commands. Keep Connection in Background opts into an Android foreground service with a visible notification; it is not push delivery. The PC must stay awake. Forgetting a PC creates a fresh phone ID; revoke the previous identity from PC as well.

## Implemented screens and contract

Bot list/create/edit/duplicate; conversations/chat/dictation/cancellation; skills and routines create/edit/delete/pause; approval review; pairing/settings/background connection; artifacts list; receiving PC video and requested takeover/pointer/text control. Commands and snapshot entities follow `packages/protocol/src/index.ts`. Optional artifact/computer commands require corresponding desktop handlers; failures are surfaced, never simulated as success.

## Verification and remaining gates

Source unit tests cover QR expiry, secure endpoints, maximum lifetime, UUID uniqueness and Node-compatible signature encoding. On October 4, 2026, `gradlew.bat assembleDebug testDebugUnitTest lintDebug` passed: debug APK generated, 6 tests passed, lint reported 0 errors. `:app:verifyReleaseSigning` deliberately failed with missing release environment variables, proving the publication credential gate. Gradle distribution checksum is pinned to the official 8.11.1 checksum. Named debug artifact: `release/FoxBot-0.1.0-android-debug.apk`.

No Android device/emulator is connected in the implementation environment: actual camera QR scanning, Keystore operation, video decoding, background behavior, device pairing, remote editing and mobile-data/forced-TURN scenarios require device acceptance testing. Production APK signing needs the owner's persistent release key. Attachments upload and artifacts save use PC command handlers with fragmented WebRTC transport; end-to-end transfer is unverified. File attachments are limited to 20 MiB. Live conversational voice is not implemented by the dictation action. No Grok mobile reference was supplied, so exact visual fidelity is unverified.

The fragmented transport sends `{type:"fragment",id,index,total,data}` with 16,384-character chunks; messages are reassembled before parsing. Receivers cap transfers at 2,048 chunks and 8 pending transfers. Sender backpressure waits below 256 KiB buffered data. The app retains chat drafts until the PC acknowledges a successful send. Public source and installer publication are managed by the root release workflow, not this build directory.
