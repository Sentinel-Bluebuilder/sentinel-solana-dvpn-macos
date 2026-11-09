#!/bin/bash
# ─── Restore network: remove what a dead or failed sentinel-dvpnd session left holding the network ─
# Run as root by "Restore network" (src/main/system/tunnels.ts), only when the daemon has no live
# session. Only ours: never `pfctl -F all`, never `pfctl -d`, never a user's own tunnels.
#   - the daemon's pf anchor `sentinel-dvpn-c0` (kill switch) flushed and its pf enable token released
#   - the wg-quick link dvpn-c0 (its wireguard-go / amneziawg-go process); cb33 uses one interface per
#     instance for every protocol
#   - hysteria2 / v2ray / xray run from our folders; openvpn run with the daemon's config
#   - DNS servers the daemon set through networksetup, put back from the daemon's own backup file
# Args: [--BinRoot <app bin dir>] [--DaemonHome] --Result
set -uo pipefail
source "$(cd -P "$(dirname "$0")" && pwd -P)/_lib.sh"
parse_args "$@"
BIN_ROOT="${ARG_BinRoot:-}"; HOME_DIR="${ARG_DaemonHome:-$DAEMON_ROOT/c0}"
under "$HOME_DIR" "$DAEMON_ROOT" || die "daemon home must be under $DAEMON_ROOT"
removed=()
ours_exe() { # path → true when it is one of our binaries
  case "$1" in
    "$LIB"/*|/Applications/Devnet\ dVPN.app/*) return 0 ;;
  esac
  [ -n "$BIN_ROOT" ] && [[ "$1" == "$BIN_ROOT"/* ]]
}

# processes first: a live protocol process keeps its utun and routes
for pid in $(pgrep -x 'hysteria2|v2ray|xray' 2>/dev/null); do
  exe="$(ps -p "$pid" -o comm= 2>/dev/null)"
  if ours_exe "$exe"; then kill -TERM "$pid" 2>/dev/null && removed+=("$(basename "$exe"):$pid"); fi
done
for pid in $(pgrep -x openvpn 2>/dev/null); do
  if ps -p "$pid" -o args= 2>/dev/null | grep -qE '/(private/)?(Library/Application Support/sentinel-dvpn|var/db/dvpnd)/'; then
    kill -TERM "$pid" 2>/dev/null && removed+=("openvpn:$pid")
  fi
done
# wg-quick on macOS: /var/run/{wireguard,amneziawg}/<name>.name holds the utun the userspace
# process serves; removing its control socket makes that process exit and the utun go away.
for rd in /var/run/wireguard /var/run/amneziawg; do
  for n in dvpn-c0; do
    nf="$rd/$n.name"
    [ -f "$nf" ] || continue
    u="$(tr -d '[:space:]' < "$nf")"
    if [[ "$u" =~ ^utun[0-9]+$ ]]; then
      rm -f "$rd/$u.sock"
      for _ in $(seq 1 25); do ifconfig "$u" >/dev/null 2>&1 || break; sleep 0.2; done
      removed+=("link $n ($u)")
    fi
    rm -f "$nf"
  done
done
[ ${#removed[@]} -gt 0 ] && sleep 2

# kill switch: our anchor and the pf enable reference we took (pf stays on if anything else holds it)
if [ -n "$(pfctl -a sentinel-dvpn-c0 -s rules 2>/dev/null)" ]; then pfctl -a sentinel-dvpn-c0 -F all >/dev/null 2>&1 && removed+=('kill switch (pf anchor sentinel-dvpn-c0)'); fi
# upgrade cleanup: the pre-cb33 app named its kill-switch anchor 'dvpnd'; clear it too if left attached
if [ -n "$(pfctl -a dvpnd -s rules 2>/dev/null)" ]; then pfctl -a dvpnd -F all >/dev/null 2>&1 && removed+=('legacy kill switch (pf anchor dvpnd)'); fi
for tf in "$HOME_DIR/client/firewall-pf.token" "$HOME_DIR/firewall-pf.token"; do
  [ -f "$tf" ] && [ ! -L "$tf" ] || continue
  tok="$(tr -d '[:space:]' < "$tf")"
  if [[ "$tok" =~ ^[0-9]{1,20}$ ]]; then pfctl -X "$tok" >/dev/null 2>&1; removed+=("pf token $tok"); fi
  rm -f "$tf"
done

# DNS: dvpnd's backup = {"<network service>": ["server", ...] | []}; [] means "Empty"
for bf in "$HOME_DIR/client/dns-networksetup-backup.json" "$HOME_DIR/dns-networksetup-backup.json"; do
  [ -f "$bf" ] && [ ! -L "$bf" ] || continue
  lines="$(/usr/bin/osascript -l JavaScript -e 'function run(a){var o=JSON.parse($.NSString.stringWithContentsOfFileEncodingError(a[0],4,null).js);return Object.keys(o).map(function(k){return k+"\t"+((o[k]&&o[k].length)?o[k].join(" "):"Empty")}).join("\n")}' "$bf" 2>/dev/null)" || die "could not read the DNS backup $bf"
  while IFS=$'\t' read -r svc servers; do
    [ -n "$svc" ] || continue
    # shellcheck disable=SC2086 # servers is a space-separated list of addresses or "Empty"
    networksetup -setdnsservers "$svc" $servers >/dev/null 2>&1 && removed+=("dns $svc")
  done <<< "$lines"
  rm -f "$bf"
  dscacheutil -flushcache 2>/dev/null; killall -HUP mDNSResponder 2>/dev/null
done

left=()
[ -n "$(pfctl -a sentinel-dvpn-c0 -s rules 2>/dev/null)" ] && left+=('pf anchor sentinel-dvpn-c0')
for rd in /var/run/wireguard /var/run/amneziawg; do
  for n in dvpn-c0; do [ -f "$rd/$n.name" ] && left+=("$n"); done
done
if [ ${#left[@]} -gt 0 ]; then die "still present: ${left[*]}"; fi
if [ ${#removed[@]} -gt 0 ]; then write_result ok "removed: $(IFS=','; echo "${removed[*]}" | sed 's/,/, /g')"; else write_result ok 'none left'; fi
