# Published website

Production website: https://fox-bot-pi.vercel.app/

Vercel project: fox-bot. Deployment owner scope: teolabrop1-2608s-projects. Static Next.js export is built from apps/web. Trailing slash routes are required for folder-index hosting. All public pages and releases.json were verified with HTTP 200 on 2026-10-04.

The manifest publishes the verified v0.1.0-dev.1 Windows x64 unsigned installer and Android universal debug-signed APK from https://github.com/teo12342/fox-bot/releases/tag/v0.1.0-dev.1. Both retain source commit 3377c635ce7c2616c55ec67d4cc8a7a884407c54. Download cards display package warnings and SHA-256 hashes; Linux and Windows ARM64 remain unavailable. Public source is available at https://github.com/teo12342/fox-bot. All production acceptance gates remain pending.

Build with npm run build -w @foxbot/web. Link the generated output explicitly to fox-bot before each manual deployment because the build recreates out:

    vercel link --yes --project fox-bot --cwd apps/web/out
    vercel deploy --prod --yes --cwd apps/web/out

The generated out/.vercel and environment files are ignored and must never be committed. CI uses configured organization/project identifiers instead of guessing a target.

Website verification: three manifest tests passed; Next production TypeScript/build passed. After deployment dpl_DeowEcYjCTr5tgDSrSGWHVYdHoog, live desktop and 390px mobile rendering was inspected in Edge: both package warnings, hashes, public HTTP 200 asset links, unavailable Linux/ARM64 controls, and no mobile horizontal overflow were verified on 2026-10-04. Artifact bytes were independently downloaded and hashed by the release owner before website publication.
