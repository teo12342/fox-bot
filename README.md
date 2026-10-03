# Fox Bot

Local persistent AI teammates for Windows and Linux, with a paired Android companion.

Website: https://fox-bot-pi.vercel.app/

## Development

Requires Node.js 24+, npm, and Windows 11 or a supported Linux desktop.

```powershell
npm install
npm run build
npm run dev
```

The desktop's local development workspace is accessible without claiming ChatGPT authentication. Official identity sign-in requires a provisioned public OAuth client configured with `FOX_CHATGPT_CLIENT_ID`, `FOX_CHATGPT_ISSUER`, and the registered `FOX_CHATGPT_REDIRECT_URI` (default `http://127.0.0.1:42173/callback`). No client secret is bundled.

Connect a provider in Settings, then edit a Bot and select its provider/model. Cloud accounts and credits are separate from ChatGPT identity. Local Ollama/compatible model servers need no cloud credential.

State is SQLite in Electron's per-user application directory. Provider and relay secrets use OS secure storage. Bots use a shared local workspace and dedicated persistent Playwright browsers. Closing the window leaves the runtime in the tray; explicitly quitting or sleeping/shutting down stops work.

## Tests and builds

```powershell
npm test
npm run typecheck
npm run build
node apps/desktop/scripts/smoke.mjs
```

Run the smoke script from `apps/desktop` (it uses that working directory). See `apps/android/README.md` for APK builds and `native/README.md` for the native helper. `infra/README.md` documents the self-hosted signaling/TURN deployment required for cross-network pairing.

## Status

This is an implementation in progress. The website exists; production installers and complete compatibility certification are not yet available. See `docs/IMPLEMENTATION-STATUS.md` for current evidence and remaining requirements. Do not describe the project as a verified 1:1 replacement until the reference, feature, remote-access, and release gates pass.

Original Fox Bot code is MIT licensed. Grok Bot names are used only to identify the requested reference. No proprietary implementation or account cookies are included.
