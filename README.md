# Chicomint CMS

The original Node HTTP server, Sakura CSS, star background, cursor/presence behavior, navigation, and drawing canvas are retained. MongoDB stores blogs, drawings, sessions, login limits, migration backups and GridFS images.

## Local use

Requires Node 22.13+ and MongoDB 7+.

```sh
npm install
npm run db       # separate terminal; persistent local data in data/mongodb
npm run migrate
npm start
```

Visit `http://localhost:3000/:3`. Credentials are in the private `.env` created during setup. They are never bundled or served. The local MongoDB runner is for development only; production uses a persistent Railway MongoDB service.

For another checkout, copy `.env.example` to `.env` and fill `MONGODB_URI`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (bcrypt, cost 12 recommended), and `SESSION_SECRET` (at least 32 random characters). `ADMIN_PASSWORD` is supported for compatibility; a configured hash takes precedence. Changing credentials invalidates existing sessions.

## Administration

Dashboard: `/admin`. Create/edit blogs with BBCode, upload/insert images, preview, save drafts, publish/unpublish, and confirm deletions. Slugs can be edited; old slugs redirect permanently. Drawings support title, caption, date, order, image, thumbnail, and publication status. Lower order values appear first. Uploads can be removed from the library without breaking existing image URLs.

Deletes retain recovery records with `deletedAt` in MongoDB and remove items from public pages and admin lists. Migration does not resurrect them or overwrite edited content. Restore a deleted record through a trusted database operator by removing `deletedAt` and explicitly choosing its publication status.

The existing public visitor drawing canvas remains available. Its submissions retain the existing PNG validation, origin checks, concurrency limit, rate limits, and optional Turnstile challenge, and now use GridFS. The admin CRUD/upload/preview endpoints require authentication and CSRF tokens.

## Migration and original content

```sh
npm run migrate
npm run verify:migration
```

On an uninitialized database, migration runs before startup accepts traffic. A production database with a verified migration marker and the expected 35 posts and 8 drawings starts without rerunning migration. `legacy/all_blog.html` is an immutable original; `legacy/drawings/` contains original PNGs, and `legacy/blog-images/` contains backed-up external blog images. Original static pages, `picture/` images, and local backups remain. Ordinary design assets stay in `media/`.

Imports use unique legacy keys, a migration lease, immutable source HTML/hashes, and insert-only records. Untouched import content can gain migrated asset references; admin edits remain intact. MongoDB holds source backups as well. Every stored image is verified with SHA-256 by `verify:migration`.

The original `https://boards.chiko.cc/src/1784369978078225.png` returned 404 before migration; its original reference is preserved. Six other external images were recovered into GridFS. Existing embedded video keeps its original external URL and fallback text.

To import drawings from an existing volume, set `LEGACY_DRAWINGS_DIRECTORY` to that drawings directory for migration. No source files are deleted. Back up MongoDB (including `images.files`, `images.chunks`, and all CMS collections) and the statistics volume regularly.

## Routes

`/`, `/blogs`, `/blogs/archive`, `/blog/<slug>`, `/drawings`, `/project`, `/credits`, `/cat`, `/h`, `/love_chiko`, `/math/`, `/d/` are server routes. Known `.html` routes return HTTP 301 redirects; `/all_blog.html` and `/all_blog` lead to `/blogs/archive`, preserving full-archive text fragments. Missing posts return 404. The login route is an exact native HTTP pathname comparison with `/:3`, so the colon is literal.

## Security and uploads

Server-side environment credentials, bcrypt hash support, constant-time comparisons, MongoDB-backed signed opaque sessions, 8-hour expiration, `HttpOnly`, `SameSite=Strict`, production `Secure` and `__Host-` cookies, session rotation, CSRF tokens, origin checks, persistent login limits, and generic errors protect administration. Production requires HTTPS `SITE_ORIGIN`. Trust forwarding headers only from verified proxy addresses.

BBCode escapes raw HTML, validates HTTP(S)/local URLs, bounds nesting and content size, and sanitizes output with an allowlist. Preview is rendered by the same server parser inside a sandboxed iframe. Supported tags include bold, italic, underline, strike, URL, image, quote, code, list, center, bounded color/size, and video for the existing archive.

New uploads: JPEG/PNG/WebP/GIF, maximum 10 MiB, extension/MIME/decoded-format agreement, 40 million decoded pixels, maximum 200 frames, and concurrency limits. Sharp decodes and re-encodes uploads, stripping metadata and appended payloads. SVG and executable formats are rejected. Trusted legacy originals are retained byte-for-byte. Files use random names in GridFS, delivered at `/uploads/<id>` with MIME, length, cache headers, and `nosniff`. No base64 document storage or temporary upload filesystem is used.

## Production configuration

Required names: `NODE_ENV`, `MONGODB_URI`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (or legacy `ADMIN_PASSWORD`), `SESSION_SECRET`, `SITE_ORIGIN`. Railway supplies `PORT`; the server binds `0.0.0.0`.

Optional: `MONGODB_DB`, `DATA_DIRECTORY`, `STATS_CSV_PATH`, `LEGACY_DRAWINGS_DIRECTORY`, `STATS_TRUSTED_PROXIES`, `STATS_IP_HEADER`, `ADMIN_TRUSTED_PROXIES`, `ADMIN_IP_HEADER`, `DRAWINGS_TRUSTED_PROXIES`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `MAX_DRAWINGS`, `MAX_DRAWING_STORAGE_MB`, `ALLOWED_ORIGINS`. Build configuration uses `RAILPACK_NODE_VERSION=22` and `NPM_CONFIG_OMIT=dev`.

MongoDB uses private networking with a volume mounted at `/data/db`. The web volume at `/data` retains visitor statistics only; CMS uploads are in GridFS. `/health` returns 200 only if the running server can ping MongoDB; otherwise it returns 503. Production refuses to start without valid configuration or a verified migration. Keep MongoDB private, configure database backups, and retain the source archives.

`railway.json` defines Railpack, `npm start`, health checks and restart behavior. Railway has announced retirement of this config format on December 1, 2026; equivalent service settings should also be stored in Railway infrastructure configuration. See `DEPLOYMENT.md` for the actual deployed state.

## Verification

```sh
npm run db
npm test
npm run verify:migration
npx playwright install chromium
node --env-file=.env scripts/browser-check.js
```

Tests exercise migration/idempotence, all clean routes, redirects, real MongoDB persistence, auth/session/CSRF/rate limits, upload validation, CRUD, drafts, safe rendering, slug history, and existing presence/canvas/statistics behavior. Browser checks cover desktop/mobile, editor preview, login/logout, and console errors. The live deployment probe creates only clearly named temporary verification content and checks it again after redeployment.

## Files

- `server.js`: existing HTTP/WebSocket server and CMS integration.
- `cms/database.js`, `models.js`: database indexes and server-side data validation.
- `cms/auth.js`, `bbcode.js`, `uploads.js`, `http.js`: security, rendering, storage and errors.
- `cms/routes/`, `cms/views/`: admin/public routes and reused site layout.
- `admin.js`, `cms.css`: editor and small theme-compatible additions.
- `cms/migration.js`, `legacy/`, `scripts/`: preserved content, migration, deployment and verification.
- Existing public HTML navigation and drawing integration were updated; original styling remains.

Added production packages: `mongodb`, `bcryptjs`, `sanitize-html`, `sharp`, `cheerio`. Development packages: `mongodb-memory-server`, `playwright`.
