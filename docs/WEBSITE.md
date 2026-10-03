# Published website

Production website: https://fox-bot-pi.vercel.app/

Vercel project: fox-bot. Deployment owner scope: teolabrop1-2608s-projects. Static Next.js export is built from apps/web. Trailing slash routes are required for folder-index hosting. All public pages and releases.json were verified with HTTP 200 on 2026-10-04.

The manifest currently contains no published installer artifacts. The download page displays disabled controls rather than invented links. Public source publication is pending. All production acceptance gates remain pending.

Build with npm run build -w @foxbot/web. Link the generated output explicitly to fox-bot before each manual deployment because the build recreates out:

    vercel link --yes --project fox-bot --cwd apps/web/out
    vercel deploy --prod --yes --cwd apps/web/out

The generated out/.vercel and environment files are ignored and must never be committed. CI uses configured organization/project identifiers instead of guessing a target.

Website verification: two manifest tests passed; Next production TypeScript/build passed; desktop and 390px mobile render inspected in Edge; package selector worked; three unpublished download buttons remained disabled; no mobile horizontal overflow.
