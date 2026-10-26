# Operating CLIBox

## Upgrading from CLIWeb

CLIBox 1.0 is the renamed continuation of this project's CLIWeb builds. An
existing deployment upgrades in place:

1. Back up the database (see below; it is still at `~/.cliweb/cliweb.db`).
2. In `.env` (or your PaaS's environment), set `CLIBOX_HOME_DIR` to the host
   home you already use, e.g. `CLIBOX_HOME_DIR=/home/cliweb`. Without it,
   CLIBox starts with a fresh, empty home under `./data/home`.
3. Choose your hardware overlays in `COMPOSE_FILE` (or run `./install.sh`),
   since the base `compose.yml` no longer maps `/dev/kvm` or GPUs.
4. Deploy. On first boot the entrypoint moves `~/.cliweb/` to `~/.clibox/`
   and `cliweb.db` to `clibox.db` (profiles too: `~/.cliweb-test/` becomes
   `~/.clibox-test/`).

Everything else carries over: `CLIWEB_*` variables are still read when the
`CLIBOX_*` name is unset, `/home/cliweb` inside the container links to the
new home so absolute paths in npm or git config keep working, and the
browser moves its saved sidebar and recent-folder settings to their new keys.

## Persistence

The host directory `CLIBOX_HOME_DIR` (default `./data/home`) is bind-mounted
as `/home/clibox` in the container. It stores the SQLite database, shell configuration, Git
identity/credentials, npm global packages, pip user packages, Homebrew, and
other user-local tools. These survive container restarts, redeployments, and
image rebuilds as long as `CLIBOX_HOME_DIR` is backed by persistent host storage.

`npm -g` is configured to install under `/home/clibox/.local`, so it works as a
non-root user and persists. Use `pip install --user ...` for Python packages.
System-level `apt` installs are intentionally unavailable to the non-root
terminal and are not part of the persistence contract; add them to the
Dockerfile if a project truly needs them.

Project files live in the host bind mount configured by `WORKSPACE_DIR`, so they
remain available independently of the container lifecycle.

The terminal registry survives restarts, but running processes do not: Docker
stopping a container stops its tmux server. Stopped terminals reappear in the
sidebar and can be reopened in their previous folder.

## Configuration

See [.env.example](../.env.example) for the small set of supported settings:

- `CLIBOX_HOME_DIR` — host folder persisted as the container's home.
- `COMPOSE_FILE` — the base file plus any [hardware overlays](hardware.md).
- `CLIBOX_VERSION` — image tag to run (default `latest`); pin it, e.g. `1.0.0`,
  to upgrade on your own schedule.
- `WORKSPACE_DIR` — host folder mounted as `/workspaces`.
- `HOST_PORT` / `HOST_BIND` — web UI port and bind address.
- `PUID` / `PGID` — host ownership for `CLIBOX_HOME_DIR` and workspace files.
- `CLIBOX_PROFILE` — optional data-namespace suffix. Set it to a different
  value per deployment (for example `test`) when two deployments share the
  persisted home mount: all state (database, trash) goes under
  `~/.clibox-<profile>/` instead of `~/.clibox/`, so they coexist without
  sharing data. Explicit `DB_PATH` still takes precedence if you need full
  manual control.
  Two deployments sharing the persisted home mount MUST also set identical
  `PUID`/`PGID`: container startup marks the home with its ownership and
  refuses to start with different ids (a mismatched restart would chown the
  shared tree and steal ownership from the other, running, deployment).
- Any additional variables in `.env` are passed through to terminal shells,
  which is useful for API keys or project-specific configuration.

`docker compose down -v` does not remove the persistent host bind mounts
(`CLIBOX_HOME_DIR`, the workspace, or nanobrew); this Compose file
has no named volumes. Stop the stack and remove the relevant host directories
manually only when you intentionally want to discard saved state.

## Test deployment

`compose.test.yml` runs a second, fully isolated copy alongside
production (handy when the production app and a test app are deployed from
the same repo, e.g. two Coolify applications). Differences from production:

- Persisted home: `TEST_CLIBOX_HOME_DIR` on the host (default
  `./data/home-test`), so settings, database, trash, and installed tools are
  completely separate from production.
- Workspaces: `./workspaces-test` (override with `TEST_WORKSPACE_DIR`), so
  project folders are separate too.
- Host port: `3012` (override with `TEST_HOST_PORT`, bind with
  `TEST_HOST_BIND`); production stays on `3011`. The `TEST_` prefix means a
  `.env` that sets `HOST_PORT=3011` for production cannot make the test
  stack collide with it.
- `CLIBOX_PROFILE=test`, so app state lives under `~/.clibox-test/` inside
  its own home (redundant with the separate home, but harmless).

No environment variables are required: test-specific defaults and `TEST_`
override names keep a shared production `.env` from redirecting these mounts
or ports. Point the second Coolify application at this compose file and deploy.
The startup ownership guard (`.deployment-owner`) is still satisfied even if
production and test use different PUID/PGID values: each deployment writes the
marker under its own host home and chowns only that home.

## Fresh database

The database uses one baseline migration in
`web/lib/db/migrations.ts`. It creates the final workspace schema directly
via `CREATE TABLE IF NOT EXISTS` plus `INSERT OR IGNORE`, so it is idempotent
and safe against databases created by earlier images: a volume that already
has the old (32b74ba-era) `projects` schema keeps its extra columns, which the
current `SELECT *` queries tolerate, and the data stays intact. This was
verified by replaying the current migrations against each historical production
schema/tracker combination (migration rows `{1}`, `{1,2}`, `{1,3}`, `{1,2,3}`,
and an empty `_migrations` table), in all cases with assertions for successful
queries and unchanged pre-existing row data.

## Deploying an update (develop -> master)

Pre-deploy checks and steps for merging develop into master and letting
Coolify rebuild production. Read end to end before deploying.

Coolify reads a single compose file and ignores the `hardware/` overlays, so
point the application's Docker Compose Location at `/compose.coolify.yml`. It
passes through KVM, the host's `card0`/`renderD128` GPU and `/dev/kfd`, and mounts `/home/cliweb` as the
home unless `CLIBOX_HOME_DIR` is set. Remove any device the host lacks.

### 1. Back up first (rollback anchor)

```sh
# On the Docker host, before deploying. SQLite's online backup includes data
# that may still be in the live database's WAL file. $CLIBOX_HOME_DIR is the
# host home from .env.
sqlite3 "$CLIBOX_HOME_DIR/.clibox/clibox.db" \
  ".backup '$CLIBOX_HOME_DIR/.clibox/clibox.db.bak'"
sqlite3 "$CLIBOX_HOME_DIR/.clibox/clibox.db.bak" "PRAGMA integrity_check"
```

Rollback procedure: revert the Coolify application to the previous deploy
(the previous image is kept), or redeploy the pre-merge master revision. The
current migration is schema-compatible with the old image, so an image-only
rollback can keep the live database. To restore the exact pre-deploy data,
stop the application first, replace `clibox.db` with `clibox.db.bak`, remove
stale `clibox.db-wal` and `clibox.db-shm` files, then start the old image.

### 2. Data and layout compatibility (verified)

- Default DB path: new code resolves `HOME/.clibox/clibox.db`; with prod
  `HOME=/home/clibox` this is exactly `/home/clibox/.clibox/clibox.db` — the
  same file prod already uses. `DB_PATH` also remains explicitly supported
  if it is set anywhere.
- First boot with the existing prod DB does not rewrite it: the baseline
  migration is skipped (already applied) and all queries are verified against
  the old schema (see "Fresh database" above).
- No destructive `ALTER` / `NOT NULL DEFAULT` hazards exist in the current
  migration set.

### 3. Environment contract (no action needed)

- `DB_PATH` was removed from the image's Dockerfile `ENV`, but the default
  matches the old setting byte-for-byte, and an explicitly set `DB_PATH`
  still wins over the default.
- `CLIBOX_PROFILE` is optional; production sets nothing and keeps the
  `~/.clibox/` paths unchanged.
- The `.deployment-owner` ownership guard resolves against the production
  home (`/home/clibox/.clibox/.deployment-owner`) and simply re-records
  prod's `PUID:PGID` on first boot. The test deployment lives under
  `/home/clibox-test` (see "Test deployment"), so it can never write a
  conflicting marker into prod's home.

### 4. HTTP same-origin guard behind the proxy

New API routes enforce an Origin-vs-Host check on mutating requests. Browsers
always send `Origin` on POST, and it usually matches the proxied `Host`, so
same-origin UI traffic passes. Two residual risks and their handling:

- Proxies that rewrite `Host` (Coolify generally forwards it, but other
  front-ends or TLS terminators may not): the guard now also honors the
  `X-Forwarded-Host` header the proxy should send as a fallback comparison.
  If a request is still rejected with `403 "Origin does not match Host"`,
  first check that the proxy sends `X-Forwarded-Host` with the public domain;
  if the proxy strips both `Host` and `X-Forwarded-Host`, add proxy
  forwarding (e.g. proxy_set_header Host $host plus X-Forwarded-Host in the
  reverse proxy config) or temporarily roll back by pinning the previous
  image.
- The fallback assumes the trusted edge overwrites inbound forwarding
  headers. A raw HTTP client can make `Origin` and `X-Forwarded-Host` agree,
  but it has no browser-managed ambient credentials and therefore cannot use
  that fact for CSRF. Browser cross-origin requests cannot add this non-
  safelisted header without a successful CORS preflight. Do not expose the
  origin server directly to browsers around that trusted edge.
- Absence of `Origin` passes (curl/CLI clients unaffected).

### 5. Post-deploy smoke test

After Coolify redeploys, verify before declaring success:

- Container starts; logs show no `This persisted home is owned by ...` guard
  error and no migration traceback.
- `GET /api/projects` and the UI load; create a terminal (POST path through
  the origin guard, proving the proxy/host contract works).
- `sqlite3 "$CLIBOX_HOME_DIR/.clibox/clibox.db" "SELECT count(*) FROM projects"`
  unchanged.

If item 4 fails with 403s or item 2 shows an unexpected migration error,
rollback per section 1 and investigate; the image-to-image rollback is safe
because the migration set is forward-only and skipped when already applied.
