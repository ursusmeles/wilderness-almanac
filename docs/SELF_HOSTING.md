# Self-hosted accounts and campaign copies

Wilderness Almanac can run entirely in the browser or use an optional self-hosted API.

IndexedDB remains the local working store. Account transfers are explicit through
**Account & sync** in the campaign library; editing, Undo, offline work and JSON
export/import keep their existing behavior. Signing out keeps local campaigns.
Custom palette libraries are device-local; a campaign's own palette travels with
its replay record. Billing is not implemented.

## Deployment layout

The included deployment uses Cloudflare Pages, a Docker host and an S3-compatible
backup bucket.

- Cloudflare Pages serves Vite's `dist/` and the Pages Function in `functions/api/`.
- The Function forwards `/api/*` over HTTPS to the API hostname. Cookies stay on
  the frontend origin, including with a `pages.dev` URL.
- Compose publishes the API on host loopback `127.0.0.1:8086`. A Cloudflare Tunnel
  or HTTPS reverse proxy on that host can expose it to the Pages Function.
- Only the API and backup service mount `wilderness_almanac_data`, a Docker `local` volume.
  Use local disk, not NFS/SMB or a filesystem mounted from object storage.
- Better Auth handles email OTP and cookie sessions. Resend sends the codes.
  No session token is stored in IndexedDB or localStorage.

The API rejects production requests without HTTPS forwarding and the shared
edge-proxy secret. The Function overwrites its forwarding/proxy headers and
supplies Cloudflare's client IP for persistent authentication rate limits.
Every campaign request additionally requires a valid Better Auth session.
The proxy key is an origin protection layer, not a replacement for user sessions.

## Server setup

For an existing deployment, keep `DATABASE_VOLUME`, `DATABASE_PATH` and backup
prefix pointed at their current data. Changing a frontend origin requires moving
browser campaigns through JSON exports/imports. Deploy frontend and API together:
both use the same campaign validator and now accept generator **10** only. Older
account documents are not automatically converted or deleted.

Clone the repository on your Docker host and run Compose from its root.
Copy `.env.example` to `.env`, set its permissions to mode 600, and configure:

| Variable                                     | Purpose                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `APP_ORIGIN`                                 | One canonical HTTPS Cloudflare frontend origin, without a path               |
| `BETTER_AUTH_SECRET`                         | Persistent random secret, at least 32 characters                             |
| `API_PROXY_SECRET`                           | Separate random secret shared only with Pages runtime                        |
| `RESEND_API_KEY`                             | Sending key for the verified Resend domain                                   |
| `RESEND_FROM`                                | Verified sender, e.g. `Wilderness Almanac <login@your-domain>`               |
| `S3_ENDPOINT`                                | HTTPS endpoint of a private off-server S3-compatible bucket                  |
| `BACKUP_BUCKET`                              | Backup bucket name                                                           |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Bucket-scoped object read/write credentials                                  |
| `AWS_REGION`                                 | `auto` for R2; the provider's region for other S3 endpoints                  |
| `BACKUP_PREFIX`                              | Object-key prefix, default `wilderness-almanac`                              |
| `BACKUP_INTERVAL_HOURS`                      | Backup interval, 1–24 hours; default 6                                       |
| `DATABASE_VOLUME`                            | Active local database volume; default `wilderness_almanac_data`              |
| `DATABASE_PATH`                              | SQLite filename inside the volume; default `/data/wilderness-almanac.sqlite` |

Generate secrets locally with `openssl rand -hex 32`. Keep a secure copy of the
environment file outside the server, separately from database backups. Never
prefix a secret with `VITE_`, check it into Git or include it in a frontend build.
The API container receives only its auth/mail settings; bucket credentials are
limited to the backup container. Production Compose fails if required settings
are missing.

```sh
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 420
docker compose ps
docker compose logs --tail 50 api backup
```

The first run creates the volume with the non-root container user's permissions,
sets SQLite pragmas and applies checked-in SQL migrations before accepting traffic.
The backup service uploads immediately, then every six hours by default. It
becomes healthy only after a successful downloaded restore check. Allow time
for its first health check when using Compose `--wait`.

