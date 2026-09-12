# ProjectCliBox v2

ProjectCliBox is a self-hosted browser workbench for shell sessions, project
folders, lightweight file editing, and a multi-terminal monitor. The runtime
is Rust-native: the server owns PTYs directly, SQLite stores durable metadata,
and the React/Vite UI is served as static files.

## Run locally

Build and start the replacement runtime:

```bash
npm install --prefix frontend
npm run build:web
cargo run --release -- server
```

The default listener is `127.0.0.1:3011`, with no token required on loopback.
Use `--help` or the `PCLX_*` environment variables for limits and paths. A
non-loopback bind without a token refuses to start unless the explicit
trusted-proxy switch is enabled with
`PCLX_ALLOW_UNAUTHENTICATED_NON_LOOPBACK=true` or
`--allow-unauthenticated-non-loopback`.

## Run with Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3011>. `HOST_BIND` controls the host-side port binding;
the default is localhost-only even though the container listens on `0.0.0.0`.
Compose explicitly enables tokenless trusted-proxy mode so a Cloudflare Tunnel
can provide the external access boundary. If
`PROJECTCLIBOX_AUTH_TOKEN` is set, token auth remains enabled and the SPA
prompts for it once before exchanging it for an HttpOnly same-origin cookie
used by API and WebSocket requests.

Compose applies CPU, memory, PID, file-descriptor, and log-rotation limits.
The image healthcheck probes a write-capable SQLite transaction; the runtime
watchdog exits after three persistent database failures so
`restart: unless-stopped` can replace an unhealthy container rather than
leaving it serving a degraded control plane.

### Cloudflare Tunnel / edge-only deployment

This mode deliberately gives every admitted caller full terminal and workspace
access. It is safe only when the origin cannot be reached around the trusted
edge:

1. Use Cloudflare Tunnel with a Cloudflare Access policy (or an equivalent
   trusted-edge authentication policy) to publish the service. Point
   `cloudflared` at `http://127.0.0.1:3011` when using the default Compose
   binding.
2. Keep `HOST_BIND=127.0.0.1` whenever the tunnel runs on the Docker host.
   If another proxy or tunnel needs a non-loopback host binding, set
   `HOST_BIND=0.0.0.0` only with a host firewall/security-group rule that
   permits traffic from that trusted edge and denies direct public access.
3. Do not treat Cloudflare DNS proxying alone as origin protection. The origin
   listener and any alternate IPv4/IPv6 paths must be firewalled or private;
   otherwise callers can bypass Cloudflare and execute commands without an
   application token.

The explicit opt-in can be disabled in `.env` with
`PCLX_ALLOW_UNAUTHENTICATED_NON_LOOPBACK=false`; supply
`PROJECTCLIBOX_AUTH_TOKEN` instead if the service must enforce its own token.

### Optional KVM support

The base Compose file does not require `/dev/kvm`, so it also works on hosts
without hardware virtualization. On a Linux host with KVM available, opt in
with:

```bash
docker compose -f docker-compose.yml -f docker-compose.kvm.yml up -d --build
```

The override passes `/dev/kvm` through to the unprivileged terminal user for
QEMU/KVM guests, Android emulators, microVMs, and similar workloads.

The final image contains the Rust binary, static assets, and a useful shell
toolbox. Node/npm are build-stage tools only. tmux may be available as a user
command, but it is not involved in terminal supervision.

## Runtime model

Each terminal is a Rust supervisor record plus a direct PTY. The supervisor
owns the PTY master, reader/writer/waiter workers, child process group, bounded
output ring, and viewer count. Browser sockets are viewers, not process owners.

- Closing a browser tab or losing a WebSocket detaches only that viewer; a
  live session with no viewers is shown as `Disconnected`.
- Reconnecting with `fromSequence` replays bounded scrollback and then streams
  live output.
- Multiple viewers can attach to the same session.
- Stop sends termination to the child and its process group, waits briefly,
  then escalates to SIGKILL; the waiter always reaps the child.
- `Starting`, `Running`, `Idle`, `Disconnected`, `Terminating`, `Exited`, and
  `Failed` are explicit protocol and metadata states.

The WebSocket protocol is versioned. Control messages are JSON; output frames
are binary with a one-byte protocol version and an eight-byte sequence number.
Bounded broadcast delivery reports a replay gap instead of silently claiming
that output was delivered.

## Persistence and restart semantics

SQLite uses WAL, migrations, indexes, and one connection-owning database actor.
Projects, settings, terminal metadata, exit information, activity timestamps,
and output byte counters survive process restarts.

Live PTYs are intentionally in memory for this first v2 runtime. A browser
refresh, browser close, reconnect, or monitor view change does not interrupt a
session while the Rust process remains alive. On a server/container restart,
the supervisor terminates its managed process groups and marks previously live
records as exited on the next startup; the processes are not resurrected.
The `sessiond` subcommand is reserved for the future split-daemon deployment
and currently runs the same local supervisor/control-plane runtime. This
limitation is explicit so operators do not mistake metadata persistence for
process persistence.

## Workspace file policy

Projects are canonicalized beneath the configured workspace root. Relative
paths reject absolute paths, `..`, NUL bytes, missing parents, and symlink
escapes. Directory reads are asynchronous and paginated with scan and entry
limits. File reads/writes have byte limits; writes use a temporary file and
atomic rename. Binary uploads use the same limit through
`POST /api/files/upload` with standard base64 data.

## UI

The static SPA keeps the useful product surface: project/session rail, xterm,
file explorer/editor, monitor view that reuses the same session IDs, responsive
mobile layout, dark/light theme toggle, and installable PWA metadata. The
terminal stage uses a dark navy workbench with mint activity accents and a
compact status pulse so state remains legible without competing with output.

## Development and verification

```bash
npm run check
npm test
npm run build:web
npm run build:rust
```

The Dockerfile pins its toolchain and runtime images by digest and resolves
the final Debian packages from a dated snapshot. Refresh those pins and the
`DEBIAN_SNAPSHOT` build argument deliberately as part of image maintenance.

The end-to-end acceptance probe starts sessions, detaches and reconnects,
checks bounded replay and multiple viewers, rejects traversal, and verifies
process-group termination:

```bash
cargo build --release --workspace
node benchmarks/rust-v2-acceptance.mjs
```

The replacement benchmark reports session-list concurrency, terminal creation,
structured WebSocket throughput, process snapshots, and unavailable browser
or Docker measurements without substituting unrelated timings. See
[`RUST_V2_ARCHITECTURE.md`](RUST_V2_ARCHITECTURE.md),
[`RUST_V2_PERFORMANCE.md`](RUST_V2_PERFORMANCE.md), and
[`PERFORMANCE_AUDIT.md`](PERFORMANCE_AUDIT.md).

## Security boundary

This service can execute commands and read/write the mounted workspace. Keep
it on loopback or put it behind HTTPS, authentication, a restrictive firewall,
and a trusted proxy. Tokenless non-loopback mode is an explicit
`trusted-proxy/edge-only` deployment mode; the application does not validate
Cloudflare identity headers itself. The token, when configured, applies to HTTP
and WebSocket upgrade requests, and mutating browser requests validate their
same-origin header when one is supplied. The runtime does not expose the Docker
socket and does not auto-launch an installed AI coding CLI.

## Persistent locations

Docker mounts `/home/cliweb` for SQLite and user-local shell/tool state and
`WORKSPACE_DIR` at `/workspaces` for project files. Set `PUID` and `PGID` to
the host owners before creating files. Startup does not recursively `chown`
these trees, so large workspaces do not turn redeploys into a full filesystem
scan.
