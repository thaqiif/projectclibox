#!/usr/bin/env bash
set -euo pipefail

pid="${1:?usage: benchmarks/host-metrics.sh <root-pid> [tmux-pid] }"
tmux_pid="${2:-}"

echo "metadata"
node --version
uname -a
getconf _NPROCESSORS_ONLN
free -h

echo "process-tree"
ps -eo user,pid,ppid,stat,%cpu,%mem,rss,vsz,nlwp,etime,args --forest

echo "root-proc"
awk '/VmRSS|VmSize|Threads|voluntary_ctxt_switches|nonvoluntary_ctxt_switches/ {print}' "/proc/$pid/status"
printf 'fds='; find "/proc/$pid/fd" -maxdepth 1 -type l 2>/dev/null | wc -l

if [[ -n "$tmux_pid" && -r "/proc/$tmux_pid/status" ]]; then
  echo "tmux-process"
  awk '/VmRSS|VmSize|Threads|voluntary_ctxt_switches|nonvoluntary_ctxt_switches/ {print}' "/proc/$tmux_pid/status"
  printf 'fds='; find "/proc/$tmux_pid/fd" -maxdepth 1 -type l 2>/dev/null | wc -l
fi