Both containers restart unless explicitly stopped. Keep Docker's data directory
on the local disk. Use `docker compose stop` for an intentional shutdown; keep the
named volumes. `docker compose down` preserves them, while `down -v` deletes data.

## Cloudflare frontend and HTTPS

1. Create a Pages project from this repository. Use build command `npm run build`,
   output directory `dist`, and Node 24 or later. Set build variable
   `VITE_API_ENABLED=true`.
2. Set Pages runtime variables `API_ORIGIN=https://api.example.com` and
   `API_PROXY_SECRET` to the same value configured on the API server. Keep the latter
   secret in Cloudflare. `API_ORIGIN` must be an HTTPS origin without a path.
3. Configure a Cloudflare Tunnel or HTTPS reverse proxy for your API hostname.
   When it runs on the Docker host, use `http://127.0.0.1:8086` as its upstream.
   In a container, loopback refers to that container; use host networking on Linux
   or configure a shared network and upstream explicitly. Keep the API port private.
4. Make `APP_ORIGIN` match the canonical frontend URL exactly and redeploy after
   configuring variables. Other preview/custom domains are not trusted by default.
5. Require HTTPS at Cloudflare's edge. Keep `/api/*` uncached, including custom
   cache rules. `public/_routes.json` invokes the Function only for API requests;
   static frontend assets remain on Pages.

For a direct upload, run `VITE_API_ENABLED=true npm run build` and then
`npx wrangler pages deploy dist --project-name YOUR_PROJECT` from the repository
root so the sibling `functions/` directory is included. Configure project runtime
variables before testing sign-in. The standalone Vite preview server does not run
Pages Functions; use Pages/its local emulator to test the production proxy.

After deployment, sign in with a real email, save a campaign, load it in another
browser and check the backup health. A successful OTP request must correspond to
an actual Resend delivery; tests use an injected in-memory delivery function and
never send real email. Provider credentials, DNS and Cloudflare account access
are needed to complete these live checks.

## Local development and focused checks

The browser-only app still works with `npm ci && npm run dev` and no API keys.
For account development, install `npm ci --prefix server`, provide a local
`BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, and
`APP_ORIGIN=http://localhost:5173`, then run `npm start --prefix server`.
Enable `VITE_API_ENABLED=true` for Vite. Its `/api` proxy points to port 3000.
Use this development mode only on your own computer. Production requires the
HTTPS proxy and proxy secret.

```sh
node --test --test-isolation=none server/tests/*.test.js tests/campaign-sync.test.js tests/campaigns.test.js
npx playwright test --config=playwright.account.config.js
```

The backend tests run the real auth library and SQLite driver. They exercise OTP
hashing/reuse/revocation/rate limiting, ownership, conditional saves, pragmas,
migration rollback/checksums, online backups with live WAL writes, downloaded
snapshot restoration and corrupt-copy rejection. Test object storage is an
in-memory transport; verify a real provider round trip before relying on backups.

## Persistence and API contract

Every connection factory sets `foreign_keys=ON`, `busy_timeout=5000`, and
`synchronous=FULL`. Live database connections use WAL. Read-only snapshot/restore
inputs retain their own journal format; restored live files are configured as WAL.
Only one API process is needed. Requests validate input before a short synchronous
transaction; network/email/object-storage calls never run inside a transaction.
`SQLITE_BUSY` returns 503 and a retry hint.

`server/migrations/NNN-name.sql` files apply once in order, in individual immediate
transactions. A separate ledger stores each checksum and applied version. Startup
rejects changed applied SQL and newer schemas. Auth schema SQL was generated for
the pinned Better Auth version; dependency updates that change schema require a
new migration, not edits to an existing file. Back up before upgrading. Roll back
application code only when its supported schema still matches, or restore the
pre-upgrade database into a new volume.

