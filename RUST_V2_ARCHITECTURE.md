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
        │    ├─ authoritative ANSI terminal state + bounded delta buffer
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

### Terminal emulator choice

The runtime uses the pinned `alacritty_terminal` 0.26 core with its public
`Term`, `Grid`, terminal modes, alternate-screen handling, and `vte` processor.
It was chosen because it provides a mature stateful ANSI/xterm emulator whose
resolved cells and bounded history can be captured directly; a parser-only
crate would still require ProjectCliBox to implement that state model itself.

## Session lifecycle

1. `POST /api/terminals` validates the project root and dimensions, opens a
   PTY, starts the requested shell/command, records the child PID and process
   group, and persists the initial session record.
2. The PTY reader parses every output read into one server-owned
   `alacritty_terminal::Term`, which resolves carriage returns, cursor
   movement, erase operations, SGR styles, scrollback, and alternate-screen
   state. The raw bytes are retained separately only in a bounded
   `OutputDeltaBuffer` (at most 256 KiB, or the configured limit when smaller)
   for short reconnect gaps.
3. A new WebSocket sends `terminal.attach` with `mode: "snapshot"`. The
   supervisor subscribes before taking a sequence boundary, clones the
   emulator state under the output gate, and sends a synthetic ANSI snapshot
   (binary frame version `2`). The snapshot contains resolved bounded
   scrollback and the current screen, not every historical redraw.
4. A reconnect on the same xterm sends `mode: "resume"` with the last applied
   sequence. If every missing delta remains in the bounded buffer, only those
   version `1` delta frames are sent. If the buffer no longer covers the gap,
   the server falls back to a current snapshot; a lagged live receiver sends
   `terminal.gap`, and the browser requests that snapshot explicitly.
5. Subscription happens before the snapshot/replay boundary. Output that
   races with capture is either represented by the captured sequence or stays
   queued in the receiver; the writer drops only frames at or below its
   boundary. This makes fresh attach and resume race-safe without duplicate
   redraws.
6. Input is accepted into a bounded queue and written by a dedicated blocking
   PTY writer. The async WebSocket task never performs a blocking write.
7. The child waiter calls `wait`, records exit code/signal and end time, closes
   input, publishes a final state, and persists the record. Termination first
   signals the child and process group, then escalates after the grace period.
8. Detach decrements the viewer count and marks a still-live session
   `Disconnected` when its last viewer leaves. It does not alter the PTY or
   child; the next attach returns it to the active state.

## Protocol

Client control messages are JSON objects with a `type` field:

```json
{"type":"terminal.attach","sessionId":"…","mode":"snapshot","cols":120,"rows":36}
{"type":"terminal.attach","sessionId":"…","mode":"resume","fromSequence":1024,"cols":120,"rows":36}
{"type":"terminal.input","data":"ls\n"}
{"type":"terminal.resize","cols":120,"rows":36}
{"type":"terminal.detach"}
{"type":"terminal.ping","nonce":"n-1"}
```

Server control messages include `terminal.ready`, `terminal.snapshot`,
`terminal.state`, `terminal.exit`, `terminal.gap`, `terminal.pong`, and
`terminal.error`. `terminal.ready.mode` reports whether the request is a
snapshot or delta resume. A snapshot control message precedes one snapshot
binary frame. Both binary frame versions use a big-endian `u64` sequence:

- version `1`: raw PTY output delta bytes, valid only after a resume boundary;
- version `2`: synthetic ANSI bytes reproducing the resolved terminal state.

The browser resets xterm before applying version `2`, then advances its
sequence to the snapshot sequence. A version `1` frame advances the sequence
only after its bytes are written. This keeps the client cursor tied to applied
state rather than to a control message.

Terminal geometry is session-wide. The first attached viewer owns resize until
it detaches; other viewers may interact with the PTY but their resize messages
are ignored. The owner is also allowed to provide its geometry in the attach
message, so the snapshot is captured at the negotiated PTY size.

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

Deletion is authoritative and idempotent for live handles and stale metadata:
the supervisor records a deletion tombstone, starts process-group termination,
removes the live and persisted metadata immediately, and lets cleanup finish in
the background. The watcher checks the tombstone while holding the lifecycle
gate, so an older PTY or a pre-redeployment record cannot reinsert the row
after a successful DELETE.

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
