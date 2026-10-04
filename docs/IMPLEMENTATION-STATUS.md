# Implementation evidence and remaining requirements

This file records progress against the full original objective. It is not a completion claim.

## Verified locally

- React/Electron application builds and typechecks. Actual Electron smoke verifies real worker IPC/SQLite, bot creation, messages, missing-provider error, and native capabilities.
- SQLite mutations, idempotent commands, revision conflicts, search, bot deletion, schedules/missed runs, workspace traversal checks, and approval-before-write are covered by executable tests.
- Provider fixtures exercise OpenAI-compatible/Anthropic SSE, tools, abort, model discovery, endpoint validation, sanitized errors and redirects. These are local fixtures, not live paid-model certification.
- Five service APIs, HTTP manifests and real MCP transports are connected to the agent runtime and desktop secure storage. Tool scopes, external-write approvals, cursor persistence and event routine deduplication have executable tests. Desktop token/manifest setup works; service OAuth acquisition still needs completion.
- Rust native helper release built for Windows x64; accessibility inspection and screenshot smoke passed. Linux code compiles but has not been certified. Wayland portal control is not implemented.
- Self-hosted signaling has real HTTP/WebSocket tests for identities, single-use pairing, expiry, revocation, persistence and TURN credentials. Docker deployment and actual cross-network TURN remain unverified.
- Android debug APK assembled; six JVM tests pass, lint has zero errors. No device is attached for Android-to-desktop end-to-end verification. Production signing is not supplied.
- Website https://fox-bot-pi.vercel.app/ deployed and verified, with unavailable production download buttons disabled.
- Public source repository https://github.com/teo12342/fox-bot is published.
- Windows x64 unsigned development installer built with browser runtime. Actual packaged and isolated installed-app smoke verify local IPC/SQLite, bundled native helper, Chromium navigation, PDF extraction, memory controls, inactive voice controls, connector setup and screenshot artifacts. Silent NSIS install and uninstall pass. This is not signed or clean-PC certification.
- HostRelay/service pairing integration verifies pinned signatures, manual codes, replay rejection, early ICE, session retirement, and revocation. Real Chromium peers establish connected DTLS and transfer 200 KB of fragmented data. This does not substitute for physical Android/cross-network acceptance.
- Native agent integration has eleven simulated helper/real-provider-fixture tests for tool schemas, approvals, run ownership, takeover, emergency stop/resume and deduplicated physical input. Six Rust tests include real read-only focus and PNG screenshot checks. No actual desktop input is driven by these tests.
- Speech adapter has seventeen local-fixture tests for transcription, streamed synthesis, endpoint and format validation, cancellation, response limits and credential isolation. Live voice is not certified.
- Voice memo recording, reviewed transcripts, configured-provider synthesis and playback are integrated in desktop UI. A physical microphone and live paid-provider acceptance are still unverified.
- Text, images, PDF, DOCX, XLSX and PPTX extract locally with bounded content, cancellation and isolated PDF processes. Packaged PDF-to-model-fixture smoke passes; thirteen extraction/engine tests cover actual model payloads, vision gating, metadata removal and malicious inputs. Audio attachments, OCR and legacy binary Office files are not supported by this extractor.
- Integrated verification: 94 core tests, 3 signaling tests and 3 website tests pass; TypeScript checks pass. Terminal cancellation and timeout tests verify that owned descendants stop while a separate sibling process survives. These counts describe local verification, not certification of every requested platform.
- GitHub Linux core verification, Windows desktop smoke and website verification pass. Windows x64 packaging and packaged smoke pass. Canvas 0.1.100 supplies the previously missing Windows ARM64 binding, and Linux packaging now has an explicit executable name. Fresh architecture builds must validate these corrections before claiming support.
- Immutable development prerelease v0.1.0-dev.1 is published with an unsigned Windows x64 installer and debug-signed Android APK. Public asset hashes were independently downloaded and checked; the website displays their development status. The prerelease predates the terminal and architecture packaging corrections.

## Work remaining before completion

1. Obtain official ChatGPT OAuth registration and verify eligible identity sign-in. Identity code is implemented but currently unavailable without provisioned configuration.
2. Capture authenticated Grok Bot reference screens and complete the screenshot/interaction comparison. Only its installed sign-in screen was inspectable.
3. Complete service OAuth flows, event routine UI, comprehensive adapter capability declarations and user-visible usage reporting. Dynamic tool capability gating and persisted usage records are implemented.
4. Complete remaining audio attachment analysis, legacy Office/OCR coverage and broader real-document validation. Supported attachments are incorporated into provider requests; screenshots feed vision-capable model requests.
5. Complete live voice with interruption, Android speech, teach-by-demonstration, message replies/retries and summarized memory management. Desktop voice memos/speech and retained-memory edit/disable/delete controls are implemented.
6. Complete Wayland portals and multi-monitor/scale verification. Native tool integration, desktop ownership, emergency stop/resume and password-field typing refusal are implemented; native MFA detection remains heuristic.
7. Verify mobile command/fragmentation/signaling interoperability, real media/control/voice, reconnection, revoked peers, offline states, and two-network TURN operation.
8. Build/install-test all desktop architectures/formats, sign Windows production binaries/APK/update metadata, and certify the Linux matrix. Windows x64 browser bundling is verified; other platform browser resources still need testing.
9. Publish subsequent verified development builds and eventual production artifacts; preserve immutable assets and accurate development/stable labels. The initial development downloads and public source are published.
10. Inspect CI results after publication; resolve browser redistribution evidence and bundled FFmpeg corresponding-source obligations, verify dependency notices, implement signed updates and complete final end-to-end acceptance against every original requirement. A repository license alone does not establish permission to redistribute its downloaded binaries.

The goal remains active. Unavailable external prerequisites do not replace or narrow the requested final state.
