#!/bin/bash
# ─── Apply staged dvpnd config files and restart the service (decision D4, macOS) ───
# Run as root by the app. Takes only paths: the app wrote and validated the files in its own
# folder; this step never sees config text on its command line. It accepts only the expected
# file names (config.toml, client.config.toml, and optionally v2ray/xray.config.toml for
# whole-device mode), keeps a backup, restarts the service, and rolls back if it fails.
# Args: --Staged --DaemonHome [--Service] --Result
set -uo pipefail
source "$(cd -P "$(dirname "$0")" && pwd -P)/_lib.sh"
parse_args "$@"
STAGED="${ARG_Staged:-}"; HOME_DIR="${ARG_DaemonHome:-}"
under "$HOME_DIR" "$DAEMON_ROOT" || die "daemon home must be under $DAEMON_ROOT"
# cb33: ONE config.toml for the instance (no client/config.toml).
SRC=("$STAGED/config.toml")
DST=("$HOME_DIR/config.toml")
# Whole-device (tun) lives in each V2Ray/Xray service config at <instance dir>/<svc>/config.toml;
# only ones that already exist are replaced.
for s in v2ray xray; do
  if [ -e "$STAGED/$s.config.toml" ] && [ -f "$HOME_DIR/$s/config.toml" ]; then
    SRC+=("$STAGED/$s.config.toml"); DST+=("$HOME_DIR/$s/config.toml")
  fi
done
N=${#SRC[@]}
for ((i = 0; i < N; i++)); do
  { [ -f "${SRC[$i]}" ] && [ ! -L "${SRC[$i]}" ]; } || die "missing staged file ${SRC[$i]}"
  [ -f "${DST[$i]}" ] || die "daemon home has no ${DST[$i]}"
  [ "$(stat -f %z "${SRC[$i]}")" -le 65536 ] || die "staged file too large: ${SRC[$i]}"
done
for ((i = 0; i < N; i++)); do cp -p "${DST[$i]}" "${DST[$i]}.bak"; done
has_svc=0; [ -f "$PLIST" ] && has_svc=1
[ $has_svc = 1 ] && svc_stop
# writing through the existing file keeps its owner, mode and ACL (root:sentinel-dvpn 0640 + the user's read ACE)
for ((i = 0; i < N; i++)); do cat "${SRC[$i]}" > "${DST[$i]}" || die "could not write ${DST[$i]}"; done
if [ $has_svc = 1 ]; then
  ok=0
  if svc_start; then
    for _ in $(seq 1 150); do if [ -S "$HOME_DIR/daemon.sock" ] && svc_running; then ok=1; break; fi; sleep 0.2; done
  fi
  if [ $ok = 0 ]; then
    why="$(svc_log_tail 2)"
    for ((i = 0; i < N; i++)); do cat "${DST[$i]}.bak" > "${DST[$i]}"; done
    svc_stop; svc_start
    die "service failed to start with the new settings; previous settings restored: $why"
  fi
  write_result ok 'applied and restarted'
else
  write_result ok 'applied (no service installed)'
fi
