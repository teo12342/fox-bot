# Release operations

Run Desktop release builds for x64/ARM64 Windows/Linux and Signed Android release. Configure the Windows certificate and password, Android keystore/password/alias, and an Ed25519 release metadata signing key in GitHub secrets. Preserve the Android key and back up signing material offline. Release workflows fail rather than silently pretending signing is configured.

Run Publish verified artifacts with successful workflow run IDs and the existing version tag. It generates SHA256SUMS, releases.json, and a detached metadata signature where configured, then creates a draft GitHub release. Stable publishing requires evidence URLs for every verified gate. Review artifacts and final release notes before exposing the draft. Do not turn failing gates green based on a build alone.

After publishing, copy the exact releases.json into apps/web/public/releases.json. Download URLs must reference immutable GitHub release assets. Run website tests/build, verify every URL/hash, then deploy. Keep unpublished artifacts absent rather than generating guessed links.

Website deployment uses the built Next.js static export. Configure VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID for the new Fox Bot project; do not reuse an unrelated project ID. No credentials are committed.

Artifacts use fox-bot-VERSION-win-ARCH.exe, fox-bot-VERSION-linux-ARCH.FORMAT, and fox-bot-VERSION-android-universal.apk. The manifest normalizes win to windows. Linux formats are AppImage, deb, rpm, flatpak, tar.gz.

Development prerelease v0.1.0-dev.1 contains an unsigned Windows x64 installer and debug-signed Android APK. Its artifacts remain immutable and do not satisfy production signing, identity, fidelity, full platform certification, or cross-network Android acceptance gates.

Initial matrix run 37188933741 passed Windows x64 packaging and smoke. Windows ARM64 tests exposed the missing Canvas 0.1.80 native binding; use Canvas 0.1.100 with its Windows ARM64 optional dependency. Both Linux jobs failed AppImage packaging because the scoped package name inferred an invalid executable name. Linux packaging explicitly sets executableName to fox-bot in the package configuration and workflow CLI. These repairs require a fresh matrix run; successful source verification alone does not establish installer compatibility.
