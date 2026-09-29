# Chicomint production deployment

Verified on 2026-09-29. Project: `neocities-chicomint`; environment: `production`; web service: `chicomint`. The active deployment `f6224ebd-79b3-4253-9b8a-24ce787dd5a5` is `SUCCESS` and serves [chiko.cc](https://chiko.cc). The separate `chicomint-preview` service and its Railway-generated domain were removed at the owner's request. Only `chicomint` and `MongoDB` remain in the production environment.

MongoDB 7.0 runs as the persistent Railway MongoDB service with a `/data/db` volume. The application connects through Railway private networking. CMS images live in MongoDB GridFS; the web service's `/data` volume holds visitor statistics. The production migration has already completed: 35 real blogs, 8 drawings, and 24 stored images. Do not rerun or reset it for routine deployments. Original source content is preserved in `legacy/` and the Neocities copy.

The post-redeployment persistence probe succeeded. Its temporary blog, drawing, and uploaded image were removed, leaving exactly 35 blogs and 8 drawings. Final live verification passed 82 checks, including all post pages, all 24 stored image URLs, admin login/logout, clean routes, redirects, and access controls. Browser checks passed on desktop and mobile without console errors. `/health` returns 200 when MongoDB responds. The existing external image at `boards.chiko.cc/src/1784369978078225.png` was already unavailable before migration; its reference remains intact.

The active custom domain `chiko.cc` has a valid TLS certificate. The owner does not use `www.chiko.cc`; it is not configured as a Railway custom domain. The existing external `www` DNS/TLS setup was left unchanged.

The web service's old GitHub deployment source was disconnected after CLI deployment so an unrelated push cannot roll back the CMS. To deploy future changes, use Railway CLI from this project checkout and verify the resulting deployment status and `/health`. Reconnect GitHub only after committing this CMS work and deliberately choosing the correct branch. `railway.json` contains the start, healthcheck, and restart configuration. The server binds `process.env.PORT` on `0.0.0.0`.

Required production variable names are `NODE_ENV`, `MONGODB_URI`, `MONGODB_DB`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, and `SITE_ORIGIN`. Railway supplies `PORT`. Local setup and migration commands are in [README.md](README.md); use `npm run migrate` only when importing a new or otherwise uninitialized database. Log in at `https://chiko.cc/:3` with the private configured admin credentials.
