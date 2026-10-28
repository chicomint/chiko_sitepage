# ChikoChan production replacement

The independent imageboard is isolated in `imageboard/`; the personal website and
`systems/` drawing backend remain separate. See [MIGRATION.md](MIGRATION.md) for
the inspected infrastructure, backup evidence, acceptance checks and rollback.

Production uses `CHIKO_DATA_FORMAT=legacy-v16`: a new Express/MongoDB backend and
responsive interface under `compat/`, with Sharp and FFmpeg for new uploads.
It never loads, invokes or proxies to the old imageboard runtime. The existing
native ChikoChan code below is retained for local development and shared helpers.

## Production setup

Node 22; `npm ci`; service root `/imageboard`; Dockerfile builder; start
`node start.js`; readiness `/readyz`; one replica; persistent `/data` volume.
Use `.env.example` as documentation and keep actual secrets in Railway variables.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `CHIKO_DATA_FORMAT` | `legacy-v16` required for this replacement |
| `MONGODB_URI` | Private connection with a database-scoped principal; secret |
| `CHIKO_DATABASE` | Explicit existing database name; never inferred/seeded |
| `PUBLIC_ORIGIN` | Exact HTTPS origin; include the port for local browser tests |
| `PORT` | HTTP port, normally 3000 |
| `ADMIN_SESSION_SECRET` | Random, stable secret of at least 32 characters |
| `ABUSE_FINGERPRINT_SECRET` | Different random, stable secret of at least 32 characters |
| `CHIKO_LEGACY_MEDIA_DIR` | Verified copy of old disk media, normally `/data/legacy-media` |
| `CHIKO_MEDIA_DIR` | New upload path, normally `/data/chiko-media` |
| `CHIKO_WRITES_ENABLED` | Defaults false; enable only on an accepted copy/cutover |
| `CHIKO_DEPLOYMENT_ROLE` | `staging` for an isolated copy; `production` for real data |
| `CHIKO_MIGRATION_APPROVED` | Must be true for production writes after owner approval |
| `TRUST_PROXY` | Explicit verified proxy policy; arbitrary `true` is rejected |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Optional platform binaries; packaged binaries are defaults |

The container initializes only the new upload directory, then drops root. Original
media must be readable by the Node user. No automatic content pruning runs.

## Data and authentication

Threads use `(boardUri, threadId)` and replies `(boardUri, postId)`. Source IDs,
BSON types, unknown metadata, users and settings remain intact. Original
`/board/res/123.html` URLs work; earlier `/board/thread/id` URLs redirect using
the existing `chikoIdMap`. Media is served independently from disk/GridFS.

New `chiko*` sidecars hold permissions overlays, moderation state, counters,
sessions' account versions, rate limits, reports and credential bridges. Deletion
uses reversible tombstones: original records and bytes are never removed.
New posts append without renumbering old ones. Old software must stop writing
before production ChikoChan writes begin, because it does not read these sidecars.

PBKDF2 and PBKDF2V2 accounts use unchanged passwords/hashes. A verified original
native backup recovers compatible scrypt credentials through recorded account
and post ID mappings. Hashes are copied unchanged into sidecars; no password is
guessed, converted from a hash or reset. Disabled accounts remain disabled.
Board ownership and moderator scopes remain effective. Unknown schema versions
fail startup. Historical posts without compatible poster identities cannot be
banned by guessing their IP; new connection bans use keyed fingerprints.

HTTPS sessions use Secure, HttpOnly, SameSite Strict cookies. Signed CSRF tokens
and exact origins protect mutations. Posting requires an encrypted six-digit
image challenge with atomic single-use nonces. Shared MongoDB rate limits cover
uploads, posts, login, reports and deletion. Upload size/time/concurrency limits,
image decoding/re-encoding and video probing/remuxing validate new attachments
and strip metadata. Existing media bytes are never re-encoded.

## Backup and non-destructive migration modules

- `scripts/copy-data.js`: raw BSON export and verified import into a separately
  named, empty `chiko_staging_*` database; refuses existing targets. TTL indexes
  are omitted on copies so restored records cannot expire during review.
- `scripts/bridge-credentials.js`: ID-verified credential plan and additive
  sidecar import; rejects differing existing hashes and never changes privileges.
- `scripts/verify-source.js`: read-only count/raw BSON digest verification,
  GridFS/disk readability and size checks, and attachment reference checks.
  Requires `MONGODB_URI`, `CHIKO_DATABASE`, `CHIKO_INVENTORY`,
  `CHIKO_LEGACY_MEDIA_DIR`.

Native startup and its JSON-to-MongoDB migration refuse an unmarked existing
database containing boards/posts/users. Never use native migration on production.

## Validation and GitHub deployment

```sh
npm run check
CHIKO_TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test
npm audit --omit=dev
```

Use an isolated local MongoDB 7 container. Integration tests accept only a local
endpoint without credentials, use new randomly named databases and never drop a
database or collection. Without this endpoint one integration test is skipped;
CI provisions MongoDB and always runs it. Other tests cover the retained native
backend and shared components. Browser checks used the actual restored copy.

After approval, production's GitHub source must be `chicomint/chiko_sitepage`,
branch `main`, root `/imageboard`, with check suites enabled. Staging can track
the feature branch. Nothing in this repository merges the PR or changes domains.

Native code/assets originate from `chicomint/ChikoChan` at `4937e53`, under the
included ISC license. The compatible backend and interface are new code; no old
runtime, frontend, logos or proprietary assets are included in production.

---

# Native ChikoChan local-development reference

A lightweight and simple imageboard built with Node.js.
ChikoChan supports multiple boards, file uploads, and can run locally without needing a database server.

## Getting Started

### Requirements

- Node.js 22 or newer
- npm
- Git

### Installation

Clone the repository:

```bash
git clone https://github.com/chicomint/ChikoChan.git
cd ChikoChan
```

Install the dependencies:

```bash
npm install
```

Start ChikoChan:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```
Follow the setup on the page. The configuration will be saved in a `.env` file. If you want to change or add more settings later, check `env.example.txt` for the available options.



(To skip the installer for local testing, you can still use):

```bash
npm run start:local
```



## Development

Start the server with Node.js watch mode:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Check the JavaScript files for syntax errors:

```bash
npm run check
```
