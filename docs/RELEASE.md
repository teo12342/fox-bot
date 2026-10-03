# Release operations

Run Desktop release builds for x64/ARM64 Windows/Linux and Signed Android release. Configure the Windows certificate and password, Android keystore/password/alias, and an Ed25519 release metadata signing key in GitHub secrets. Preserve the Android key and back up signing material offline. Release workflows fail rather than silently pretending signing is configured.

Run Publish verified artifacts with successful workflow run IDs and the existing version tag. It generates SHA256SUMS, releases.json, and a detached metadata signature where configured, then creates a draft GitHub release. Stable publishing requires evidence URLs for every verified gate. Review artifacts and final release notes before exposing the draft. Do not turn failing gates green based on a build alone.

After publishing, copy the exact releases.json into apps/web/public/releases.json. Download URLs must reference immutable GitHub release assets. Run website tests/build, verify every URL/hash, then deploy. Keep unpublished artifacts absent rather than generating guessed links.

Website deployment uses the built Next.js static export. Configure VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID for the new Fox Bot project; do not reuse an unrelated project ID. No credentials are committed.

Artifacts use fox-bot-VERSION-win-ARCH.exe, fox-bot-VERSION-linux-ARCH.FORMAT, and fox-bot-VERSION-android-universal.apk. The manifest normalizes win to windows. Linux formats are AppImage, deb, rpm, flatpak, tar.gz.