| Endpoint                                               | Behavior                                              |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `POST /api/auth/email-otp/send-verification-otp`       | Send a sign-in code through Resend                    |
| `POST /api/auth/sign-in/email-otp`                     | Establish an HttpOnly cookie session                  |
| `GET /api/auth/get-session`, `POST /api/auth/sign-out` | Read/revoke the session                               |
| `GET /api/campaigns`                                   | List only the authenticated owner's current campaigns |
| `GET /api/campaigns/:id`                               | Read the owner's campaign and revision                |
| `PUT /api/campaigns/:id`                               | Validate `{campaign}` and conditionally create/update |
| `DELETE /api/campaigns/:id`                            | Conditionally delete the account document             |
| `GET /api/campaigns/:id/export`                        | Download a validated campaign replay export           |

Campaign mutation requests require JSON, the trusted app Origin and `If-Match: "N"`.
New documents require revision `"0"`. Missing revisions return 428; mismatches
return 409. Ownership is part of every SQL predicate and composite primary key,
never accepted from client JSON. Deletion retains an incremented tombstone so a
stale create cannot silently resurrect the document. The server accepts the same
bounded replay data as browser validation, with a 16 MB campaign limit and up to
100 active account campaigns. Public `/healthz` reports only service status.

The browser records acknowledged server revisions and a SHA-256 campaign hash
in IndexedDB settings, separately for each account and campaign. Local revisions
remain independent. Loading may replace only an unchanged acknowledged local
copy or identical data, and still uses IndexedDB's transactional local revision
checks. Divergent local data stays intact; **Import as copy** gives the account
version a new identity. There is no force-save button or automatic deletion.
Local deletion and account-copy deletion are separate actions. JSON imports still
create separate local campaigns and export files contain no account/session data.

## Consistent off-server backups

The backup service opens the live database read-only, uses SQLite's online backup
API, and checks integrity and foreign keys. It uploads the resulting standalone
snapshot to the private bucket over HTTPS, downloads the exact object, verifies
its SHA-256 checksum, and restores it into an isolated database. Only matching
schema/user/campaign counts and a clean restore advance `last-success.json`.
Temporary snapshots are removed on completion; the source database is never
copied with `cp` and its WAL is never discarded to make a backup.

Bucket credentials need object read/write within the backup prefix; no public
access or object-delete permission is needed. Configure the provider's lifecycle
policy for your desired retention (for example 30 days), protect the bucket from
public access, and monitor backup-container health/logs. Health becomes unhealthy
when there is no verified success or the last success is more than two intervals
old. Failed attempts retry after a minute and do not advance the success marker.
A server which is powered off cannot report health: add external monitoring for
the API and backup freshness before depending on unattended operation.

## Restore procedure

Restore into a new local volume, retaining the old volume for recovery. Do not
restore on top of an open database or manually mix a restored file with old WAL
sidecars. The helper refuses existing target files/sidecars and revokes restored
sessions and OTP records so credentials revoked after the snapshot cannot revive.

```sh
docker compose stop api backup
docker volume create wilderness_almanac_restore_YYYYMMDD
docker compose run --rm --no-deps \
  -v wilderness_almanac_restore_YYYYMMDD:/restore \
  backup node server/backup.js restore \
  'wilderness-almanac/EXACT_BACKUP_OBJECT_KEY.sqlite' /restore/wilderness-almanac.sqlite
```

The command downloads from the configured off-server bucket and reports verified
schema/user/campaign counts. Set `DATABASE_VOLUME=wilderness_almanac_restore_YYYYMMDD` in
`.env`, then run `docker compose up -d --wait --wait-timeout 420`. Sign in again,
open/export a known campaign, and confirm a new verified off-server backup. Keep
the old volume until those checks pass. To reverse the switch, stop both services,
restore the old `DATABASE_VOLUME` value and start again. The restore tests exercise
the same helper on a snapshot containing committed WAL data and prove that the
original live database stays unchanged.

Official references: [Better Auth email OTP](https://better-auth.com/docs/plugins/email-otp),
[SQLite pragmas](https://sqlite.org/pragma.html),
[SQLite online backups](https://sqlite.org/backup.html), and
[Resend setup](https://resend.com/docs/send-with-nodejs).
