# ChikoChan migration record — 2026-10-28

## Observed infrastructure

Existing Railway project `ChikoChan`: `f15644cb-4b8d-4c8c-8cf1-f83ddd432f83`.
Production: `f982fb56-8dd4-4ee0-b1f1-cef29fc81e8c`.
Beta: `08090f87-deea-42db-adfe-448139a17aca`. No duplicate project was created.

| Resource | Existing use |
| --- | --- |
| `ChikoChan` / `966c0107-f582-4d46-84ff-477e43b02697` | Caddy gateway at `boards.chiko.cc`, target 8090; persistent `/data` with original native files |
| `lynxchan-production` / `f199b418-b309-4b2a-8692-f362cafc3d00` | Current imageboard, gated private upstream; `/data`, with disk media `/data/media` |
| `mongodb-lynx-production` | MongoDB 7, database `lynxchan_production`, volume `/data/db` |
| `MongoDB` | Original native MongoDB 8, database `test`, volume `/data/db` |
| `lynxchan-beta`, `mongodb-beta` | Existing beta applications/data, retained |
| `chikochan-next` / `82ba46a6-1d79-4be0-8abe-970f6b6a6a1a` | New independent staging application in beta, separate volume `/data` |

The requested GitHub repository contains a personal site/drawing backend, not
the production imageboard. The gateway was configured to the different
`chicomint/ChikoChan` repository. Uncommitted personal-site edits remain in the
original checkout; the migration uses a separate feature worktree.

## Backups and recovery evidence

Private directory: `/home/chicomint/chikochan-migration-backups/20261028` (0700;
archives/manifests 0600). It contains secrets and private moderation data. Never
publish/commit it. Keep a separate encrypted off-machine copy under owner control
before final production acceptance.

| Archive | SHA-256 |
| --- | --- |
| `mongo-all.archive.gz` | `d4e450117cbdc6cf109d8c38c17d1a1f28e617f510bc86c3a1cec2a469eabd6f` |
| `original-native.archive.gz` | `ec92879141b83d2b1057d6ed86b8ac835df86387bb2dc06a6e86e58d81dce6f5` |
| `lynx-media.tar.gz` | `55f4cd316b887ee955be83205d2ee37f0f3764b88bb8e3453587ba4c885bfe7b` |
| `gateway-data.tar.gz` | `2808a4dc7132001c5684b73e629a5f37ae2545ffdd17212a94520bc8d4bd98cc` |

`mongodump` used temporary private config files for credentials, never password
arguments. The MongoDB 7 archive restored all 503 documents into an isolated
MongoDB 7 instance with zero failures. Every original collection count and ordered
raw BSON digest matched a live source inventory. All 123 file/GridFS metadata
entries were readable with correct sizes; all 111 distinct attachment paths
resolved. The native archive restored 367 documents into isolated MongoDB 8 with
zero failures. Never restore the MongoDB 8 archive into MongoDB 7.

The source MongoDB 7 service is standalone. Verification proves the inspected
snapshot, not future production writes. Final cutover needs a posting freeze,
fresh dump/media copy, and digest verification. Do not use an inconsistent live
copy as the final rollback snapshot.

## Compatibility and staging

- Source schema 16: four boards, 21 threads, 111 replies, two accounts.
- IDs repeat across boards; all lookup/counter/URL logic preserves board scope.
- Root PBKDF2V2 authentication succeeded against the restored copy, including an
  actual browser login. Its password and source record were unchanged.
- The other account's missing password was found in the original native MongoDB
  backup. Its ID matches `_chikoMigration.oldId`; its exact scrypt hash is bridged
  through a sidecar, without a reset. The owner's personal password was not
  provided for a live login test; the owner should verify it in staging.
- 109 deletion hashes were recovered using original post ID mappings.
- Existing bans/reports were empty. Existing moderation history, all unknown
  BSON fields, permissions and settings remain preserved.
- An empty `chiko_staging_20261028` database was added on the existing beta MongoDB
  service without changing its other database. The importer verified all 503
  source BSON documents. Staging has separate credentials scoped to this database.
- Original cached frontend HTML remains backed up but is not served as UI.
  The replacement serves original disk/GridFS media without an old process.

## Tests and limits

Tests exercise posts/replies, multiple files/thumbnails, quoting, tripcodes,
search/catalog, CSRF/origin checks, challenge replay rejection, staff/board scopes,
locking/pinning, reports, bans and reversible deletion. Original fixture documents
are compared byte for byte after mutation tests. Reimport into a nonempty target
is rejected. No database/collection is dropped.

Actual-copy HTTP checks loaded all four boards, all 21 threads and 111 replies
with original IDs, fetched all 111 attachment paths, and checked all 21 earlier
native thread redirects. Desktop/mobile browser checks exercised theme switching,
root login and the dashboard with no script errors or mobile horizontal overflow.
Screenshots remain in the private backup directory.

## Production cutover — owner approval required

Do not merge, change production's GitHub source, switch domains, stop the working
application, apply production overlays, or enable production writes until the
staging deployment and PR are accepted.

1. Confirm staging, the original administrator login, and PR checks. Record the
   current gateway/backend deployment IDs, config, ports, variable references and
   volume IDs. Keep actual secret values only in private backup storage.
2. Freeze old posting and background writers for a consistent final dump. Retain
   its image/deployment and all volumes. Take and verify fresh MongoDB 7/media
   backups; compare every original document and file checksum.
3. Apply the reviewed credential bridge to ChikoChan sidecars. Copy disk media
   into the retained gateway volume at `/data/legacy-media`; compare checksums.
   Preserve its `/data/src`, `/data/posts.json`, backups and Caddy state, and the
   entire old media volume.
4. Merge the reviewed feature PR. Connect the existing gateway application to
   `chicomint/chiko_sitepage`, `main`, root `/imageboard`, Dockerfile builder,
   check suites enabled, readiness `/readyz`, and its retained persistent volume.
5. Configure the explicit existing MongoDB 7 database with a scoped principal,
   compatible-format variables and HTTPS origin. Do not accidentally use the
   original native MongoDB 8 URL. Initially keep writes disabled.
6. Verify readiness, all data/media/authentication, then change the production
   domain target to 3000. After read-only live checks, enable writes with the
   approval gate and verify designated new post/reply/upload/moderation actions.
   Keep the old process stopped so its schedulers cannot prune shared records.
7. Monitor and retain all databases, volumes, backups and rollback images until
   accepted stable. Only then clean up obsolete application code/configuration.
   Database services and persistent volumes are never cleanup targets.

## Rollback boundary

Restore tests create isolated databases, never overwrite production. Before
cutover, rollback is leaving the current gateway, backend and ports in place.
Before new writes, restore the recorded gateway config/deployment and port 8090;
restart the retained old backend if necessary and verify thread/media URLs.

After new ChikoChan writes, do not blindly reactivate the old backend: it cannot
read ChikoChan counters, tombstones, moderation overlays or the new media path.
Freeze writes, take another backup, reconcile those additions in an isolated
copy, test it, then route traffic. Never overwrite newer content with an earlier
snapshot or remove sidecars to simulate rollback. This is an acceptance boundary.
