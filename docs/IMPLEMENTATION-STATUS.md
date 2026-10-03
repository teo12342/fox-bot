# Implementation evidence and remaining requirements

This file records progress against the full original objective. It is not a completion claim.

## Verified locally

- React/Electron application builds and typechecks. Actual Electron smoke verifies real worker IPC/SQLite, bot creation, messages, missing-provider error, and native capabilities.
- SQLite mutations, idempotent commands, revision conflicts, search, bot deletion, schedules/missed runs, workspace traversal checks, and approval-before-write are covered by executable tests.
- Provider fixtures exercise OpenAI-compatible/Anthropic SSE, tools, abort, model discovery, endpoint validation, sanitized errors and redirects. These are local fixtures, not live paid-model certification.
- Connector module implements five APIs, HTTP manifests and MCP, with scope/approval/cursor tests. Engine/UI integration and OAuth acquisition still need completion.
- Rust native helper release built for Windows x64; accessibility inspection and screenshot smoke passed. Linux code compiles but has not been certified. Wayland portal control is not implemented.
- Self-hosted signaling has real HTTP/WebSocket tests for identities, single-use pairing, expiry, revocation, persistence and TURN credentials. Docker deployment and actual cross-network TURN remain unverified.
- Android debug APK assembled; six JVM tests pass, lint has zero errors. No device is attached for Android-to-desktop end-to-end verification. Production signing is not supplied.
- Website https://fox-bot-pi.vercel.app/ deployed and verified, with unavailable production download buttons disabled.

## Work remaining before completion

1. Obtain official ChatGPT OAuth registration and verify eligible identity sign-in. Identity code is implemented but currently unavailable without provisioned configuration.
2. Capture authenticated Grok Bot reference screens and complete the screenshot/interaction comparison. Only its installed sign-in screen was inspectable.
3. Complete engine/UI connector integration, service OAuth flows, event routines, full tool capability gating, and usage reporting.
4. Complete local extraction of PDF/Office/audio attachments and incorporate attachments into provider requests. Current attachment persistence alone does not fulfill analysis support.
5. Complete live voice, cloud/local speech adapters, voice memos, teach-by-demonstration, message replies/retries, and advanced memory controls.
6. Complete native-tool agent integration, exclusive desktop ownership, emergency-stop enforcement, Wayland portals, and multi-monitor/scale verification.
7. Verify mobile command/fragmentation/signaling interoperability, real media/control/voice, reconnection, revoked peers, offline states, and two-network TURN operation.
8. Bundle browser dependencies, build/install-test all desktop architectures/formats, sign Windows production binaries/APK/update metadata, and certify the Linux matrix.
9. Publish public source and real prerelease artifacts; update website only with verified artifact links and correct development/stable labels.
10. Inspect CI results after publication; verify source licenses/notices, updates and final end-to-end acceptance against every original requirement.

The goal remains active. Unavailable external prerequisites do not replace or narrow the requested final state.
