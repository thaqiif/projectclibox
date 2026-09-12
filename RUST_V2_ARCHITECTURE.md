# ProjectCliBox v2 architecture

## Shape

```text
browser / xterm.js
        │ HTTP JSON + versioned WebSocket
        ▼
Rust axum control plane
  ├─ auth, same-origin mutation checks, body/concurrency limits
  ├─ projects, sessions, settings, files, metrics APIs
  └─ static Vite SPA
        │
        ├─ SessionSupervisor (in-memory live handles)
        │    ├─ direct portable-pty master
        │    ├─ bounded scrollback + broadcast fan-out
        │    ├─ reader / bounded writer / wait-and-reap workers
        │    └─ process-group termination and resize
        │
        └─ SQLite actor (one rusqlite connection owner)
             ├─ WAL + busy timeout + foreign keys
             ├─ migrations
             └─ projects, sessions, settings + indexes
```

The design deliberately separates durable metadata from live process state.
SQLite is not used as a PTY transport, and a WebSocket is not the owner of a
session. This makes browser detachment cheap and makes the ownership rule
auditable.

## Session lifecycle

1. `POST /api/terminals` validates the project root and dimensions, opens a
   PTY, starts the requested shell/command, records the child PID and process
   group, and persists the initial session record.
2. A WebSocket sends `terminal.attach` with a session ID and optional sequence.
   The supervisor subscribes before taking the replay snapshot so output that
   races with reconnect is either in replay or in the live receiver.
3. Output is copied into a bounded byte ring and a bounded broadcast channel.
   The API sends replay first, then binary output frames. A lagged viewer gets
   a replay attempt or a structured `terminal.gap` message requiring resync.
4. Input is accepted into a bounded queue and written by a dedicated blocking
   PTY writer. The async WebSocket task never performs a blocking write.
5. The child waiter calls `wait`, records exit code/signal and end time, closes
   input, publishes a final state, and persists the record. Termination first
   signals the child and process group, then escalates after the grace period.
6. Detach decrements the viewer count and marks a still-live session
   `Disconnected` when its last viewer leaves. It does not alter the PTY or
   child; the next attach returns it to the active state.

## Protocol

Client control messages are JSON objects with a `type` field:

```json
{"type":"terminal.attach","sessionId":"…","fromSequence":1024}
{"type":"terminal.input","data":"ls\n"}
{"type":"terminal.resize","cols":120,"rows":36}
{"type":"terminal.detach"}
{"type":"terminal.ping","nonce":"n-1"}
```

Server control messages include `terminal.ready`, `terminal.state`,
`terminal.exit`, `terminal.gap`, `terminal.pong`, and `terminal.error`.
Output is a binary frame: protocol version `1`, big-endian `u64` sequence,
then raw PTY bytes. Sequences are monotonically increasing output-byte
offsets, which lets reconnects request a precise bounded suffix.

## Storage and concurrency

`Database` sends typed commands to one dedicated thread that owns the SQLite
connection. This avoids sharing a rusqlite connection across async tasks and
keeps migration/statement ownership explicit. The schema is versioned through
`schema_migrations`; session queries are indexed by project, status, and last
activity.

Live handles are held in the supervisor's `RwLock<HashMap<SessionId,
SessionHandle>>`. Session metadata is mirrored to SQLite on creation, state
changes, rename, exit, and deletion. High-volume PTY output updates in-memory
activity and byte counters and is persisted when the state changes or exits,
instead of issuing one SQLite write per read chunk.

## Files and security

`WorkspacePolicy` canonicalizes the global workspace root and each project
root. Existing reads require the target to canonicalize beneath both roots;
writes canonicalize the parent and reject symlinked escape paths. The browser
surface uses relative paths, pagination cursors, a 200,000-entry scan cap, a
configurable page limit, and a configurable file byte limit (default 2 MiB,
maximum 64 MiB). Writes are atomic within the authorized parent directory.

HTTP/WebSocket requests have a 96 MiB body cap, a 256-request in-flight bound,
a 128-connection WebSocket bound, and a ten-second attach timeout. Tokenless
non-loopback binds require the explicit trusted-proxy opt-in
`PCLX_ALLOW_UNAUTHENTICATED_NON_LOOPBACK=true`; otherwise a shared token is
required. Static bootstrap files and health are intentionally public so a
browser can load the login prompt; the same-origin `POST /api/auth` exchanges
the token for an HttpOnly cookie when token auth is configured. The
authorization layer then covers APIs and WebSocket upgrades, and mutating
requests enforce same-origin when an `Origin` header is present. On Linux,
process-group escalation snapshots PID start-times and signals matching
process identities, avoiding a delayed blind kill against a reused PGID.

## Metrics

Linux metrics inspect `/proc` for processes in the recorded group, resident
memory, and CPU ticks; the service also reports host memory and CPU count.
The first CPU sample is intentionally empty because a percentage needs a
delta. The monitor reuses the same terminal/session IDs and polls snapshots;
it does not create an intermediary PTY or a second backend session.

## Restart boundary

This v2 branch runs the supervisor in the server process. Clean shutdown
terminates managed process groups, and startup converts any persisted live
state left by an unclean stop into exited metadata. SQLite/projects/settings
survive. Live PTYs do not. The database health probe also exercises a
rollback-only write transaction; after three persistent watchdog failures the
server exits so an external supervisor such as Compose can replace the
instance. A future split `sessiond` can move the supervisor
behind a local IPC boundary without changing the browser protocol; the current
`sessiond` command remains an explicit compatibility alias, not a claim of
cross-process PTY recovery.
