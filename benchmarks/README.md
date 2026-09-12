# ProjectCliBox v2 benchmark harness

The v2 harness measures the replacement Rust control plane against an already
running release server. It creates and cleans up only its own sessions.

## Start a local release server

```bash
tmp=$(mktemp -d /tmp/projectclibox-v2-benchmark.XXXXXX)
mkdir -p "$tmp/home" "$tmp/workspace"
PCLX_BIND=127.0.0.1 \
PCLX_PORT=3111 \
DB_PATH="$tmp/home/projectclibox.db" \
PCLX_WORKSPACE_ROOT="$tmp/workspace" \
PCLX_STATIC_DIR="$PWD/frontend/dist" \
HOME="$tmp/home" \
  target/release/projectclibox server
```

In another shell:

```bash
npm install
node benchmarks/rust-v2.mjs \
  --base-url http://127.0.0.1:3111 \
  --counts 0,1,5,10,25,50 \
  --concurrency 1,10,50 \
  --samples 10 \
  --ws-counts 1,5,10,25,50 \
  --output-bytes 262144 \
  --app-pid <server-pid>
```

The JSON report includes host/runtime metadata, per-count terminal-list
latency, creation latency, structured WebSocket attach/output timings, and a
process-tree snapshot. `--keep` leaves benchmark sessions for inspection.

Resolved snapshot capture is measured separately across the required 1/10/25/50
live-session points. It waits for the `terminal.snapshot` control message and
the version `2` binary frame, so the reported latency includes the server's
state clone/render and WebSocket delivery:

```bash
node benchmarks/rust-v2-snapshot.mjs \
  --base-url http://127.0.0.1:3111 \
  --counts 1,10,25,50 \
  --samples 5 \
  --app-pid <server-pid>
```

The acceptance probe is smaller and checks behavior rather than throughput:

```bash
node benchmarks/rust-v2-acceptance.mjs \
  --base-url http://127.0.0.1:3111
```

It verifies browser detach/reconnect replay, two viewers on one PTY, traversal
rejection, process-group cleanup, and concurrent/idempotent close-all deletion.
The browser probe deliberately reports
Chromium metrics as unavailable when no browser is installed; the same is true
of Docker image/startup metrics when no Docker daemon is available.

The async file listing probe creates isolated flat fixtures and measures the
first paginated response while reporting the full directory scan count:

```bash
node benchmarks/rust-v2-files.mjs \
  --base-url http://127.0.0.1:3111 \
  --root "$tmp/workspace" \
  --sizes 100,10000,100000 \
  --samples 5
```

Binary cold-start-to-health is measured separately, without a Node/tsx
wrapper:

```bash
node benchmarks/rust-v2-startup.mjs --runs 5 --port 3221
```

## Baseline comparison

`PERFORMANCE_AUDIT.md` records the measured parent-branch architecture:
Next/tsx, intermediary `node-pty`, managed tmux sessions, synchronous file
traversal, and live tmux enumeration. The implementation-bound parent probes
were retired with that runtime; the audit and `RUST_V2_PERFORMANCE.md` retain
the baseline and replacement evidence. Run the Rust harness for new numbers
and record the exact command, commit, host, sample count, and warm-up policy
with the report.
