#!/bin/bash
# ─── Bring a kept sentinel-dvpnd home up to the cb33 single-config shape ───
# (plus one value: kill_switch 'on' -> 'persist', see below)
# cb33 (26de5240) keeps ONE config.toml per instance (client keys at the top level, then [network]
# [split] [key] [daemon] [log] [rpc] [tx]) and IGNORES unknown keys, so an old `escrow = 5000000`
# would silently fall back to the default deposit and an old `dns = 'none'` would let the service
# change system DNS again. A fresh cb33 init already uses the new names, so this is a no-op then;
# it only bites a home kept from an older build. Run as root by setup-daemon.sh. Idempotent: a key
# is renamed only when its new name is not already in the file. Keeps one .pre-migrate backup; mode,
# owner and ACL are preserved. Same renames as the Windows app's migrate-daemon-config.ps1 / the Linux app's .sh.
# Usage: migrate-daemon-config.sh [--DaemonHome '/Library/Application Support/sentinel-dvpn/c0']
set -uo pipefail
source "$(cd -P "$(dirname "$0")" && pwd -P)/_lib.sh"
HOME_DIR="$DAEMON_ROOT/c0"
[ "${1:-}" = --DaemonHome ] && HOME_DIR="${2:-}"
under "$HOME_DIR" "$DAEMON_ROOT" || { echo "migrate-daemon-config: daemon home must be under $DAEMON_ROOT: $HOME_DIR" >&2; exit 2; }

# old key | new key   (cb33 reads the new names; all live in the one config.toml now, key names are unique)
RENAMES='pipe endpoint
compute_unit_margin compute_unit_margin_percent
loaded_data_limit loaded_data_limit_bytes
max_priority_fee max_priority_fee_lamports
priority_fee priority_fee_lamports
escrow escrow_base_units
dns dns_backend
socket_group'   # cb33 has no socket_group; a kept home may still carry it (harmless, dropped below)

changed=0
f="$HOME_DIR/config.toml"
if [ -f "$f" ]; then
  tmp=$(mktemp) || { echo "migrate-daemon-config: mktemp failed" >&2; exit 1; }
  cp -- "$f" "$tmp"
  while read -r old new; do
    [ -n "$old" ] || continue
    if [ -z "$new" ]; then
      # a key with no replacement (socket_group): drop the whole line
      sed -i '' -E "/^[[:space:]]*${old}[[:space:]]*=/d" "$tmp"
      continue
    fi
    grep -qE "^[[:space:]]*${new}[[:space:]]*=" "$tmp" && continue
    sed -i '' -E "s/^([[:space:]]*)${old}([[:space:]]*=)/\\1${new}\\2/" "$tmp"
  done <<< "$RENAMES"
  # Kill switch "on" -> "persist" (11-07): the daemon's "on" lifts the block whenever the service
  # stops, so a restart or update sent traffic direct. The app has one "On" = persist; this moves
  # configs written before, here, before the service starts. "off" and "persist" are left alone.
  sed -i '' -E "s/^([[:space:]]*kill_switch[[:space:]]*=[[:space:]]*)(['\"])on(['\"])/\\1\\2persist\\3/" "$tmp"
  if ! cmp -s "$f" "$tmp"; then
    cp -p -- "$f" "$f.pre-migrate"
    cat "$tmp" > "$f"
    changed=$((changed + 1))
    echo "migrated $f"
  fi
  rm -f -- "$tmp"
fi
echo "migrate-daemon-config: $changed file(s) changed"
exit 0
