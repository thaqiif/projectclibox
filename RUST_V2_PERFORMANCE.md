# ProjectCliBox v2 performance report

## Measurement contract

Measured on 2026-09-12 from the `rewrite/rust-projectclibox-v2` worktree on
Linux x86_64, 4 CPUs, 7.7 GiB visible memory, Rust 1.89.0, Node 22.23.2, and
an optimized Rust binary. HTTP and WebSocket probes used loopback. The session
matrix used 5 samples per point and 262,144 output bytes per WebSocket. The
file probe used 3 samples, a page size of 200, and isolated 100/10,000/100,000
file fixtures. These are local measurements, not a production capacity
guarantee. The process snapshots include the Rust server and its direct PTY
children, not unrelated processes in the development container.

## Authoritative terminal snapshot measurements

Measured on 2026-09-12 from a freshly started optimized server after the
terminal-state change and delta cap. The dedicated
`node benchmarks/rust-v2-snapshot.mjs --base-url http://127.0.0.1:3216 --counts 1,10,25,50 --samples 5 --app-pid <server-pid>` probe
opens concurrent fresh attachments, waits for `terminal.snapshot` and the
version `2` binary frame, and records the p50/p95 end-to-end snapshot latency.
RSS is sampled at each live-session count after the snapshot samples; it
includes the Rust service and direct PTY children. Snapshot payloads were
2,552 bytes for these idle shells.

| Live sessions | Snapshot p50 / p95 | Batch p50 / p95 | RSS |
| ---: | ---: | ---: | ---: |
| 1 | 50.9 / 53.0 ms | 52.6 / 54.3 ms | 15.1 MiB |
| 10 | 52.0 / 75.3 ms | 60.0 / 80.6 ms | 69.2 MiB |
| 25 | 68.8 / 92.2 ms | 77.0 / 108.0 ms | 160.6 MiB |
| 50 | 60.0 / 69.5 ms | 66.7 / 73.8 ms | 312.6 MiB |

These are idle-shell snapshots, not a claim about a full 4 MiB resolved
history. The terminal emulator bounds resolved history by configured cell
rows, while raw reconnect deltas are independently bounded by
`min(PCLX_SCROLLBACK_BYTES, 256 KiB)`; a missing delta range is handled by
snapshot resynchronization, never by replaying terminal history.

## Replacement measurements

| Operation | p50 | p95 |
| --- | ---: | ---: |
| Binary start → `/healthz` (5 cold launches) | 14.7 ms | 44.0 ms |
| Incremental terminal creation at 50 live sessions | 6.9 ms | 9.2 ms |
| `GET /api/terminals`, 50 live, one request at a time | 2.5 ms | 5.3 ms |
| `GET /api/terminals`, 50 live, 50 concurrent requests | 15.8 ms | 24.9 ms |
| WebSocket usable marker, 1 concurrent viewer | 8.9 ms | 8.9 ms |
| WebSocket usable marker, 50 concurrent viewers | 191.2 ms | 204.4 ms |
| 262 KiB output, 50 concurrent viewers | 327.3 ms | 441.5 ms |
| First page, 100 files | 6.9 ms | 7.1 ms |
| First page, 10,000 files (201 entries scanned) | 14.1 ms | 17.4 ms |
| First page, 100,000 files (201 entries scanned) | 7.6 ms | 8.6 ms |

The terminal-list result is the important control-plane improvement: the
supervisor returns in-memory records, metrics sampling is shared/cached for a
short burst, and no tmux enumeration or per-row SQLite reconciliation occurs.
The file result is intentionally a first-page measurement; later pages use a
numeric cursor and scan forward from that offset.

### Session count and list concurrency

Values are request latency p50/p95 in milliseconds. RSS is the idle process
tree snapshot taken at that live-session count.

| Live sessions | `GET /api/terminals` c=1 | c=50 | RSS |
| ---: | ---: | ---: | ---: |
| 0 | 3.0 / 36.6 | 21.1 / 51.4 | 6.0 MiB |
| 1 | 0.9 / 2.0 | 12.4 / 17.0 | 15.9 MiB |
| 5 | 1.8 / 2.0 | 11.7 / 16.0 | 32.0 MiB |
| 10 | 2.3 / 5.5 | 13.3 / 28.2 | 51.7 MiB |
| 25 | 2.0 / 3.7 | 18.0 / 43.1 | 111.5 MiB |
| 50 | 2.5 / 5.3 | 15.8 / 24.9 | 210.9 MiB |

