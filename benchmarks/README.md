# ProjectCliBox benchmark harness

These scripts measure the current control plane without pretending that the
developer workload belongs to ProjectCliBox. Run the HTTP/WS benchmark against
an already-built production server and run the filesystem/SQLite benchmark as
an isolated fixture.

## Environment

The live benchmark must use a server started outside any existing tmux client.
For an isolated local run:

```bash
tmp=$(mktemp -d /tmp/projectclibox-benchmark.XXXXXX)
mkdir -p "$tmp/home" "$tmp/nanobrew" "$tmp/tmux" "$tmp/workspace"
env -u TURBOPACK -u TMUX -u TMUX_PANE \
  HOME="$tmp/home" DB_PATH="$tmp/home/cliweb.db" \
  CLIWEB_HOME="$tmp/home/.cliweb" \
  CLIWEB_NANOBREW_ROOT="$tmp/nanobrew" \
  TMUX_TMPDIR="$tmp/tmux" SHELL=/bin/bash USER=cliweb LOGNAME=cliweb \
  NODE_ENV=production PORT=3111 CLIWEB_PORT=3111 \
  PATH="/usr/local/bin:/usr/bin:/bin" \
  cliweb/node_modules/.bin/tsx cliweb/server.ts
```

The current server command uses `tsx`; this is intentional when measuring the
repository as shipped. A future compiled/bundled server should be measured
with the same scripts and a different `APP_PID`.

In another shell:

```bash
node benchmarks/current.mjs \
  --base-url http://127.0.0.1:3111 \
  --cwd "$tmp/workspace" \
  --counts 0,1,5,10,25,50 \
  --samples 30 \
  --ws-counts 1,5,10,25,50 \
  --output-bytes 1048576 \
  --app-pid <server-node-pid>
```

The benchmark creates and destroys its own tmux sessions. It does not attach
to sessions that existed before the server was started. `--keep` is useful
when inspecting a process tree manually; omit it for normal runs.

The fixture benchmark uses the actual synchronous implementation in
`cliweb/lib/files.ts` and the actual SQLite schema/queries:

```bash
node --import ./cliweb/node_modules/tsx/dist/loader.mjs benchmarks/files-db.mjs
```

Use `--large` to include the 100,000-file fixture. Fixture creation time is
reported separately from operation latency. Results are JSON so they can be
checked into an audit artifact without requiring a plotting tool.

The other probes cover the control plane, the browser's current tmux attach
path, cold startup, and the PTY primitive comparison:

```bash
node benchmarks/control-plane.mjs \
  --base-url http://127.0.0.1:3111 --cwd "$tmp/workspace" \
  --counts 0,10,50 --concurrency 1,10,50 --samples 10

node benchmarks/tmux-path.mjs \
  --base-url http://127.0.0.1:3111 --cwd "$tmp/workspace" \
  --counts 1,5,10,25,50 --output-bytes 262144

node benchmarks/startup.mjs --runs 5 --port 3121

node benchmarks/pty-node.mjs --count 50 --hold-ms 5000
go -C benchmarks/pty-go run . -count 50 -hold 5s
rustc benchmarks/pty-rust.rs -O -o /tmp/projectclibox-pty-rust
/tmp/projectclibox-pty-rust --count 50 --hold-ms 5000
```

`current.mjs` measures direct WebSocket-to-`node-pty` output. `tmux-path.mjs`
measures the shipped browser flow: a fresh intermediary PTY receives the
`tmux attach` command, then the probe command runs inside the tmux pane. Its
command workload is sent to `/dev/null`, so its completion latency is not
mistaken for terminal-renderer throughput.

## What is intentionally not hidden

Docker image size/startup requires a Docker daemon and browser LCP/INP,
hydration, React rerender, xterm paint, and memory measurements require a
Chromium/Playwright host. The harness reports those as unavailable when the
tools are not installed. It never substitutes package-directory size for a
Docker image measurement or server response time for browser paint time.