At 50 sessions the snapshot contained 51 processes (server plus one direct
shell per PTY); the server tree had 204 threads because the current portable
PTY adapter uses reader, writer, and waiter workers per session.

### WebSocket fan-out

| Concurrent viewers | Usable p50/p95 | 262 KiB output p50/p95 |
| ---: | ---: | ---: |
| 1 | 8.9 / 8.9 ms | 4.8 / 4.8 ms |
| 5 | 4.9 / 7.1 ms | 83.8 / 94.9 ms |
| 10 | 34.7 / 59.6 ms | 73.1 / 122.0 ms |
| 25 | 49.8 / 63.8 ms | 171.7 / 205.8 ms |
| 50 | 191.2 / 204.4 ms | 327.3 / 441.5 ms |

The 50-viewer point is the current bottleneck. It is still a direct shared
session path with no intermediary shell or tmux client, but scheduling 150 PTY
workers and fanning output to 50 sockets is visible on this four-core host.
The 50-session process tree was about 210.9 MiB idle and 250.6 MiB while the
50-viewer output point was active.

## Comparison with the audit baseline

The parent branch measured 604.2ms p50 / 976.7ms p95 for 50 concurrent
`GET /api/terminals` requests with 50 live tmux sessions. The v2 result is
15.8ms / 24.9ms in the same shape of control-plane probe, a roughly 97% lower
latency in this local run.

The baseline browser-style tmux attach measured about 348ms p50 / 515ms p95 at
50 clients, including its settling interval. The v2 usable marker measured
191.2ms / 204.4ms at 50 direct viewers. These paths are not identical: v2
does not pay the intermediary PTY, shell, tmux client, or attach settling
interval, while the current host's worker scheduling remains measurable.

The baseline full synchronous 10,000-file list measured 104.1ms / 138.8ms.
The v2 first page measured 14.1ms / 17.4ms because it returns a bounded page
after scanning 201 entries; it does not claim that a full 10,000-entry sort has
the same latency. A caller that walks every page will pay that work over many
bounded requests rather than blocking one request on a global sort.

Baseline 50-direct-PTY RSS was about 494 MiB and the 50-client tmux path about
828 MiB. The v2 snapshots were 210.9 MiB idle and 250.6 MiB with 50 viewers
and output, respectively. RSS comparisons are directional because the
process topologies and probes differ.

## Target status

- Binary startup `<250ms`: met in this run.
- Direct terminal creation `<10ms p50 / <20ms p95`: met at 50 sessions.
- Cached 50-way terminal listing `<20ms p50 / <100ms p95`: met in this run.
- First paginated file page `<100ms`: met for the 100,000-entry fixture.
- 50-client usable attach `<50ms p50 / <100ms p95`: not yet met; the observed
  191/204ms point is the next optimization target.
- Comfortable 32-agent operation: not certified. The harness does not yet
  run long-lived mixed agent CPU/IO workloads or enforce resource quotas.

## Remaining bottlenecks and risks

1. PTY worker density and 50-viewer scheduling dominate the high-concurrency
   WebSocket point. A future adapter can reduce per-session threads with an
   async-capable PTY implementation, smaller worker stacks, or a dedicated
   I/O reactor while preserving the same supervisor protocol.
2. Output throughput is bounded by per-viewer socket writes and xterm/browser
   rendering. The protocol has bounded broadcast delivery and replay gaps, but
   it does not yet expose configurable per-viewer byte quotas or coalescing
   policies.
3. The current shared token is service-level authentication, not multi-user
   identity/ownership. A trusted-proxy deployment should add an explicit
   identity adapter and project/session authorization before being exposed to
   multiple users.
4. The supervisor is in-process. Browser detach/reconnect is durable while
   the Rust process lives, but a server/container restart terminates live PTYs;
   the current `sessiond` command is an explicit compatibility alias rather
   than a cross-process IPC daemon.
5. A process that deliberately daemonizes with `setsid` can escape the
   recorded process group. The supported cleanup guarantee covers the child
   and descendants that remain in that group; stronger containment needs a
   Linux cgroup/sandbox boundary.
6. Docker image size, container cold start, Chromium LCP/INP, xterm paint,
   browser heap, and long-running memory/CPU curves were not measured here.
   Docker and a browser executable are unavailable in this workspace, so the
   report does not substitute server timings for those measurements.
